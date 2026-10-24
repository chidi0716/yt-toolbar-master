package main

import (
	"context"
	"errors"
	"runtime"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/installer"
	"github.com/chidi0716/yt-toolbar-master/host/internal/logx"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
	"github.com/chidi0716/yt-toolbar-master/host/internal/updater"
	"github.com/chidi0716/yt-toolbar-master/host/internal/ytdlp"
)

// MaxUpdateDuration 是一次 --update 的時間上限（等待下載最多 6 小時，加上下載與替換的時間）。
const MaxUpdateDuration = 8 * time.Hour

// updateYtDlp 在 path 上執行 yt-dlp -U（yt-dlp 自己的更新機制會驗證官方檢查碼，008 FR-20），
// 回傳是否安裝了新版本。
func updateYtDlp(ctx context.Context, path string) (bool, error) {
	t := &ytdlp.Tools{Env: ytdlp.SystemEnv(), YtDlp: path}
	r, err := t.Update(ctx)
	if err != nil {
		return false, err
	}
	return r.Ran && r.Updated, nil
}

// runUpdate 實作 --update（由 download 或 checkUpdates 以脫離的方式啟動，plan 4.9）。
func runUpdate() int {
	log := logx.New(platform.LogDir(), "update")
	l := platform.CurrentLayout()
	st := store()
	u := &updater.Updater{
		Layout:      l,
		Platform:    installer.PlatformKey(runtime.GOOS, runtime.GOARCH),
		Version:     version,
		SelfPath:    selfPath(),
		Fetcher:     release.NewFetcher(version),
		ActiveJobs:  func() int { return st.ActiveCount(time.Now()) },
		UpdateYtDlp: updateYtDlp,
		Log:         log,
	}
	if u.Platform == "" {
		log.Printf("update skipped: unsupported platform")
		return 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), MaxUpdateDuration)
	defer cancel()
	result, err := u.Run(ctx)
	if errors.Is(err, updater.ErrLocked) {
		log.Printf("update skipped: another update is running")
		return 0
	}
	if err != nil {
		return 1
	}
	log.Printf("update finished: %s", result)
	return 0
}

// ytDlpUpdater 回傳執行下載的程序遇到 YTDLP_OUTDATED／VERIFICATION_REQUIRED 時使用的更新函式
// （008 FR-22）。只有安裝資料夾中的 yt-dlp 會被自動更新，使用者自己安裝的不動（FR-15）。
func ytDlpUpdater(t *ytdlp.Tools) func(context.Context) (bool, error) {
	if !t.Env.IsBundled(t.YtDlp) {
		return nil
	}
	path := t.YtDlp
	return func(ctx context.Context) (bool, error) { return updateYtDlp(ctx, path) }
}
