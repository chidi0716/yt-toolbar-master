package e2e

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
)

// TestInstallOfflineEndToEnd 以真正的 yte-host 執行 --install --offline 與 --uninstall
// （Linux 上使用開發用的位置：~/.local/state 與 ~/.config/google-chrome、~/.mozilla）。
func TestInstallOfflineEndToEnd(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("uses the Linux development locations")
	}
	host := buildHost(t)
	e := env{home: t.TempDir(), tools: testenv.FakeToolsDir(t, "ffmpeg")}
	run := func(args ...string) (string, int) {
		cmd := exec.Command(host, args...)
		cmd.Env = e.vars()
		out, err := cmd.CombinedOutput()
		code := 0
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else if err != nil {
			t.Fatal(err)
		}
		return string(out), code
	}
	installDir := filepath.Join(e.home, ".local", "state", "youtube-extension-host")
	helper := filepath.Join(installDir, "yte-host")
	chrome := filepath.Join(e.home, ".config", "google-chrome", "NativeMessagingHosts", "com.chidi0716.youtube_extension.json")
	firefox := filepath.Join(e.home, ".mozilla", "native-messaging-hosts", "com.chidi0716.youtube_extension.json")

	out, code := run("--install", "--offline")
	if code != 0 {
		t.Fatalf("exit %d:\n%s", code, out)
	}
	for _, p := range []string{helper, chrome, firefox} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s missing:\n%s", p, out)
		}
	}
	b, _ := os.ReadFile(chrome)
	if !strings.Contains(string(b), helper) || !strings.Contains(string(b), chromeOrigin) {
		t.Errorf("chrome manifest:\n%s", b)
	}
	if !strings.Contains(out, "Found yt-dlp") || !strings.Contains(out, "Missing: deno") {
		t.Errorf("output:\n%s", out)
	}
	// 安裝好的小幫手可以執行。
	if v, err := exec.Command(helper, "--version").Output(); err != nil || strings.TrimSpace(string(v)) == "" {
		t.Errorf("installed helper: %v %q", err, v)
	}

	// 不接受其他參數；Linux 不支援一行指令的安裝。
	for _, args := range [][]string{{"--install", "--evil"}, {"--install", "--manifest"}, {"--install", "--signature", "x"}, {"--install", "--manifest", "a", "--manifest", "b"}, {"--install", "--offline", "--manifest", "a"}, {"--uninstall", "--delay", "999"}} {
		if _, code := run(args...); code != 2 {
			t.Errorf("%v: exit %d, want 2", args, code)
		}
	}
	if out, code := run("--install"); code != 1 || !strings.Contains(out, "不在支援範圍") {
		t.Errorf("--install on linux: exit %d\n%s", code, out)
	}

	out, code = run("--uninstall")
	if code != 0 {
		t.Fatalf("uninstall exit %d:\n%s", code, out)
	}
	for _, p := range []string{installDir, chrome, firefox} {
		if _, err := os.Stat(p); err == nil {
			t.Errorf("%s still exists after uninstall", p)
		}
	}
}
