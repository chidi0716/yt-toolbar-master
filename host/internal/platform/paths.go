// Package platform 集中各作業系統的差異（plan 4.1）：資料與記錄檔位置、預設下載資料夾、
// 在 Finder／檔案總管中顯示檔案、選擇資料夾視窗、子程序的視窗設定。
//
// 會用到系統呼叫的部分以 build tag 分檔（*_darwin.go、*_windows.go、*_other.go）；
// 純粹組字串或命令列的部分寫成不分平台、以 goos 為參數的函式，方便在 Linux 上測試。
package platform

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// AppDirName 是橋接程式在使用者資料夾中使用的資料夾名稱（plan 4.7、4.8）。
const AppDirName = "yt-toolbar-master"

// pathEnv 是計算路徑時需要的環境。
type pathEnv struct {
	goos   string
	home   string
	getenv func(string) string
}

func currentEnv() pathEnv {
	home, _ := os.UserHomeDir()
	return pathEnv{goos: runtime.GOOS, home: home, getenv: os.Getenv}
}

func (e pathEnv) join(parts ...string) string {
	if e.goos == "windows" {
		return strings.Join(parts, `\`)
	}
	return strings.Join(parts, "/")
}

func (e pathEnv) localAppData() string {
	if la := e.getenv("LOCALAPPDATA"); la != "" {
		return la
	}
	return e.join(e.home, "AppData", "Local")
}

// dataDir 是安裝資料夾，也存放工作狀態（state/）：
//   - macOS：~/Library/Application Support/yt-toolbar-master
//   - Windows：%LOCALAPPDATA%\yt-toolbar-master
//   - 其他（只供開發與測試）：$XDG_STATE_HOME 或 ~/.local/state 下的同名資料夾
func (e pathEnv) dataDir() string {
	switch e.goos {
	case "darwin":
		return e.join(e.home, "Library", "Application Support", AppDirName)
	case "windows":
		return e.join(e.localAppData(), AppDirName)
	}
	if x := e.getenv("XDG_STATE_HOME"); x != "" && strings.HasPrefix(x, "/") {
		return e.join(x, AppDirName)
	}
	return e.join(e.home, ".local", "state", AppDirName)
}

// logDir 是記錄檔資料夾（plan 4.7）。
func (e pathEnv) logDir() string {
	switch e.goos {
	case "darwin":
		return e.join(e.home, "Library", "Logs", AppDirName)
	case "windows":
		return e.join(e.localAppData(), AppDirName, "logs")
	}
	return e.join(e.dataDir(), "logs")
}

// DataDir 回傳安裝與狀態資料夾。
func DataDir() string { return currentEnv().dataDir() }

// StateDir 回傳工作狀態檔的資料夾。
func StateDir() string { return filepath.Join(DataDir(), "state") }

// LogDir 回傳記錄檔資料夾。
func LogDir() string { return currentEnv().logDir() }

// DefaultDownloadDir 回傳系統的「下載」資料夾（002 FR-60 的預設值）。
// Windows 依已知資料夾（Known Folder）設定，使用者搬移過「下載」資料夾也能找到；
// 其他系統為 ~/Downloads。
func DefaultDownloadDir() string {
	if d := knownDownloadsDir(); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Downloads")
}
