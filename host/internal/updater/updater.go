package updater

import (
	"context"
	"errors"
	"io"
	"path/filepath"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/installer"
	"github.com/chidi0716/yt-toolbar-master/host/internal/logx"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
)

// 等待進行中的下載（plan 4.9：每 10 秒檢查一次，最多 6 小時）。
const (
	PollEvery = 10 * time.Second
	MaxWait   = 6 * time.Hour
)

// Logger 是記錄檔介面。
type Logger interface {
	Printf(format string, a ...any)
}

// Updater 是一次 ytm-host --update。
type Updater struct {
	Layout   platform.Layout
	Platform string // darwin-arm64、darwin-amd64、windows-amd64
	Version  string // 目前小幫手的版本
	SelfPath string // 目前執行中的小幫手
	Fetcher  *release.Fetcher
	// ManifestAllow 檢查下載清單的網址；預設 release.AllowedManifestURL（測試可以替換）。
	ManifestAllow release.URLCheck
	// ManifestBase 是最新正式版本的下載位置（預設 release.LatestBase）。
	ManifestBase string
	// ActiveJobs 回傳進行中的下載數量；替換工具前等到 0（008 FR-21）。
	ActiveJobs func() int
	// UpdateYtDlp 在安裝資料夾中的 yt-dlp 上執行 yt-dlp -U，回傳是否安裝了新版本。
	UpdateYtDlp func(ctx context.Context, path string) (bool, error)
	PollEvery   time.Duration
	MaxWait     time.Duration
	Now         func() time.Time
	Log         Logger
}

func (u *Updater) defaults() {
	if u.Now == nil {
		u.Now = time.Now
	}
	if u.Log == nil {
		u.Log = logx.Nop{}
	}
	if u.PollEvery == 0 {
		u.PollEvery = PollEvery
	}
	if u.MaxWait == 0 {
		u.MaxWait = MaxWait
	}
	if u.ManifestBase == "" {
		u.ManifestBase = release.LatestBase
	}
}

func (u *Updater) installer() *installer.Installer {
	return &installer.Installer{
		Layout: u.Layout, Platform: u.Platform, Version: u.Version, SelfPath: u.SelfPath,
		Fetcher: u.Fetcher, ManifestAllow: u.ManifestAllow, ManifestBase: u.ManifestBase, Out: io.Discard,
	}
}

// waitForIdle 等到沒有進行中的下載。
func (u *Updater) waitForIdle(ctx context.Context) error {
	if u.ActiveJobs == nil {
		return nil
	}
	deadline := u.Now().Add(u.MaxWait)
	for u.ActiveJobs() > 0 {
		if u.Now().After(deadline) {
			return errs.New(errs.Timeout, "downloads were still running after %s", u.MaxWait)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(u.PollEvery):
		}
	}
	return nil
}

// Run 執行一次更新並寫入狀態檔；回傳結果（ok、updated、failed）。
// 已經有另一個 --update 在執行時回傳 ErrLocked，不改變狀態。
func (u *Updater) Run(ctx context.Context) (string, error) {
	u.defaults()
	unlock, err := Lock(u.Layout.InstallDir)
	if err != nil {
		return "", err
	}
	defer unlock()
	updated, err := u.run(ctx)

	s := Load(u.Layout.InstallDir)
	now := u.Now()
	s.LastCheck = &now
	s.Updated = updated
	result := ResultOK
	switch {
	case err != nil:
		result = ResultFailed
		s.ConsecutiveFailures++
		s.LastError = string(errs.From(err).Code)
		u.Log.Printf("update failed: %s %s", errs.From(err).Code, errs.From(err).Message)
	case len(updated) > 0:
		result = ResultUpdated
	}
	if err == nil {
		s.ConsecutiveFailures, s.LastError = 0, ""
		u.Log.Printf("update %s %v", result, updated)
	}
	s.LastResult = result
	if serr := s.Save(u.Layout.InstallDir); serr != nil && err == nil {
		err = serr
	}
	return result, err
}

// run 是更新的各個步驟。任何一個元件失敗時繼續處理其他元件，最後回傳第一個錯誤。
func (u *Updater) run(ctx context.Context) ([]string, error) {
	in := u.installer()
	// 1. 從本專案 GitHub 下載並檢查清單（不正確時什麼都不做，008 SR-2）。
	m, err := in.LoadManifest(ctx, nil)
	if err != nil {
		return nil, err
	}
	// 2. 等到沒有進行中的下載才替換（008 FR-21）。
	if err := u.waitForIdle(ctx); err != nil {
		return nil, err
	}
	var updated []string
	var firstErr error
	fail := func(err error) {
		if firstErr == nil {
			firstErr = err
		}
	}

	// 3. yt-dlp：只更新安裝資料夾中的（套件管理工具安裝的不動，008 FR-15）。
	yt := filepath.Join(u.Layout.BinDir, release.ExeName("yt-dlp", u.Platform))
	if platform.IsFile(yt) && u.UpdateYtDlp != nil {
		ok, err := u.UpdateYtDlp(ctx, yt)
		if err != nil {
			fail(err)
		} else if ok {
			updated = append(updated, release.ToolYtDlp)
		}
	}

	// 4. deno、ffmpeg：只處理安裝資料夾中已有的，版本與清單不同時替換。
	state := installer.LoadState(u.Layout.InstallDir)
	for _, tool := range []string{release.ToolDeno, release.ToolFFmpeg} {
		t := m.Tools[tool]
		version := t.VersionFor(u.Platform)
		bins := release.Binaries(tool, u.Platform)
		if !platform.IsFile(filepath.Join(u.Layout.BinDir, bins[0])) || state.Tools[tool] == version {
			continue
		}
		if _, err := installer.InstallFiles(ctx, u.Fetcher, t.Platforms[u.Platform].Files, u.Layout.BinDir, u.Layout.GOOS); err != nil {
			fail(err)
			continue
		}
		state.Tools[tool] = version
		if err := state.Save(u.Layout.InstallDir); err != nil {
			fail(err)
		}
		updated = append(updated, tool)
	}

	// 5. 小幫手：清單版本比自己新，且自己就是安裝資料夾中的小幫手時才替換（開發版不更新）。
	if release.Newer(m.Version, u.Version) && u.SelfPath != "" && platform.SameFile(u.SelfPath, u.Layout.HelperPath) {
		changed, err := in.InstallHelper(ctx, m)
		if err != nil {
			fail(err)
		} else if changed {
			updated = append(updated, "helper")
		}
	}
	if firstErr != nil && errors.Is(firstErr, context.Canceled) {
		return updated, errs.New(errs.Unknown, "cancelled")
	}
	return updated, firstErr
}
