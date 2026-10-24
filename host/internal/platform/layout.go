package platform

import (
	"os"
	"strings"
)

// 原生訊息的名稱與允許呼叫的擴充功能（plan 4.8、specs/notes/extension-ids.md）。
const (
	NativeHostName = "com.chidi0716.yt_toolbar_master"
	ChromeOrigin   = "chrome-extension://bkjlangdjfpllnkcpfpdlajchbginjdj/"
	FirefoxID      = "yt-toolbar-master@chidi0716"
)

// ManifestLocation 是一個瀏覽器的原生訊息設定檔位置。
type ManifestLocation struct {
	Browser string // chrome 或 firefox（Zen 等以 Firefox 為基礎的瀏覽器讀取 Firefox 的位置）
	Path    string // 設定檔的路徑
	// RegistryKey 是 HKCU 下的登錄機碼（只有 Windows），預設值為 Path。
	RegistryKey string
}

// Layout 是小幫手在使用者資料夾中的所有位置（plan 4.7、4.8、4.9）。
type Layout struct {
	GOOS       string
	InstallDir string // 專屬資料夾
	BinDir     string // yt-dlp、deno、ffmpeg、ffprobe
	HelperPath string // 小幫手本身
	StateDir   string // 工作狀態
	LogDir     string // 記錄檔（Windows 在 InstallDir 之中）
	Manifests  []ManifestLocation
}

// HelperExeName 回傳小幫手的檔名。
func HelperExeName(goos string) string {
	if goos == "windows" {
		return "ytm-host.exe"
	}
	return "ytm-host"
}

func (e pathEnv) layout() Layout {
	dir := e.dataDir()
	l := Layout{
		GOOS:       e.goos,
		InstallDir: dir,
		BinDir:     e.join(dir, "bin"),
		HelperPath: e.join(dir, HelperExeName(e.goos)),
		StateDir:   e.join(dir, "state"),
		LogDir:     e.logDir(),
	}
	file := NativeHostName + ".json"
	switch e.goos {
	case "darwin":
		as := e.join(e.home, "Library", "Application Support")
		l.Manifests = []ManifestLocation{
			{Browser: "chrome", Path: e.join(as, "Google", "Chrome", "NativeMessagingHosts", file)},
			{Browser: "firefox", Path: e.join(as, "Mozilla", "NativeMessagingHosts", file)},
		}
	case "windows":
		l.Manifests = []ManifestLocation{
			{Browser: "chrome", Path: e.join(dir, NativeHostName+".chrome.json"), RegistryKey: `Software\Google\Chrome\NativeMessagingHosts\` + NativeHostName},
			{Browser: "firefox", Path: e.join(dir, NativeHostName+".firefox.json"), RegistryKey: `Software\Mozilla\NativeMessagingHosts\` + NativeHostName},
		}
	default:
		// 只供開發與測試（Linux）：Chrome 與 Firefox 的使用者層級位置。
		cfg := e.getenv("XDG_CONFIG_HOME")
		if cfg == "" || !strings.HasPrefix(cfg, "/") {
			cfg = e.join(e.home, ".config")
		}
		l.Manifests = []ManifestLocation{
			{Browser: "chrome", Path: e.join(cfg, "google-chrome", "NativeMessagingHosts", file)},
			{Browser: "firefox", Path: e.join(e.home, ".mozilla", "native-messaging-hosts", file)},
		}
	}
	return l
}

// CurrentLayout 回傳目前使用者的位置。
func CurrentLayout() Layout { return currentEnv().layout() }

// LayoutFor 回傳指定系統與家目錄的位置（測試用）。
func LayoutFor(goos, home string, getenv func(string) string) Layout {
	if getenv == nil {
		getenv = func(string) string { return "" }
	}
	return pathEnv{goos: goos, home: home, getenv: getenv}.layout()
}

// BinDir 回傳安裝資料夾中放工具的資料夾。
func BinDir() string { return CurrentLayout().BinDir }

// SameFile 回傳兩個路徑是否指向同一個檔案（不存在時比較字串）。
func SameFile(a, b string) bool {
	sa, err1 := os.Stat(a)
	sb, err2 := os.Stat(b)
	if err1 == nil && err2 == nil {
		return os.SameFile(sa, sb)
	}
	return a == b
}
