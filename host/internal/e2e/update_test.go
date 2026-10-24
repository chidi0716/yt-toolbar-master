package e2e

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// TestUpdateCommandsEndToEnd 經由原生訊息測試 plan 4.9 新增的指令：status 的 components 與 update、
// setAutoUpdate、checkUpdates、uninstall（真的啟動分離的 --uninstall --delay 2）。
func TestUpdateCommandsEndToEnd(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("uses the Linux development locations")
	}
	e := newEnv(t)
	installDir := filepath.Join(e.home, ".local", "state", "yt-toolbar-master")
	b := start(t, e, chromeOrigin)
	defer func() { t.Logf("transcript:\n%s", b.log) }()

	st := ok(t, b.request("status", nil, nil))
	comps, _ := st["components"].([]any)
	if len(comps) != 5 || comps[0].(map[string]any)["name"] != "helper" {
		t.Fatalf("components: %v", st["components"])
	}
	upd := st["update"].(map[string]any)
	if upd["auto"] != true || upd["lastCheck"] != nil || upd["lastResult"] != nil || upd["running"] != false {
		t.Fatalf("update: %v", upd)
	}

	if r := ok(t, b.request("setAutoUpdate", map[string]any{"enabled": false}, nil)); r["auto"] != false {
		t.Fatalf("setAutoUpdate: %v", r)
	}
	if upd := ok(t, b.request("status", nil, nil))["update"].(map[string]any); upd["auto"] != false {
		t.Fatalf("auto after setAutoUpdate: %v", upd)
	}
	if r := b.request("setAutoUpdate", map[string]any{"enabled": "no"}, nil); errCode(r) != "INVALID_ARGS" {
		t.Errorf("setAutoUpdate with a string: %v", r)
	}
	if r := ok(t, b.request("checkUpdates", nil, nil)); r["started"] != true {
		t.Fatalf("checkUpdates: %v", r)
	}

	if r := ok(t, b.request("uninstall", nil, nil)); r["ok"] != true {
		t.Fatalf("uninstall: %v", r)
	}
	deadline := time.Now().Add(15 * time.Second)
	for {
		if _, err := os.Stat(installDir); os.IsNotExist(err) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the install folder was not removed")
		}
		time.Sleep(200 * time.Millisecond)
	}
}
