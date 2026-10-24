package platform

import (
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
)

func TestMain(m *testing.M) { testenv.Main(m) }

func TestPaths(t *testing.T) {
	env := func(goos, home string, vars map[string]string) pathEnv {
		return pathEnv{goos: goos, home: home, getenv: func(k string) string { return vars[k] }}
	}
	mac := env("darwin", "/Users/me", nil)
	if got := mac.dataDir(); got != "/Users/me/Library/Application Support/yt-toolbar-master" {
		t.Errorf("mac data: %s", got)
	}
	if got := mac.logDir(); got != "/Users/me/Library/Logs/yt-toolbar-master" {
		t.Errorf("mac log: %s", got)
	}
	win := env("windows", `C:\Users\me`, map[string]string{"LOCALAPPDATA": `C:\Users\me\AppData\Local`})
	if got := win.dataDir(); got != `C:\Users\me\AppData\Local\yt-toolbar-master` {
		t.Errorf("win data: %s", got)
	}
	if got := win.logDir(); got != `C:\Users\me\AppData\Local\yt-toolbar-master\logs` {
		t.Errorf("win log: %s", got)
	}
	winNoEnv := env("windows", `C:\Users\me`, nil)
	if got := winNoEnv.dataDir(); got != `C:\Users\me\AppData\Local\yt-toolbar-master` {
		t.Errorf("win fallback: %s", got)
	}
	linux := env("linux", "/home/me", map[string]string{"XDG_STATE_HOME": "/home/me/.state"})
	if got := linux.dataDir(); got != "/home/me/.state/yt-toolbar-master" {
		t.Errorf("linux: %s", got)
	}
	if got := env("linux", "/home/me", map[string]string{"XDG_STATE_HOME": "relative"}).dataDir(); got != "/home/me/.local/state/yt-toolbar-master" {
		t.Errorf("linux relative xdg: %s", got)
	}
}
