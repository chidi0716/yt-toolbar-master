package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/app"
	"github.com/chidi0716/yt-toolbar-master/host/internal/installer"
	"github.com/chidi0716/yt-toolbar-master/host/internal/jobs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
	"github.com/chidi0716/yt-toolbar-master/host/internal/ytdlp"
)

// UninstallRetry 是移除安裝資料夾時重試的時間（Windows 上剛結束的小幫手會暫時鎖住檔案）。
const UninstallRetry = 2 * time.Minute

// UninstallWait 是 --wait-pid 等待的上限：瀏覽器一直沒有關閉連線時，時間到仍然移除。
const UninstallWait = time.Minute

// selfPath 回傳目前執行中的小幫手路徑（解析符號連結）。
func selfPath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if r, err := filepath.EvalSymlinks(exe); err == nil {
		return r
	}
	return exe
}

// findSystem 尋找安裝資料夾以外的工具（Homebrew、winget、PATH）。
func findSystem(tool string) string {
	env := ytdlp.SystemEnv()
	env.BundledDir = ""
	return env.Find(tool)
}

// newInstaller 建立正式環境的 Installer。
func newInstaller() *installer.Installer {
	return &installer.Installer{
		Layout:     platform.CurrentLayout(),
		Platform:   installer.PlatformKey(runtime.GOOS, runtime.GOARCH),
		Version:    version,
		SelfPath:   selfPath(),
		Fetcher:    release.NewFetcher(version),
		FindSystem: findSystem,
		Out:        os.Stdout,
	}
}

const installUsage = "usage: ytm-host --install [--manifest <components.json>] | --install --offline"

// runInstall 實作 --install。參數只接受固定的旗標，路徑必須是存在的檔案。
func runInstall(args []string) int {
	var manifestPath string
	offline := false
	for i := 0; i < len(args); i++ {
		switch a := args[i]; {
		case a == "--offline":
			offline = true
		case a == "--manifest" && i+1 < len(args) && manifestPath == "":
			manifestPath = args[i+1]
			i++
		default:
			fmt.Fprintln(os.Stderr, installUsage)
			return 2
		}
	}
	if offline && manifestPath != "" {
		fmt.Fprintln(os.Stderr, installUsage)
		return 2
	}
	if isRoot() {
		fmt.Fprintln(os.Stderr, "請不要用 sudo 執行；下載功能只安裝在你自己的帳號下。/ Do not run this with sudo; it installs for your account only.")
		return 2
	}
	in := newInstaller()
	if offline {
		if err := in.InstallOffline(); err != nil {
			installer.PrintFailure(os.Stdout, err)
			return 1
		}
		return 0
	}
	var manifest []byte
	if manifestPath != "" {
		var err error
		if manifest, err = readSmall(manifestPath); err != nil {
			installer.PrintFailure(os.Stdout, err)
			return 1
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := in.Install(ctx, manifest); err != nil {
		installer.PrintFailure(os.Stdout, err)
		return 1
	}
	return 0
}

func readSmall(p string) ([]byte, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return release.ReadAllLimited(f, release.MaxSmallFile)
}

// runUninstall 實作 --uninstall [--wait-pid <PID>]。
//
// Windows 無法刪除執行中的檔案，所以從安裝資料夾執行時，先把自己複製到暫存資料夾，
// 以脫離的方式啟動複本來刪除，自己立即結束（暫存資料夾中的複本由系統清理）。
func runUninstall(args []string) int {
	waitPID := 0
	switch {
	case len(args) == 0:
	case len(args) == 2 && args[0] == app.WaitPIDFlag:
		n, err := strconv.Atoi(args[1])
		if err != nil || n <= 0 {
			fmt.Fprintln(os.Stderr, "--wait-pid must be a process ID")
			return 2
		}
		waitPID = n
	default:
		fmt.Fprintln(os.Stderr, "usage: ytm-host --uninstall [--wait-pid <PID>]")
		return 2
	}
	l := platform.CurrentLayout()
	if runtime.GOOS == "windows" && insideDir(selfPath(), l.InstallDir) {
		pid, err := spawnUninstallCopy(waitPID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "could not start the uninstaller: %v\n", err)
			return 1
		}
		fmt.Printf("正在背景移除下載功能（程序 %d）/ Removing the download helper in the background (process %d)\n", pid, pid)
		return 0
	}
	waitForExit(waitPID, UninstallWait)
	if err := installer.Uninstall(l, os.Stdout, UninstallRetry); err != nil {
		fmt.Fprintf(os.Stdout, "失敗 / Failed: %v\n", err)
		fmt.Fprintln(os.Stdout, "請關閉 Chrome 與 Firefox 後再執行一次。/ Close Chrome and Firefox, then run it again.")
		return 1
	}
	return 0
}

// waitForExit 等 PID 的程序結束，最長 max；pid 為 0 時不等。
func waitForExit(pid int, max time.Duration) {
	deadline := time.Now().Add(max)
	for pid > 0 && jobs.ProcessAlive(pid) && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
}

// spawnUninstallCopy 把自己複製到系統暫存資料夾並以脫離的方式執行 --uninstall。
func spawnUninstallCopy(waitPID int) (int, error) {
	src := selfPath()
	dest := filepath.Join(os.TempDir(), fmt.Sprintf("ytm-uninstall-%d.exe", time.Now().UnixNano()))
	in, err := os.ReadFile(src)
	if err != nil {
		return 0, err
	}
	if err := os.WriteFile(dest, in, 0o755); err != nil {
		return 0, err
	}
	args := []string{app.UninstallFlag}
	if waitPID > 0 {
		args = append(args, app.WaitPIDFlag, strconv.Itoa(waitPID))
	}
	return jobs.SpawnDetached(dest, args...)
}

// insideDir 回傳 p 是否在 dir 之中（Windows 不分大小寫）。
func insideDir(p, dir string) bool {
	if p == "" || dir == "" {
		return false
	}
	rel, err := filepath.Rel(dir, p)
	if err != nil {
		return false
	}
	if runtime.GOOS == "windows" && strings.EqualFold(filepath.Dir(p), dir) {
		return true
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
