package updater

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/installer"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
)

func TestMain(m *testing.M) { testenv.Main(m) }

func TestShouldCheck(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { x := now.Add(-d); return &x }
	off := false
	cases := []struct {
		s    State
		want bool
	}{
		{State{}, true},
		{State{LastCheck: at(23 * time.Hour)}, false},
		{State{LastCheck: at(24 * time.Hour)}, true},
		{State{LastCheck: at(-30 * time.Minute)}, false},
		{State{LastCheck: at(-2 * time.Hour)}, true}, // 時鐘被往回調
		{State{Auto: &off}, false},
		{State{Auto: &off, LastCheck: at(48 * time.Hour)}, false},
	}
	for i, c := range cases {
		if got := ShouldCheck(&c.s, now); got != c.want {
			t.Errorf("case %d: got %v", i, got)
		}
	}
}

func TestShouldMigrate(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { x := now.Add(-d); return &x }
	off := false
	cases := []struct {
		s    State
		want bool
	}{
		{State{}, true},
		{State{LastCheck: at(time.Minute), LastResult: ResultUpdated}, true}, // 剛由 v0.1.0 更新成這個版本
		{State{LastCheck: at(time.Minute), LastResult: ResultOK}, true},
		{State{LastCheck: at(time.Minute), LastResult: ResultFailed}, false},
		{State{LastCheck: at(10 * time.Minute), LastResult: ResultFailed}, true},
		{State{LastCheck: at(-2 * time.Hour), LastResult: ResultFailed}, true}, // 時鐘被往回調
		{State{Auto: &off}, false},
	}
	for i, c := range cases {
		if got := ShouldMigrate(&c.s, now); got != c.want {
			t.Errorf("case %d: got %v", i, got)
		}
	}
}

func TestStateAndView(t *testing.T) {
	dir := t.TempDir()
	v := ViewOf(dir)
	if !v.Auto || v.LastCheck != nil || v.LastResult != nil || v.Running || v.ConsecutiveFailures != 0 {
		t.Fatalf("default view: %+v", v)
	}
	if err := SetAuto(dir, false); err != nil {
		t.Fatal(err)
	}
	s := Load(dir)
	when := time.Date(2026, 10, 23, 1, 2, 3, 0, time.FixedZone("x", 8*3600))
	s.LastCheck, s.LastResult, s.ConsecutiveFailures = &when, ResultFailed, 3
	s.Save(dir)
	v = ViewOf(dir)
	if v.Auto || *v.LastCheck != "2026-10-22T17:02:03Z" || *v.LastResult != "failed" || v.ConsecutiveFailures != 3 {
		t.Fatalf("view: %+v", v)
	}
	// 格式錯誤的狀態檔：回到預設值。
	os.WriteFile(filepath.Join(dir, StateFileName), []byte("{"), 0o644)
	if !Load(dir).AutoEnabled() {
		t.Fatal("broken state should fall back to defaults")
	}
}

func TestLock(t *testing.T) {
	dir := t.TempDir()
	unlock, err := Lock(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !Running(dir) {
		t.Error("Running should be true while locked")
	}
	if _, err := Lock(dir); !errors.Is(err, ErrLocked) {
		t.Errorf("second lock: %v", err)
	}
	unlock()
	if Running(dir) {
		t.Error("Running after unlock")
	}
	// 程序已經不在的鎖檔會被取代。
	os.WriteFile(filepath.Join(dir, LockFileName), []byte("999999999\n"), 0o644)
	if Running(dir) {
		t.Error("stale lock reported as running")
	}
	unlock, err = Lock(dir)
	if err != nil {
		t.Fatalf("stale lock not replaced: %v", err)
	}
	unlock()
	os.WriteFile(filepath.Join(dir, LockFileName), []byte("garbage"), 0o644)
	if unlock, err = Lock(dir); err != nil {
		t.Fatalf("garbage lock not replaced: %v", err)
	}
	unlock()
}

func makeZip(t *testing.T, name, content string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create(name)
	w.Write([]byte(content))
	zw.Close()
	return buf.Bytes()
}

// fixture 是已經用一行指令安裝好的環境，加上一個提供新版本的假伺服器。
type fixture struct {
	t      *testing.T
	srv    *httptest.Server
	mu     sync.Mutex
	files  map[string][]byte
	hits   map[string]int
	layout platform.Layout
}

const plat = release.DarwinARM64

// macYtDlpZip 模擬 yt-dlp_macos.zip（未封裝版本）。
func macYtDlpZip(t *testing.T, version string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range map[string]string{"yt-dlp_macos": "yt " + version, "_internal/Python.framework/Versions/3.14/Python": "python"} {
		h := &zip.FileHeader{Name: name, Method: zip.Deflate}
		h.SetMode(0o755)
		w, _ := zw.CreateHeader(h)
		w.Write([]byte(content))
	}
	zw.Close()
	return buf.Bytes()
}

// publishYtDlp 讓假伺服器的 yt-dlp latest 提供 version 的 yt-dlp_macos.zip 與 SHA2-256SUMS。
func (f *fixture) publishYtDlp(version string) string {
	z := macYtDlpZip(f.t, version)
	sum := release.HashBytes(z)
	f.set("/yt-dlp/latest/yt-dlp_macos.zip", z)
	f.set("/yt-dlp/latest/SHA2-256SUMS", []byte(sum+"  yt-dlp_macos.zip\n"))
	return sum
}

func (f *fixture) macYtDlp() string { return filepath.Join(f.layout.BinDir, "yt-dlp", "yt-dlp_macos") }

// newFixture 是 macOS 的環境：yt-dlp 是 2026.10.21 的未封裝版本，latest 是 2026.11.01。
func newFixture(t *testing.T) *fixture {
	f := newFixtureFor(t, "darwin")
	os.MkdirAll(filepath.Dir(f.macYtDlp()), 0o755)
	os.WriteFile(f.macYtDlp(), []byte("yt 2026.10.21"), 0o755)
	st := installer.LoadState(f.layout.InstallDir)
	st.Archives["yt-dlp"] = release.HashBytes(macYtDlpZip(t, "2026.10.21"))
	st.Save(f.layout.InstallDir)
	f.publishYtDlp("2026.11.01")
	return f
}

// newFixtureFor 建立 goos 的環境：小幫手 0.1.0、deno 2.9.7、ffmpeg 9.0.2（yt-dlp 由呼叫端放入），
// 清單提供小幫手 0.2.0 與 deno 2.9.8。
func newFixtureFor(t *testing.T, goos string) *fixture {
	f := &fixture{t: t, files: map[string][]byte{}, hits: map[string]int{}}
	f.srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.hits[r.URL.Path]++
		b, ok := f.files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write(b)
	}))
	t.Cleanup(f.srv.Close)
	f.layout = platform.LayoutFor(goos, t.TempDir(), nil)
	os.MkdirAll(f.layout.BinDir, 0o755)
	os.WriteFile(f.layout.HelperPath, []byte("helper 0.1.0"), 0o755)
	for name, content := range map[string]string{"deno": "deno 2.9.7", "ffmpeg": "ff 9.0.2", "ffprobe": "fp 9.0.2"} {
		os.WriteFile(filepath.Join(f.layout.BinDir, name), []byte(content), 0o755)
	}
	st := installer.LoadState(f.layout.InstallDir)
	st.Tools = map[string]string{"yt-dlp": "2026.10.21", "deno": "2.9.7", "ffmpeg": "9.0.2"}
	st.Save(f.layout.InstallDir)

	f.set("/helper", []byte("helper 0.2.0"))
	f.set("/yt-dlp", []byte("yt new"))
	f.set("/yt-dlp_macos.zip", macYtDlpZip(t, "2026.11.01"))
	f.set("/deno.zip", makeZip(t, "deno", "deno 2.9.8"))
	f.set("/ffmpeg.zip", makeZip(t, "ffmpeg", "ff new"))
	f.set("/ffprobe.zip", makeZip(t, "ffprobe", "fp new"))
	f.publish(f.manifest("0.2.0"))
	return f
}

func (f *fixture) set(p string, b []byte) {
	f.mu.Lock()
	f.files[p] = b
	f.mu.Unlock()
}

func (f *fixture) hit(p string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[p]
}

func (f *fixture) sum(p string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return release.HashBytes(f.files[p])
}

func (f *fixture) manifest(version string) *release.Manifest {
	u := func(p string) string { return f.srv.URL + p }
	m := &release.Manifest{Schema: 1, Version: version, Helper: map[string]release.Asset{}, Tools: map[string]release.Tool{}}
	yt := release.Tool{Version: "2026.11.01", Platforms: map[string]release.Platform{}}
	dn := release.Tool{Version: "2.9.8", Platforms: map[string]release.Platform{}}
	ff := release.Tool{Version: "9.0.2", Platforms: map[string]release.Platform{}}
	for _, p := range release.Platforms {
		m.Helper[p] = release.Asset{URL: u("/helper"), SHA256: f.sum("/helper")}
		yt.Platforms[p] = release.Platform{Files: []release.File{{URL: u("/yt-dlp"), SHA256: f.sum("/yt-dlp"), Name: release.ExeName("yt-dlp", p)}}}
		if release.UnpackedExe(release.ToolYtDlp, p) != "" {
			yt.Platforms[p] = release.Platform{Files: []release.File{{URL: u("/yt-dlp_macos.zip"), SHA256: f.sum("/yt-dlp_macos.zip"), Archive: "zip", Extract: []string{"yt-dlp"}}}}
		}
		dn.Platforms[p] = release.Platform{Files: []release.File{{URL: u("/deno.zip"), SHA256: f.sum("/deno.zip"), Archive: "zip", Extract: []string{release.ExeName("deno", p)}}}}
		ff.Platforms[p] = release.Platform{Files: []release.File{
			{URL: u("/ffmpeg.zip"), SHA256: f.sum("/ffmpeg.zip"), Archive: "zip", Extract: []string{release.ExeName("ffmpeg", p)}},
			{URL: u("/ffprobe.zip"), SHA256: f.sum("/ffprobe.zip"), Archive: "zip", Extract: []string{release.ExeName("ffprobe", p)}},
		}}
	}
	m.Tools[release.ToolYtDlp], m.Tools[release.ToolDeno], m.Tools[release.ToolFFmpeg] = yt, dn, ff
	return m
}

func (f *fixture) publish(m *release.Manifest) {
	b, err := m.Marshal()
	if err != nil {
		f.t.Fatal(err)
	}
	f.set("/latest/components.json", b)
}

func (f *fixture) updater(active func() int, ytdlp func(context.Context, string) (bool, error)) *Updater {
	su, _ := url.Parse(f.srv.URL)
	return &Updater{
		Layout: f.layout, Platform: plat, Version: "0.1.0", SelfPath: f.layout.HelperPath,
		ManifestBase:  f.srv.URL + "/latest/",
		ManifestAllow: func(x *url.URL) bool { return x.Host == su.Host && strings.HasPrefix(x.Path, "/latest/") },
		Fetcher:       &release.Fetcher{Client: f.srv.Client(), Allow: func(x *url.URL) bool { return x.Host == su.Host }},
		ActiveJobs:    active,
		UpdateYtDlp:   ytdlp,
		YtDlpBase:     f.srv.URL + "/yt-dlp/latest/",
		PollEvery:     5 * time.Millisecond,
	}
}

// noYtDlpU 是 macOS 上不該被呼叫的 yt-dlp -U。
func noYtDlpU(t *testing.T) func(context.Context, string) (bool, error) {
	return func(context.Context, string) (bool, error) {
		t.Error("yt-dlp -U was used on macOS")
		return false, nil
	}
}

func read(t *testing.T, p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestRunUpdatesEverythingAfterDownloadsFinish(t *testing.T) {
	f := newFixture(t)
	var polls atomic.Int32
	active := func() int {
		if polls.Add(1) <= 3 {
			// 前三次檢查時還有下載在進行：這段期間不能替換任何東西。
			if read(t, filepath.Join(f.layout.BinDir, "deno")) != "deno 2.9.7" || read(t, f.layout.HelperPath) != "helper 0.1.0" || read(t, f.macYtDlp()) != "yt 2026.10.21" {
				t.Error("replaced while a download was running")
			}
			return 1
		}
		return 0
	}
	result, err := f.updater(active, noYtDlpU(t)).Run(context.Background())
	if err != nil || result != ResultUpdated {
		t.Fatalf("result %q, err %v", result, err)
	}
	if polls.Load() < 4 {
		t.Errorf("polls %d", polls.Load())
	}
	if read(t, filepath.Join(f.layout.BinDir, "deno")) != "deno 2.9.8" {
		t.Error("deno not updated")
	}
	if read(t, f.layout.HelperPath) != "helper 0.2.0" {
		t.Error("helper not updated")
	}
	// macOS 的 yt-dlp 從 yt-dlp 的 latest 更新（008 FR-20），不從清單下載；ffmpeg 版本相同不下載。
	if read(t, f.macYtDlp()) != "yt 2026.11.01" || read(t, filepath.Join(f.layout.BinDir, "yt-dlp", "_internal", "Python.framework", "Versions", "3.14", "Python")) != "python" {
		t.Error("yt-dlp not updated")
	}
	if f.hit("/yt-dlp_macos.zip") != 0 || f.hit("/ffmpeg.zip") != 0 || read(t, filepath.Join(f.layout.BinDir, "ffmpeg")) != "ff 9.0.2" {
		t.Error("yt-dlp or ffmpeg was replaced from the manifest")
	}
	s := Load(f.layout.InstallDir)
	if s.LastResult != ResultUpdated || s.ConsecutiveFailures != 0 || s.LastCheck == nil || strings.Join(s.Updated, ",") != "yt-dlp,deno,helper" {
		t.Errorf("state: %+v", s)
	}
	if installer.LoadState(f.layout.InstallDir).Tools["deno"] != "2.9.8" {
		t.Error("install state not updated")
	}
	if Running(f.layout.InstallDir) {
		t.Error("lock left behind")
	}

	// 再執行一次：沒有需要更新的（yt-dlp 已是最新，只下載 SHA2-256SUMS）。
	result, err = f.updater(func() int { return 0 }, noYtDlpU(t)).Run(context.Background())
	if err != nil || result != ResultOK {
		t.Fatalf("second run: %q %v", result, err)
	}
	if f.hit("/yt-dlp/latest/yt-dlp_macos.zip") != 1 || f.hit("/yt-dlp/latest/SHA2-256SUMS") != 2 {
		t.Errorf("yt-dlp zip %d, sums %d", f.hit("/yt-dlp/latest/yt-dlp_macos.zip"), f.hit("/yt-dlp/latest/SHA2-256SUMS"))
	}
}

// TestRunReplacesSingleFileYtDlp：v0.1.0 安裝的單一執行檔在自動更新時改成未封裝版本（008 FR-15a），
// 並遞迴移除隔離屬性（FR-15b，以 macOS 的 Layout 測試，實際的屬性處理只在 macOS 上有作用）。
func TestRunReplacesSingleFileYtDlp(t *testing.T) {
	f := newFixtureFor(t, "darwin")
	f.publishYtDlp("2026.11.01")
	legacy := filepath.Join(f.layout.BinDir, "yt-dlp")
	os.WriteFile(legacy, []byte("single-file yt-dlp"), 0o755)
	result, err := f.updater(func() int { return 0 }, noYtDlpU(t)).Run(context.Background())
	if err != nil || result != ResultUpdated {
		t.Fatalf("%q %v", result, err)
	}
	if read(t, f.macYtDlp()) != "yt 2026.11.01" || installer.LegacyMacYtDlp(f.layout) {
		t.Fatal("single-file yt-dlp not replaced")
	}
	entries, _ := os.ReadDir(f.layout.BinDir)
	for _, en := range entries {
		if strings.Contains(en.Name(), ".old") || strings.HasPrefix(en.Name(), ".download-") {
			t.Errorf("left behind: %s", en.Name())
		}
	}
	if s := Load(f.layout.InstallDir); !strings.Contains(strings.Join(s.Updated, ","), "yt-dlp") {
		t.Errorf("state: %+v", s)
	}
	// yt-dlp 的下載失敗：其他元件照常，結果為失敗，舊檔保留。
	g := newFixtureFor(t, "darwin")
	os.WriteFile(filepath.Join(g.layout.BinDir, "yt-dlp"), []byte("single-file yt-dlp"), 0o755)
	result, err = g.updater(func() int { return 0 }, noYtDlpU(t)).Run(context.Background())
	if result != ResultFailed || errs.From(err).Code != errs.Network {
		t.Fatalf("missing latest: %q %v", result, err)
	}
	if read(t, filepath.Join(g.layout.BinDir, "yt-dlp")) != "single-file yt-dlp" || read(t, g.layout.HelperPath) != "helper 0.2.0" {
		t.Error("wrong files after a failed yt-dlp update")
	}
}

// TestRunUsesYtDlpUpdateOutsideMacOS：Windows（以 Linux 的 Layout 代替）使用 yt-dlp -U，不連到 yt-dlp 的 latest。
func TestRunUsesYtDlpUpdateOutsideMacOS(t *testing.T) {
	f := newFixtureFor(t, "linux")
	f.publishYtDlp("2026.11.01")
	yt := filepath.Join(f.layout.BinDir, "yt-dlp")
	os.WriteFile(yt, []byte("yt"), 0o755)
	var calls atomic.Int32
	u := f.updater(func() int { return 0 }, func(_ context.Context, p string) (bool, error) {
		calls.Add(1)
		if p != yt {
			t.Errorf("yt-dlp -U on %s", p)
		}
		return true, nil
	})
	if result, err := u.Run(context.Background()); err != nil || result != ResultUpdated {
		t.Fatalf("%q %v", result, err)
	}
	if calls.Load() != 1 || f.hit("/yt-dlp/latest/SHA2-256SUMS") != 0 {
		t.Errorf("yt-dlp -U %d, sums %d", calls.Load(), f.hit("/yt-dlp/latest/SHA2-256SUMS"))
	}
}

func TestRunFailuresAreCountedAndKeepOldVersions(t *testing.T) {
	f := newFixture(t)
	noJobs := func() int { return 0 }
	// 清單格式不正確：什麼都不下載、不替換。
	f.set("/latest/components.json", []byte(`{"schema": 1, "version": "0.2.0", "unexpected": true}`))
	for i := 1; i <= 3; i++ {
		result, err := f.updater(noJobs, nil).Run(context.Background())
		if result != ResultFailed || errs.From(err).Code != errs.ManifestInvalid {
			t.Fatalf("run %d: %q %v", i, result, err)
		}
		if s := Load(f.layout.InstallDir); s.ConsecutiveFailures != i || s.LastError != "MANIFEST_INVALID" {
			t.Fatalf("run %d state: %+v", i, s)
		}
	}
	if f.hit("/deno.zip") != 0 || f.hit("/helper") != 0 {
		t.Error("downloaded with an invalid manifest")
	}
	if ViewOf(f.layout.InstallDir).ConsecutiveFailures != 3 {
		t.Error("view")
	}

	// 清單正確但 deno 的檔案被竄改：deno 保留舊版本，其他元件照常更新，結果為失敗。
	f.publish(f.manifest("0.2.0"))
	f.set("/deno.zip", makeZip(t, "deno", "evil"))
	result, err := f.updater(noJobs, nil).Run(context.Background())
	if result != ResultFailed || errs.From(err).Code != errs.ChecksumMismatch {
		t.Fatalf("tampered deno: %q %v", result, err)
	}
	if read(t, filepath.Join(f.layout.BinDir, "deno")) != "deno 2.9.7" || read(t, f.layout.HelperPath) != "helper 0.2.0" {
		t.Error("tampered deno: wrong files")
	}
	if Load(f.layout.InstallDir).ConsecutiveFailures != 4 {
		t.Error("failures not counted")
	}

	// 恢復正常後歸零。
	f.set("/deno.zip", makeZip(t, "deno", "deno 2.9.8"))
	f.publish(f.manifest("0.2.0"))
	if result, err := f.updater(noJobs, nil).Run(context.Background()); err != nil || result != ResultUpdated {
		t.Fatalf("recovered: %q %v", result, err)
	}
	if s := Load(f.layout.InstallDir); s.ConsecutiveFailures != 0 || s.LastError != "" {
		t.Errorf("state after recovery: %+v", s)
	}
}

func TestRunWaitsAtMostMaxWait(t *testing.T) {
	f := newFixture(t)
	u := f.updater(func() int { return 1 }, nil)
	u.MaxWait = 30 * time.Millisecond
	result, err := u.Run(context.Background())
	if result != ResultFailed || errs.From(err).Code != errs.Timeout {
		t.Fatalf("%q %v", result, err)
	}
	if read(t, filepath.Join(f.layout.BinDir, "deno")) != "deno 2.9.7" || read(t, f.layout.HelperPath) != "helper 0.1.0" {
		t.Error("replaced although downloads never finished")
	}
}

func TestRunSkipsWhatIsNotOurs(t *testing.T) {
	f := newFixture(t)
	// yt-dlp、deno 不在安裝資料夾（例如手動安裝、使用 Homebrew 的版本）：不碰。
	os.RemoveAll(filepath.Join(f.layout.BinDir, "yt-dlp"))
	os.Remove(filepath.Join(f.layout.BinDir, "deno"))
	called := false
	u := f.updater(func() int { return 0 }, func(context.Context, string) (bool, error) { called = true; return true, nil })
	// 開發版：不更新小幫手。
	u.Version = "dev"
	result, err := u.Run(context.Background())
	if err != nil || result != ResultOK || called || f.hit("/deno.zip") != 0 || f.hit("/helper") != 0 || f.hit("/yt-dlp/latest/SHA2-256SUMS") != 0 {
		t.Fatalf("%q %v called=%v deno=%d helper=%d yt-dlp=%d", result, err, called, f.hit("/deno.zip"), f.hit("/helper"), f.hit("/yt-dlp/latest/SHA2-256SUMS"))
	}
	// 不是從安裝資料夾執行的小幫手：不更新小幫手。
	u.Version = "0.1.0"
	u.SelfPath = filepath.Join(t.TempDir(), "ytm-host")
	if _, err := u.Run(context.Background()); err != nil || f.hit("/helper") != 0 {
		t.Fatalf("not installed helper was updated: %v", err)
	}
	// 另一個更新正在執行：不做任何事。
	unlock, _ := Lock(f.layout.InstallDir)
	defer unlock()
	if _, err := u.Run(context.Background()); !errors.Is(err, ErrLocked) {
		t.Fatalf("locked: %v", err)
	}
}
