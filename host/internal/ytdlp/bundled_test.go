package ytdlp

import "testing"

// TestFindBundledFirst 確認安裝資料夾的 bin/ 最優先（plan 4.9、008 FR-15），並回報來源。
func TestFindBundledFirst(t *testing.T) {
	bundled := "/Users/me/Library/Application Support/yt-toolbar-master/bin"
	// macOS：未封裝版本 bin/yt-dlp/yt-dlp_macos（008 FR-15a）。
	e := fakeEnv("darwin", map[string]string{"PATH": "/usr/bin"},
		bundled+"/yt-dlp/yt-dlp_macos", bundled+"/deno", "/opt/homebrew/bin/yt-dlp", "/opt/homebrew/bin/ffmpeg", "/opt/homebrew/bin/ffprobe")
	e.BundledDir = bundled
	e.LookPath = func(name string) (string, error) { return "/Users/me/bin/" + name, nil }
	if got := e.Find("yt-dlp"); got != bundled+"/yt-dlp/yt-dlp_macos" {
		t.Errorf("yt-dlp = %q", got)
	}
	if got := e.Find("deno"); got != bundled+"/deno" {
		t.Errorf("deno = %q", got)
	}
	if got := e.Source(bundled + "/yt-dlp/yt-dlp_macos"); got != "bundled" {
		t.Errorf("bundled source = %q", got)
	}
	if e.IsBundled(bundled+"/deno/yt-dlp_macos") || e.IsBundled(bundled+"/yt-dlp/_internal/Python") {
		t.Error("IsBundled outside the yt-dlp executable")
	}
	// 舊版的單一執行檔 bin/yt-dlp 不使用（由瀏覽器啟動時會被 Gatekeeper 拒絕）。
	legacy := fakeEnv("darwin", map[string]string{"PATH": "/usr/bin"}, bundled+"/yt-dlp", "/opt/homebrew/bin/yt-dlp")
	legacy.BundledDir = bundled
	if got := legacy.Find("yt-dlp"); got != "/opt/homebrew/bin/yt-dlp" {
		t.Errorf("legacy single-file yt-dlp: %q", got)
	}
	// 其他系統（Linux，只供開發）：bin/yt-dlp。
	linux := fakeEnv("linux", map[string]string{"PATH": "/usr/bin"}, "/home/me/.local/state/yt-toolbar-master/bin/yt-dlp")
	linux.BundledDir = "/home/me/.local/state/yt-toolbar-master/bin"
	if got := linux.Find("yt-dlp"); got != linux.BundledDir+"/yt-dlp" || !linux.IsBundled(got) {
		t.Errorf("linux yt-dlp = %q", got)
	}
	if got := e.Source("/opt/homebrew/Cellar/ffmpeg/7/bin/ffmpeg"); got != "homebrew" {
		t.Errorf("homebrew source = %q", got)
	}
	if got := e.Source("/Users/me/bin/ffprobe"); got != "path" {
		t.Errorf("path source = %q", got)
	}
	if e.IsBundled(bundled+"/sub/yt-dlp") || e.IsBundled("") {
		t.Error("IsBundled")
	}

	la := `C:\Users\me\AppData\Local`
	w := fakeEnv("windows", map[string]string{"LOCALAPPDATA": la},
		la+`\yt-toolbar-master\bin\ffprobe.exe`, la+`\Microsoft\WinGet\Packages\Gyan.FFmpeg_x\ffmpeg-7\bin\ffprobe.exe`)
	if got := w.Find("ffprobe"); got != la+`\Microsoft\WinGet\Packages\Gyan.FFmpeg_x\ffmpeg-7\bin\ffprobe.exe` {
		t.Errorf("winget ffprobe = %q", got)
	}
	w.BundledDir = la + `\yt-toolbar-master\bin`
	if got := w.Find("ffprobe"); got != la+`\yt-toolbar-master\bin\ffprobe.exe` {
		t.Errorf("bundled ffprobe = %q", got)
	}
	if got := w.Source(la + `\YT-Toolbar-Master\BIN\ffprobe.exe`); got != "bundled" {
		t.Errorf("windows bundled source = %q", got)
	}
	if got := w.Source(la + `\Microsoft\WinGet\Links\ffmpeg.exe`); got != "winget" {
		t.Errorf("winget source = %q", got)
	}
}
