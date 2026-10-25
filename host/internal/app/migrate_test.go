package app

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
	"github.com/chidi0716/yt-toolbar-master/host/internal/updater"
	"github.com/chidi0716/yt-toolbar-master/host/internal/ytdlp"
)

// newMacApp 是 macOS 的 App（以 GOOS 模擬），安裝資料夾中有 v0.1.0 的單一執行檔 bin/yt-dlp。
func newMacApp(t *testing.T, version string) (*App, *spawnRecorder, string) {
	a, rec := newUpdateApp(t, version)
	a.Env.GOOS = "darwin"
	a.Env.IsFile = platform.IsFile
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	a.Now = func() time.Time { return now }
	os.MkdirAll(a.Layout.BinDir, 0o755)
	legacy := filepath.Join(a.Layout.BinDir, "yt-dlp")
	os.WriteFile(legacy, []byte("single-file yt-dlp"), 0o755)
	return a, rec, legacy
}

// TestStatusStartsMigration：macOS 上還是 v0.1.0 的單一執行檔 yt-dlp 時，status 不使用它，
// 並在自動更新開啟時立即啟動 --update 改裝未封裝版本（008 FR-15a）。
func TestStatusStartsMigration(t *testing.T) {
	ctx := context.Background()
	a, rec, legacy := newMacApp(t, "0.1.1")
	v, err := a.Status(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if c := components(t, v.(*StatusResult))["yt-dlp"]; c.Path == legacy || c.Source == "bundled" {
		t.Errorf("single-file yt-dlp used: %+v", c)
	}
	if got := rec.list(); len(got) != 1 || got[0] != "--update" {
		t.Fatalf("first status: %v", got)
	}
	// 上一次在 10 分鐘內失敗：先不再試。
	s := updater.Load(a.Layout.InstallDir)
	failed := a.now().Add(-time.Minute)
	s.LastCheck, s.LastResult = &failed, updater.ResultFailed
	s.Save(a.Layout.InstallDir)
	a.Status(ctx)
	if got := rec.list(); len(got) != 1 {
		t.Fatalf("after a recent failure: %v", got)
	}

	recs := map[string]*spawnRecorder{}
	// 自動更新關閉。
	b, r, _ := newMacApp(t, "0.1.1")
	b.SetAutoUpdate(ctx, false)
	b.Status(ctx)
	recs["auto off"] = r
	// 開發版。
	c, r, _ := newMacApp(t, "dev")
	c.Status(ctx)
	recs["dev"] = r
	// 已經是未封裝版本。
	d, r, dir := newMacApp(t, "0.1.1")
	os.Remove(dir)
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "yt-dlp_macos"), []byte("x"), 0o755)
	d.Status(ctx)
	recs["unpacked"] = r
	// macOS 以外。
	e, r, _ := newMacApp(t, "0.1.1")
	e.Env.GOOS = runtime.GOOS
	e.Status(ctx)
	recs["not macOS"] = r
	for name, r := range recs {
		if got := r.list(); len(got) != 0 {
			t.Errorf("%s: %v", name, got)
		}
	}
}

// TestUpdateYtDlpOnMacOS：macOS 安裝資料夾中的未封裝版本不支援 yt-dlp -U，updateYtDlp 改用小幫手的更新。
func TestUpdateYtDlpOnMacOS(t *testing.T) {
	a, _ := newUpdateApp(t, "0.1.1")
	a.Env.GOOS = "darwin"
	a.Env.IsFile = platform.IsFile
	exe := filepath.Join(a.Layout.BinDir, "yt-dlp", "yt-dlp_macos")
	os.MkdirAll(filepath.Dir(exe), 0o755)
	b, err := os.ReadFile(filepath.Join(testenv.FakeToolsDir(t), "yt-dlp"))
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(exe, b, 0o755)
	updated, fail := true, error(nil)
	calls := 0
	a.UpdateMacYtDlp = func(context.Context) (bool, error) { calls++; return updated, fail }
	v, err := a.UpdateYtDlp(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r := v.(*ytdlp.UpdateResult); !r.Ran || !r.Updated || r.UpToDate || r.Version != "2026.10.21" || calls != 1 {
		t.Errorf("updated: %+v calls=%d", r, calls)
	}
	updated = false
	v, _ = a.UpdateYtDlp(context.Background())
	if r := v.(*ytdlp.UpdateResult); !r.Ran || r.Updated || !r.UpToDate {
		t.Errorf("up to date: %+v", r)
	}
	fail = errs.New(errs.Network, "offline")
	if _, err := a.UpdateYtDlp(context.Background()); errs.From(err).Code != errs.Network {
		t.Errorf("failure: %v", err)
	}
}
