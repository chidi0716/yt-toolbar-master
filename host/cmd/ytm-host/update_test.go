package main

import (
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/ytdlp"
)

// TestYtDlpUpdater：只有安裝資料夾中的 yt-dlp 會在下載中自動更新（008 FR-22）；macOS 使用小幫手的
// 下載替換（未封裝版本不支援 yt-dlp -U）。
func TestYtDlpUpdater(t *testing.T) {
	bin := "/Users/me/Library/Application Support/yt-toolbar-master/bin"
	mac := ytdlp.Env{GOOS: "darwin", BundledDir: bin}
	if ytDlpUpdater(&ytdlp.Tools{Env: mac, YtDlp: "/opt/homebrew/bin/yt-dlp"}) != nil {
		t.Error("Homebrew yt-dlp would be updated")
	}
	if ytDlpUpdater(&ytdlp.Tools{Env: mac, YtDlp: bin + "/yt-dlp/yt-dlp_macos"}) == nil {
		t.Error("bundled macOS yt-dlp is not updated")
	}
	win := ytdlp.Env{GOOS: "windows", BundledDir: `C:\Users\me\AppData\Local\yt-toolbar-master\bin`}
	if ytDlpUpdater(&ytdlp.Tools{Env: win, YtDlp: win.BundledDir + `\yt-dlp.exe`}) == nil {
		t.Error("bundled Windows yt-dlp is not updated")
	}
}
