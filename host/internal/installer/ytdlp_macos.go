package installer

import (
	"context"
	"os"
	"path/filepath"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
)

// LegacyMacYtDlp 回傳安裝資料夾中是否還是 v0.1.0 安裝的單一執行檔 bin/yt-dlp（只限 macOS）。
// 由瀏覽器啟動時它會被 Gatekeeper 拒絕（008 FR-15a），要改裝未封裝版本。
func LegacyMacYtDlp(l platform.Layout) bool {
	if l.GOOS != "darwin" {
		return false
	}
	st, err := os.Lstat(filepath.Join(l.BinDir, release.ToolYtDlp))
	return err == nil && st.Mode().IsRegular()
}

// UpdateMacYtDlp 更新安裝資料夾中的未封裝版 yt-dlp（macOS，008 FR-20、FR-22）：從 yt-dlp 官方 GitHub 的
// 最新正式版本取得 SHA2-256SUMS；其中 yt-dlp_macos.zip 的 SHA256 與目前安裝的不同時，下載、核對、
// 解壓到暫存資料夾後整個替換 bin/yt-dlp/（失敗時保留舊版）。安裝資料夾中還是舊版的單一執行檔時，
// 一律改裝未封裝版本並刪除舊檔。安裝資料夾中沒有 yt-dlp 時不做任何事。回傳是否安裝了新版本。
// 呼叫端負責避免同時執行（更新鎖檔）。
func (in *Installer) UpdateMacYtDlp(ctx context.Context) (bool, error) {
	legacy := LegacyMacYtDlp(in.Layout)
	exe := filepath.Join(in.Layout.BinDir, release.ToolYtDlp, release.MacYtDlpExe)
	if !legacy && !platform.IsFile(exe) {
		return false, nil
	}
	base := in.YtDlpBase
	if base == "" {
		base = release.YtDlpLatestBase
	}
	sums, err := in.Fetcher.Get(ctx, base+release.YtDlpChecksumsName)
	if err != nil {
		return false, classify(err)
	}
	sum, err := release.ParseChecksums(string(sums), release.YtDlpMacZipName)
	if err != nil {
		return false, errs.New(errs.UpdateFailed, "%s: %v", release.YtDlpChecksumsName, err)
	}
	state := LoadState(in.Layout.InstallDir)
	if !legacy && state.Archives[release.ToolYtDlp] == sum {
		return false, nil
	}
	file := release.File{URL: base + release.YtDlpMacZipName, SHA256: sum, Archive: "zip", Extract: []string{release.ToolYtDlp}}
	p, err := prepareFiles(ctx, in.Fetcher, []release.File{file}, in.Layout.BinDir, in.Layout.GOOS, release.MacYtDlpExe, nil)
	if err != nil {
		return false, err
	}
	defer p.close()
	if _, err := p.commit(); err != nil {
		return false, err
	}
	// Tools 記錄的是清單中的版本；更新到 latest 之後不再適用。
	delete(state.Tools, release.ToolYtDlp)
	state.Archives[release.ToolYtDlp] = sum
	if err := state.Save(in.Layout.InstallDir); err != nil {
		return true, classify(err)
	}
	return true, nil
}
