package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/jobs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
	"github.com/chidi0716/yt-toolbar-master/host/internal/updater"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
)

type spawnRecorder struct {
	mu    sync.Mutex
	calls []string
}

func (s *spawnRecorder) spawn(args ...string) (int, error) {
	s.mu.Lock()
	s.calls = append(s.calls, strings.Join(args, " "))
	s.mu.Unlock()
	return 12345, nil
}

func (s *spawnRecorder) list() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.calls...)
}

func newUpdateApp(t *testing.T, version string) (*App, *spawnRecorder) {
	t.Helper()
	m := &jobs.Manager{
		Store:  &jobs.Store{Dir: filepath.Join(t.TempDir(), "jobs")},
		Client: "chrome",
		Spawn:  func(string) (int, error) { return os.Getpid(), nil }, // 不實際執行
		Emit:   func(*jobs.Event) error { return nil },
	}
	m.Init()
	rec := &spawnRecorder{}
	l := platform.LayoutFor("darwin", t.TempDir(), nil)
	env := envWithPath(testenv.FakeToolsDir(t, "ffmpeg", "ffprobe", "deno"))
	env.BundledDir = l.BinDir
	a := &App{Version: version, Env: env, Manager: m, Actions: platform.NewActions(), Layout: l, SpawnSelf: rec.spawn}
	return a, rec
}

func download(t *testing.T, a *App) string {
	t.Helper()
	v, err := a.Download(context.Background(), &validate.Download{VideoID: "dQw4w9WgXcQ", Kind: "mp3", Bitrate: 192, Dir: t.TempDir(), NamePreset: "title-id", Embed: true})
	if err != nil {
		t.Fatal(err)
	}
	return v.(*DownloadResult).JobID
}

// TestDownloadStartsAutoUpdate 測試 008 FR-20：開始下載時，距上次檢查超過 24 小時才啟動 --update。
func TestDownloadStartsAutoUpdate(t *testing.T) {
	a, rec := newUpdateApp(t, "0.2.0")
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	a.Now = func() time.Time { return now }
	download(t, a)
	if got := rec.list(); len(got) != 1 || got[0] != "--update" {
		t.Fatalf("first download: %v", got)
	}
	// 檢查過（--update 寫入 lastCheck）後 24 小時內不再啟動。
	s := updater.Load(a.Layout.InstallDir)
	checked := now.Add(-time.Hour)
	s.LastCheck = &checked
	s.Save(a.Layout.InstallDir)
	download(t, a)
	download(t, a)
	if got := rec.list(); len(got) != 1 {
		t.Fatalf("within 24 hours: %v", got)
	}
	now = now.Add(24 * time.Hour)
	download(t, a)
	if got := rec.list(); len(got) != 2 {
		t.Fatalf("after 24 hours: %v", got)
	}
	// 自動更新關閉：不啟動。
	if _, err := a.SetAutoUpdate(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	now = now.Add(48 * time.Hour)
	download(t, a)
	if got := rec.list(); len(got) != 2 {
		t.Fatalf("auto update off: %v", got)
	}
	// 開發版不自動更新。
	b, rec2 := newUpdateApp(t, "dev")
	download(t, b)
	if got := rec2.list(); len(got) != 0 {
		t.Fatalf("dev build: %v", got)
	}
}

func TestCheckUpdatesAndSetAutoUpdate(t *testing.T) {
	a, rec := newUpdateApp(t, "0.2.0")
	ctx := context.Background()
	v, err := a.CheckUpdates(ctx)
	if err != nil || !v.(*CheckUpdatesResult).Started || strings.Join(rec.list(), ";") != "--update" {
		t.Fatalf("%+v %v %v", v, err, rec.list())
	}
	// 已經在執行：started false，不再啟動。
	unlock, err := updater.Lock(a.Layout.InstallDir)
	if err != nil {
		t.Fatal(err)
	}
	v, _ = a.CheckUpdates(ctx)
	if v.(*CheckUpdatesResult).Started || len(rec.list()) != 1 {
		t.Fatalf("running: %+v %v", v, rec.list())
	}
	st, _ := a.Status(ctx)
	if !st.(*StatusResult).Update.Running {
		t.Error("status should report the running update")
	}
	unlock()

	r, err := a.SetAutoUpdate(ctx, false)
	if err != nil || r.(*SetAutoUpdateResult).Auto {
		t.Fatalf("%+v %v", r, err)
	}
	st, _ = a.Status(ctx)
	if st.(*StatusResult).Update.Auto {
		t.Error("auto should be off")
	}
	a.SetAutoUpdate(ctx, true)
	st, _ = a.Status(ctx)
	if !st.(*StatusResult).Update.Auto {
		t.Error("auto should be on")
	}
}

func TestUninstallCommand(t *testing.T) {
	a, rec := newUpdateApp(t, "0.2.0")
	ctx := context.Background()
	id := download(t, a)
	if _, err := a.Uninstall(ctx); errs.From(err).Code != errs.JobsRunning {
		t.Fatalf("with a running download: %v", err)
	}
	for _, c := range rec.list() {
		if strings.HasPrefix(c, "--uninstall") {
			t.Fatal("uninstaller started while a download was running")
		}
	}
	st, _ := a.Manager.Store.ReadStatus(id)
	now := time.Now()
	st.State, st.FinishedAt = jobs.StateDone, &now
	a.Manager.Store.WriteStatus(st)
	v, err := a.Uninstall(ctx)
	if err != nil || !v.(*UninstallResult).OK {
		t.Fatalf("%+v %v", v, err)
	}
	if got := rec.list(); got[len(got)-1] != "--uninstall --delay 2" {
		t.Fatalf("spawned: %v", got)
	}
	b, _ := json.Marshal(v)
	if string(b) != `{"ok":true}` {
		t.Errorf("result JSON: %s", b)
	}
}

// TestStatusComponents 測試 status 的 components 與 update（plan 4.9）。
func TestStatusComponents(t *testing.T) {
	a, _ := newUpdateApp(t, "0.2.0")
	// 小幫手從安裝資料夾執行、yt-dlp 在安裝資料夾中，其他來自 PATH。
	os.MkdirAll(a.Layout.BinDir, 0o755)
	src := filepath.Join(testenv.FakeToolsDir(t), "yt-dlp")
	b, _ := os.ReadFile(src)
	os.WriteFile(filepath.Join(a.Layout.BinDir, "yt-dlp"), b, 0o755)
	os.WriteFile(a.Layout.HelperPath, []byte("helper"), 0o755)
	a.SelfPath = a.Layout.HelperPath
	a.Env.IsFile = func(p string) bool { st, err := os.Stat(p); return err == nil && st.Mode().IsRegular() }

	v, err := a.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	s := v.(*StatusResult)
	if !s.Update.Auto || s.Update.LastCheck != nil || s.Update.LastResult != nil {
		t.Fatalf("%+v", s)
	}
	got := components(t, s)
	if c := got["helper"]; c.Source != "bundled" || c.Version != "0.2.0" || !c.Found {
		t.Errorf("helper: %+v", c)
	}
	if c := got["yt-dlp"]; c.Source != "bundled" || c.Version != "2026.10.21" || c.Path != filepath.Join(a.Layout.BinDir, "yt-dlp") {
		t.Errorf("yt-dlp: %+v", c)
	}
	if c := got["ffprobe"]; c.Source != "path" || c.Version != "7.1-fake" || !c.Found {
		t.Errorf("ffprobe: %+v", c)
	}
	if c := got["deno"]; c.Version != "2.1.4" || c.Source != "path" {
		t.Errorf("deno: %+v", c)
	}
	// JSON 欄位名稱（擴充功能依這些名稱讀取）。
	j, _ := json.Marshal(s)
	var top map[string]json.RawMessage
	json.Unmarshal(j, &top)
	if keys := sortedKeys(top); keys != "complete,components,defaultDir,hostVersion,namePresets,ready,update" {
		t.Errorf("status keys: %s", keys)
	}
	var comps []map[string]json.RawMessage
	json.Unmarshal(top["components"], &comps)
	for _, c := range comps {
		if keys := sortedKeys(c); keys != "error,found,name,path,source,version" {
			t.Errorf("component keys: %s", keys)
		}
	}
	for _, key := range []string{`"components":[{"name":"helper","found":true,"version":"0.2.0","path":`, `"source":"bundled","error":""}`, `"namePresets":[{"id":"title-id","example":`, `"update":{"auto":true,"lastCheck":null,"lastResult":null,"consecutiveFailures":0,"running":false}`} {
		if !strings.Contains(string(j), key) {
			t.Errorf("status JSON does not contain %s:\n%s", key, j)
		}
	}
	// 找不到的元件：found false。
	a.Env = envWithPath(t.TempDir())
	a.SelfPath = filepath.Join(t.TempDir(), "ytm-host")
	v, _ = a.Status(context.Background())
	for _, c := range v.(*StatusResult).Components {
		if c.Name == "helper" {
			if c.Source != "path" {
				t.Errorf("helper not in install dir: %+v", c)
			}
			continue
		}
		if c.Found || c.Path != "" || c.Source != "" {
			t.Errorf("missing %s: %+v", c.Name, c)
		}
	}
}

func sortedKeys(m map[string]json.RawMessage) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}
