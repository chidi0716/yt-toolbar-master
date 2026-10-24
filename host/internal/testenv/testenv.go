// Package testenv 只給測試使用：讓 t.TempDir() 等暫存檔落在 repo 內的
// host/.testtmp/（已列入 .gitignore），不寫到系統的暫存資料夾；
// 並負責編譯測試用的假 yt-dlp。
package testenv

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

// HostDir 回傳 host/ 資料夾的絕對路徑。
func HostDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

// Main 在 TestMain 中呼叫：設定暫存資料夾後執行測試。
func Main(m *testing.M) {
	dir := filepath.Join(HostDir(), ".testtmp")
	if err := os.MkdirAll(dir, 0o755); err == nil {
		tmp, err := os.MkdirTemp(dir, "run-")
		if err == nil {
			os.Setenv("TMPDIR", tmp)
			os.Setenv("TMP", tmp)
			os.Setenv("TEMP", tmp)
			code := m.Run()
			os.RemoveAll(tmp)
			os.Exit(code)
		}
	}
	os.Exit(m.Run())
}

var (
	buildOnce sync.Once
	fakeDir   string
	buildErr  error
)

// Build 編譯 host 模組內的一個套件（例如 ./cmd/ytm-host）到 dir/name。
func Build(dir, name, pkg string) (string, error) {
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	out := filepath.Join(dir, name)
	cmd := exec.Command("go", "build", "-o", out, pkg)
	cmd.Dir = HostDir()
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("go build %s: %v\n%s", pkg, err, b)
	}
	return out, nil
}

// FakeYtDlpDir 編譯 testdata/fake-yt-dlp 成 yt-dlp（Windows 為 yt-dlp.exe），
// 回傳所在的資料夾。同一個測試程式只編譯一次。
func FakeYtDlpDir(t testing.TB) string {
	t.Helper()
	buildOnce.Do(func() {
		dir, err := os.MkdirTemp("", "fake-bin-")
		if err != nil {
			buildErr = err
			return
		}
		if _, buildErr = Build(dir, "yt-dlp", "./testdata/fake-yt-dlp"); buildErr == nil {
			fakeDir = dir
		}
	})
	if buildErr != nil {
		t.Fatal(buildErr)
	}
	return fakeDir
}

// FakeToolsDir 建立一個新的資料夾，放入假 yt-dlp，以及 extra 中列出的其他工具
// （"ffmpeg"、"deno"：同一個假程式的複本，依檔名模擬各自的 --version）。
func FakeToolsDir(t testing.TB, extra ...string) string {
	t.Helper()
	src := FakeYtDlpDir(t)
	exe := ""
	if runtime.GOOS == "windows" {
		exe = ".exe"
	}
	b, err := os.ReadFile(filepath.Join(src, "yt-dlp"+exe))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	names := append([]string{"yt-dlp"}, extra...)
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n+exe), b, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}
