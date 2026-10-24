package installer

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
)

func TestMain(m *testing.M) { testenv.Main(m) }

// makeZip 建立 zip：entries 是「壓縮檔中的路徑 → 內容」。
func makeZip(t testing.TB, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range entries {
		h := &zip.FileHeader{Name: name, Method: zip.Deflate}
		h.SetMode(0o755)
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(content))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// fakeServer 模擬 GitHub 與 ffmpeg 網站：files 是「路徑 → 內容」，fail 中的路徑回 500。
type fakeServer struct {
	*httptest.Server
	mu    sync.Mutex
	files map[string][]byte
	fail  map[string]bool
	hits  map[string]int
	// before 在處理每個請求之前呼叫（可為 nil）。
	before func(path string)
}

func newFakeServer(t *testing.T) *fakeServer {
	fs := &fakeServer{files: map[string][]byte{}, fail: map[string]bool{}, hits: map[string]int{}}
	fs.Server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fs.before != nil {
			fs.before(r.URL.Path)
		}
		fs.mu.Lock()
		defer fs.mu.Unlock()
		fs.hits[r.URL.Path]++
		if fs.fail[r.URL.Path] {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		b, ok := fs.files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write(b)
	}))
	t.Cleanup(fs.Close)
	return fs
}

func (fs *fakeServer) set(path string, b []byte) {
	fs.mu.Lock()
	fs.files[path] = b
	fs.mu.Unlock()
}

func (fs *fakeServer) setFail(path string, v bool) {
	fs.mu.Lock()
	fs.fail[path] = v
	fs.mu.Unlock()
}

func (fs *fakeServer) hit(path string) int {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	return fs.hits[path]
}

func (fs *fakeServer) totalHits() int {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	n := 0
	for _, v := range fs.hits {
		n += v
	}
	return n
}

func (fs *fakeServer) fetcher() *release.Fetcher {
	u, _ := url.Parse(fs.URL)
	return &release.Fetcher{Client: fs.Client(), Allow: func(x *url.URL) bool { return x.Scheme == "https" && x.Host == u.Host }}
}

// env 是一次測試的環境：假伺服器、假的家目錄。
type env struct {
	t      *testing.T
	srv    *fakeServer
	home   string
	layout platform.Layout
	out    *bytes.Buffer
	m      *release.Manifest
	helper []byte
}

const testPlatform = release.DarwinARM64

func newEnv(t *testing.T) *env {
	home := t.TempDir()
	e := &env{t: t, srv: newFakeServer(t), home: home,
		layout: platform.LayoutFor("darwin", home, nil), out: &bytes.Buffer{}, helper: []byte("helper v0.2.0")}
	e.srv.set("/helper", e.helper)
	e.srv.set("/yt-dlp_macos", []byte("#!yt-dlp"))
	e.srv.set("/deno.zip", makeZip(t, map[string]string{"deno": "deno-2.9.8"}))
	e.srv.set("/ffmpeg.zip", makeZip(t, map[string]string{"ffmpeg": "ffmpeg-9"}))
	e.srv.set("/ffprobe.zip", makeZip(t, map[string]string{"ffprobe": "ffprobe-9"}))
	e.m = e.manifest("2.9.8", "9.0.2")
	return e
}

func (e *env) url(p string) string { return e.srv.URL + p }

func (e *env) sum(p string) string {
	e.srv.mu.Lock()
	defer e.srv.mu.Unlock()
	return release.HashBytes(e.srv.files[p])
}

// manifest 建立指向假伺服器的清單（所有平台使用同一組檔案，只測 darwin-arm64）。
func (e *env) manifest(denoVersion, ffVersion string) *release.Manifest {
	m := &release.Manifest{Schema: 1, Version: "0.2.0", Helper: map[string]release.Asset{}, Tools: map[string]release.Tool{}}
	yt := release.Tool{Version: "2026.10.21", Platforms: map[string]release.Platform{}}
	dn := release.Tool{Version: denoVersion, Platforms: map[string]release.Platform{}}
	ff := release.Tool{Version: ffVersion, Platforms: map[string]release.Platform{}}
	for _, p := range release.Platforms {
		m.Helper[p] = release.Asset{URL: e.url("/helper"), SHA256: e.sum("/helper")}
		yt.Platforms[p] = release.Platform{Files: []release.File{{URL: e.url("/yt-dlp_macos"), SHA256: e.sum("/yt-dlp_macos"), Name: release.ExeName("yt-dlp", p)}}}
		dn.Platforms[p] = release.Platform{Files: []release.File{{URL: e.url("/deno.zip"), SHA256: e.sum("/deno.zip"), Archive: "zip", Extract: []string{release.ExeName("deno", p)}}}}
		ff.Platforms[p] = release.Platform{Files: []release.File{
			{URL: e.url("/ffmpeg.zip"), SHA256: e.sum("/ffmpeg.zip"), Archive: "zip", Extract: []string{release.ExeName("ffmpeg", p)}},
			{URL: e.url("/ffprobe.zip"), SHA256: e.sum("/ffprobe.zip"), Archive: "zip", Extract: []string{release.ExeName("ffprobe", p)}},
		}}
	}
	m.Tools[release.ToolYtDlp], m.Tools[release.ToolDeno], m.Tools[release.ToolFFmpeg] = yt, dn, ff
	return m
}

func (e *env) marshal(m *release.Manifest) []byte {
	b, err := m.Marshal()
	if err != nil {
		e.t.Fatal(err)
	}
	return b
}

func (e *env) installer() *Installer {
	return &Installer{
		Layout: e.layout, Platform: testPlatform, Version: "0.2.0",
		Fetcher: e.srv.fetcher(), ManifestAllow: e.srv.fetcher().Allow, Out: e.out,
		FindSystem: func(string) string { return "" },
	}
}

func (e *env) install(in *Installer, m *release.Manifest) error {
	return in.Install(context.Background(), e.marshal(m))
}

func readFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return string(b)
}

func code(err error) errs.Code { return errs.From(err).Code }

// noStaging 確認沒有留下 .download-* 暫存資料夾。
func noStaging(t *testing.T, dirs ...string) {
	t.Helper()
	for _, d := range dirs {
		entries, _ := os.ReadDir(d)
		for _, en := range entries {
			if strings.HasPrefix(en.Name(), ".download-") {
				t.Errorf("staging folder left behind: %s", filepath.Join(d, en.Name()))
			}
		}
	}
}

func TestInstallFreshAndRepeat(t *testing.T) {
	e := newEnv(t)
	if err := e.install(e.installer(), e.m); err != nil {
		t.Fatalf("install: %v\n%s", err, e.out)
	}
	bin := e.layout.BinDir
	want := map[string]string{"yt-dlp": "#!yt-dlp", "deno": "deno-2.9.8", "ffmpeg": "ffmpeg-9", "ffprobe": "ffprobe-9"}
	for name, content := range want {
		p := filepath.Join(bin, name)
		if got := readFile(t, p); got != content {
			t.Errorf("%s = %q", name, got)
		}
		if st, _ := os.Stat(p); st.Mode().Perm()&0o111 == 0 {
			t.Errorf("%s is not executable: %v", name, st.Mode())
		}
	}
	if got := readFile(t, e.layout.HelperPath); got != string(e.helper) {
		t.Errorf("helper = %q", got)
	}
	// 註冊：Chrome 與 Firefox 的設定檔指向安裝資料夾中的小幫手。
	for _, loc := range e.layout.Manifests {
		var nm map[string]any
		if err := json.Unmarshal([]byte(readFile(t, loc.Path)), &nm); err != nil {
			t.Fatal(err)
		}
		if nm["path"] != e.layout.HelperPath || nm["name"] != platform.NativeHostName {
			t.Errorf("%s: %v", loc.Path, nm)
		}
	}
	st := LoadState(e.layout.InstallDir)
	if st.Tools["deno"] != "2.9.8" || st.Tools["ffmpeg"] != "9.0.2" || st.Tools["yt-dlp"] != "2026.10.21" {
		t.Errorf("state: %v", st.Tools)
	}
	out := e.out.String()
	for _, s := range []string{"[1/5]", "[5/5]", "完成！回到瀏覽器即可下載", "Done!", e.url("/deno.zip")} {
		if !strings.Contains(out, s) {
			t.Errorf("output does not contain %q:\n%s", s, out)
		}
	}
	noStaging(t, bin, e.layout.InstallDir)

	// 第二次：全部略過，不再下載任何檔案（FR-13）。
	before := e.srv.totalHits()
	e.out.Reset()
	if err := e.install(e.installer(), e.m); err != nil {
		t.Fatalf("second install: %v", err)
	}
	if e.srv.totalHits() != before {
		t.Errorf("second install downloaded %d files", e.srv.totalHits()-before)
	}
	if strings.Count(e.out.String(), "略過") != 4 {
		t.Errorf("expected 4 skipped steps:\n%s", e.out)
	}

	// 清單中的 deno 版本改變：只重新下載 deno（yt-dlp 由自己更新，不覆蓋）。
	e.srv.set("/deno.zip", makeZip(t, map[string]string{"deno": "deno-2.9.9"}))
	m2 := e.manifest("2.9.9", "9.0.2")
	if err := e.install(e.installer(), m2); err != nil {
		t.Fatal(err)
	}
	if readFile(t, filepath.Join(bin, "deno")) != "deno-2.9.9" || e.srv.hit("/yt-dlp_macos") != 1 || e.srv.hit("/ffmpeg.zip") != 1 {
		t.Errorf("deno update: deno=%q yt-dlp hits=%d ffmpeg hits=%d", readFile(t, filepath.Join(bin, "deno")), e.srv.hit("/yt-dlp_macos"), e.srv.hit("/ffmpeg.zip"))
	}
}

// TestInstallDownloadsToolsTogether 確認 yt-dlp、deno、ffmpeg 同時下載，安裝與輸出仍依步驟順序。
func TestInstallDownloadsToolsTogether(t *testing.T) {
	e := newEnv(t)
	others := make(chan string, 10)
	e.srv.before = func(p string) {
		switch p {
		case "/deno.zip", "/ffmpeg.zip":
			others <- p
		case "/yt-dlp_macos":
			// yt-dlp 的下載等到 deno 與 ffmpeg 也開始下載才回應。
			seen := map[string]bool{}
			timeout := time.After(10 * time.Second)
			for len(seen) < 2 {
				select {
				case p := <-others:
					seen[p] = true
				case <-timeout:
					t.Error("deno and ffmpeg did not start downloading while yt-dlp was downloading")
					return
				}
			}
		}
	}
	if err := e.install(e.installer(), e.m); err != nil {
		t.Fatalf("install: %v\n%s", err, e.out)
	}
	out := e.out.String()
	pos := 0
	for _, s := range []string{"[1/5]", e.url("/helper"), "[2/5]", e.url("/yt-dlp_macos"), "Installed 2026.10.21", "[3/5]", e.url("/deno.zip"), "Installed 2.9.8",
		"[4/5]", e.url("/ffmpeg.zip"), e.url("/ffprobe.zip"), "Installed 9.0.2", "[5/5]", "Done!"} {
		i := strings.Index(out[pos:], s)
		if i < 0 {
			t.Fatalf("output does not contain %q after position %d:\n%s", s, pos, out)
		}
		pos += i + len(s)
	}
	noStaging(t, e.layout.BinDir)
}

// TestInstallFailureOutput 確認某個檔案下載失敗時，不會印出同一個工具下一個檔案的來源。
func TestInstallFailureOutput(t *testing.T) {
	e := newEnv(t)
	e.srv.setFail("/ffmpeg.zip", true)
	if err := e.install(e.installer(), e.m); code(err) != errs.Network {
		t.Fatalf("got %v, want NETWORK", err)
	}
	out := e.out.String()
	if !strings.Contains(out, e.url("/ffmpeg.zip")) || strings.Contains(out, e.url("/ffprobe.zip")) || !strings.Contains(out, "Installed 2.9.8") {
		t.Errorf("output:\n%s", out)
	}
	noStaging(t, e.layout.BinDir)
}

func TestInstallUsesSelfWhenItMatches(t *testing.T) {
	e := newEnv(t)
	self := filepath.Join(t.TempDir(), "ytm-host-darwin-arm64")
	os.WriteFile(self, e.helper, 0o755)
	in := e.installer()
	in.SelfPath = self
	if err := e.install(in, e.m); err != nil {
		t.Fatal(err)
	}
	if e.srv.hit("/helper") != 0 {
		t.Error("helper was downloaded although the running helper matches the manifest")
	}
	if readFile(t, e.layout.HelperPath) != string(e.helper) {
		t.Error("helper not copied")
	}
}

func TestInstallResumesAfterFailure(t *testing.T) {
	e := newEnv(t)
	e.srv.setFail("/deno.zip", true)
	err := e.install(e.installer(), e.m)
	if code(err) != errs.Network {
		t.Fatalf("got %v, want NETWORK", err)
	}
	if _, err := os.Stat(filepath.Join(e.layout.BinDir, "yt-dlp")); err != nil {
		t.Error("yt-dlp should be installed before the failure")
	}
	if _, err := os.Stat(filepath.Join(e.layout.BinDir, "ffmpeg")); err == nil {
		t.Error("ffmpeg should not be installed after the failure")
	}
	noStaging(t, e.layout.BinDir)
	var buf bytes.Buffer
	PrintFailure(&buf, err)
	if !strings.Contains(buf.String(), "再執行一次同一個指令") || !strings.Contains(buf.String(), "網路") {
		t.Errorf("failure message:\n%s", buf.String())
	}

	e.srv.setFail("/deno.zip", false)
	if err := e.install(e.installer(), e.m); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if e.srv.hit("/yt-dlp_macos") != 1 || e.srv.hit("/helper") != 1 {
		t.Errorf("second run downloaded again: yt-dlp %d, helper %d", e.srv.hit("/yt-dlp_macos"), e.srv.hit("/helper"))
	}
	for _, n := range []string{"deno", "ffmpeg", "ffprobe"} {
		if _, err := os.Stat(filepath.Join(e.layout.BinDir, n)); err != nil {
			t.Errorf("%s missing after the second run", n)
		}
	}
}

func TestInstallChecksumMismatch(t *testing.T) {
	e := newEnv(t)
	// 先完整安裝一次，再讓伺服器的 deno 被竄改：舊版本必須保留（SR-2）。
	if err := e.install(e.installer(), e.m); err != nil {
		t.Fatal(err)
	}
	m2 := e.manifest("2.9.9", "9.0.2")
	e.srv.set("/deno.zip", makeZip(t, map[string]string{"deno": "evil"}))
	err := e.install(e.installer(), m2)
	if code(err) != errs.ChecksumMismatch {
		t.Fatalf("got %v, want CHECKSUM_MISMATCH", err)
	}
	if readFile(t, filepath.Join(e.layout.BinDir, "deno")) != "deno-2.9.8" {
		t.Error("the old deno was not kept")
	}
	noStaging(t, e.layout.BinDir)

	// 小幫手被竄改：拒絕安裝。
	e2 := newEnv(t)
	e2.srv.set("/helper", []byte("tampered helper"))
	if err := e2.install(e2.installer(), e2.m); code(err) != errs.ChecksumMismatch {
		t.Fatalf("tampered helper: got %v", err)
	}
	if _, err := os.Stat(e2.layout.HelperPath); err == nil {
		t.Error("tampered helper was installed")
	}
}

// TestInstallRejectsInvalidManifest：格式不正確、網址不在允許範圍的清單一律拒絕，什麼都不下載（008 SR-2）。
func TestInstallRejectsInvalidManifest(t *testing.T) {
	e := newEnv(t)
	good := e.marshal(e.m)
	bad := [][]byte{
		bytes.Replace(good, []byte(`"schema": 1,`), []byte(`"schema": 1, "extra": true,`), 1),
		bytes.Replace(good, []byte(e.sum("/helper")), []byte("abc"), 1),
		good[:len(good)/2],
		[]byte("not json"),
	}
	for i, b := range bad {
		if err := e.installer().Install(context.Background(), b); code(err) != errs.ManifestInvalid {
			t.Fatalf("case %d: got %v, want MANIFEST_INVALID", i, err)
		}
	}
	// 網址指向允許範圍以外（正式環境的檢查）的清單。
	in := e.installer()
	in.Fetcher = in.Fetcher.WithAllow(release.AllowedURL)
	if err := in.Install(context.Background(), good); code(err) != errs.ManifestInvalid {
		t.Fatalf("manifest with local URLs under the production check: %v", err)
	}
	if e.srv.totalHits() != 0 {
		t.Errorf("downloaded %d files with an invalid manifest", e.srv.totalHits())
	}
	if _, err := os.Stat(e.layout.HelperPath); err == nil {
		t.Error("something was installed")
	}
	var buf bytes.Buffer
	PrintFailure(&buf, errs.New(errs.ManifestInvalid, "x"))
	if !strings.Contains(buf.String(), "GitHub") {
		t.Errorf("failure message:\n%s", buf.String())
	}
}

// TestInstallFetchesLatestManifest：沒有 --manifest 時從本專案 GitHub 下載清單；清單網址或
// 轉址目的地不在允許範圍時拒絕（MANIFEST_INVALID）。
func TestInstallFetchesLatestManifest(t *testing.T) {
	e := newEnv(t)
	e.srv.set("/latest/components.json", e.marshal(e.m))
	in := e.installer()
	in.ManifestBase = e.url("/latest/")
	if err := in.Install(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	// 只允許 /latest/ 下的清單（模擬「只接受本專案的 Release」）；轉址到其他路徑時拒絕。
	in.ManifestAllow = func(u *url.URL) bool { return strings.HasPrefix(u.Path, "/latest/") }
	other := newFakeServer(t)
	other.set("/components.json", e.marshal(e.m))
	e.srv.mu.Lock()
	delete(e.srv.files, "/latest/components.json")
	e.srv.mu.Unlock()
	redirect := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/components.json", http.StatusFound)
	}))
	defer redirect.Close()
	in.ManifestBase = redirect.URL + "/latest/"
	in.Fetcher = &release.Fetcher{Client: redirect.Client(), Allow: func(*url.URL) bool { return true }}
	if err := in.Install(context.Background(), nil); code(err) != errs.ManifestInvalid {
		t.Fatalf("redirect to another location: %v", err)
	}
	if other.hit("/components.json") != 0 {
		t.Error("followed a redirect to a location that is not allowed")
	}
}

func TestInstallSkipsFFmpegWhenPresent(t *testing.T) {
	e := newEnv(t)
	in := e.installer()
	in.FindSystem = func(tool string) string { return "/opt/homebrew/bin/" + tool }
	if err := e.install(in, e.m); err != nil {
		t.Fatal(err)
	}
	if e.srv.hit("/ffmpeg.zip") != 0 || e.srv.hit("/ffprobe.zip") != 0 {
		t.Error("ffmpeg was downloaded although the system has it")
	}
	if !strings.Contains(e.out.String(), "/opt/homebrew/bin/ffmpeg") {
		t.Errorf("output:\n%s", e.out)
	}
	// 只有 ffmpeg 沒有 ffprobe：仍然下載。
	e2 := newEnv(t)
	in2 := e2.installer()
	in2.FindSystem = func(tool string) string {
		if tool == "ffmpeg" {
			return "/usr/local/bin/ffmpeg"
		}
		return ""
	}
	if err := e2.install(in2, e2.m); err != nil {
		t.Fatal(err)
	}
	if e2.srv.hit("/ffprobe.zip") != 1 {
		t.Error("ffprobe should be downloaded")
	}
}

func TestExtractZipPathTraversal(t *testing.T) {
	root := t.TempDir()
	out := filepath.Join(root, "a", "b", "out")
	os.MkdirAll(out, 0o755)
	zp := filepath.Join(root, "evil.zip")
	os.WriteFile(zp, makeZip(t, map[string]string{
		"../../evil":         "x",
		"../deno":            "x",
		"/abs/deno":          "x",
		`..\..\deno`:         "x",
		"C:/deno":            "x",
		"ok/../../../ffmpeg": "x",
	}), 0o644)
	err := ExtractZip(zp, out, []string{"deno"})
	if err == nil {
		t.Fatal("unsafe entries were accepted")
	}
	filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && p != zp {
			t.Errorf("file written: %s", p)
		}
		return nil
	})
	// 正常的巢狀路徑（FFmpeg-Builds：ffmpeg-…/bin/ffmpeg.exe）只取檔名，不建立子資料夾。
	zp2 := filepath.Join(root, "ok.zip")
	os.WriteFile(zp2, makeZip(t, map[string]string{
		"ffmpeg-N-1-win64-gpl/bin/ffmpeg.exe":  "ff",
		"ffmpeg-N-1-win64-gpl/bin/FFPROBE.EXE": "fp",
		"ffmpeg-N-1-win64-gpl/bin/ffplay.exe":  "no",
		"ffmpeg-N-1-win64-gpl/doc/readme.txt":  "no",
	}), 0o644)
	if err := ExtractZip(zp2, out, []string{"ffmpeg.exe", "ffprobe.exe"}); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(out)
	if len(entries) != 2 || readFile(t, filepath.Join(out, "ffmpeg.exe")) != "ff" || readFile(t, filepath.Join(out, "ffprobe.exe")) != "fp" {
		t.Fatalf("unexpected extraction: %v", entries)
	}
	// 不是 zip。
	os.WriteFile(zp, []byte("not a zip"), 0o644)
	if err := ExtractZip(zp, out, []string{"deno"}); code(err) != errs.ChecksumMismatch {
		t.Fatalf("not a zip: %v", err)
	}
}

func TestInstallRejectsUnsafeArchive(t *testing.T) {
	e := newEnv(t)
	e.srv.set("/deno.zip", makeZip(t, map[string]string{"../../../deno": "evil"}))
	e.m = e.manifest("2.9.8", "9.0.2")
	if err := e.install(e.installer(), e.m); err == nil {
		t.Fatal("archive with only an unsafe entry was accepted")
	}
	if _, err := os.Stat(filepath.Join(e.home, "deno")); err == nil {
		t.Fatal("path traversal wrote outside the install folder")
	}
	noStaging(t, e.layout.BinDir)
}

func TestReplaceFileWindows(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "ytm-host.exe")
	os.WriteFile(dest, []byte("old"), 0o755)
	src := filepath.Join(dir, "new")
	os.WriteFile(src, []byte("new"), 0o755)
	if err := ReplaceFile(src, dest, "windows"); err != nil {
		t.Fatal(err)
	}
	if readFile(t, dest) != "new" || readFile(t, dest+".old") != "old" {
		t.Fatal("windows replace did not keep .old")
	}
	stale := filepath.Join(dir, ".download-abc")
	os.Mkdir(stale, 0o700)
	old := time.Now().Add(-2 * time.Hour)
	os.Chtimes(stale, old, old)
	fresh := filepath.Join(dir, ".download-new")
	os.Mkdir(fresh, 0o700)
	CleanupOld(dir)
	if _, err := os.Stat(dest + ".old"); err == nil {
		t.Error(".old not removed")
	}
	if _, err := os.Stat(stale); err == nil {
		t.Error("stale staging folder not removed")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Error("a staging folder that may be in use was removed")
	}
}

func TestInstallOfflineAndUninstall(t *testing.T) {
	home := t.TempDir()
	l := platform.LayoutFor("darwin", home, nil)
	self := filepath.Join(t.TempDir(), "ytm-host")
	os.WriteFile(self, []byte("dev helper"), 0o755)
	var out bytes.Buffer
	in := &Installer{Layout: l, Version: "dev", SelfPath: self, Out: &out,
		FindSystem: func(tool string) string {
			if tool == "yt-dlp" {
				return "/opt/homebrew/bin/yt-dlp"
			}
			return ""
		}}
	if err := in.InstallOffline(); err != nil {
		t.Fatal(err)
	}
	if readFile(t, l.HelperPath) != "dev helper" {
		t.Error("helper not copied")
	}
	for _, loc := range l.Manifests {
		if !strings.Contains(readFile(t, loc.Path), l.HelperPath) {
			t.Errorf("%s does not point to the helper", loc.Path)
		}
	}
	s := out.String()
	if !strings.Contains(s, "Found yt-dlp: /opt/homebrew/bin/yt-dlp") || !strings.Contains(s, "Missing: ffmpeg") || !strings.Contains(s, "brew install yt-dlp ffmpeg deno") {
		t.Errorf("output:\n%s", s)
	}
	// 重複執行（從安裝好的位置執行）也可以。
	in.SelfPath = l.HelperPath
	if err := in.InstallOffline(); err != nil {
		t.Fatal(err)
	}

	os.MkdirAll(l.LogDir, 0o755)
	os.WriteFile(filepath.Join(l.LogDir, "host.log"), []byte("log"), 0o644)
	downloads := filepath.Join(home, "Downloads")
	os.MkdirAll(downloads, 0o755)
	os.WriteFile(filepath.Join(downloads, "video.mp4"), []byte("v"), 0o644)
	out.Reset()
	if err := Uninstall(l, &out, time.Second); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{l.InstallDir, l.LogDir, l.Manifests[0].Path, l.Manifests[1].Path} {
		if _, err := os.Stat(p); err == nil {
			t.Errorf("%s still exists", p)
		}
	}
	if _, err := os.Stat(filepath.Join(downloads, "video.mp4")); err != nil {
		t.Error("downloaded video was removed")
	}
	// 再執行一次：沒有東西可以移除，也不算錯誤。
	if err := Uninstall(l, &out, time.Second); err != nil {
		t.Fatal(err)
	}
	// 安裝資料夾名稱不對時拒絕。
	bad := l
	bad.InstallDir = home
	if err := Uninstall(bad, &out, time.Second); err == nil {
		t.Fatal("removed an unexpected folder")
	}
}

// TestManifestContentMatchesTemplates 確認小幫手寫入的設定檔與 install/manifests 的範本相同。
func TestManifestContentMatchesTemplates(t *testing.T) {
	for _, browser := range []string{"chrome", "firefox"} {
		tpl, err := os.ReadFile(filepath.Join(testenv.HostDir(), "..", "install", "manifests", browser+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var want, got map[string]any
		json.Unmarshal(bytes.ReplaceAll(tpl, []byte("@HOST_PATH@"), []byte(`C:\\x\\ytm-host.exe`)), &want)
		b, _ := ManifestContent(browser, `C:\x\ytm-host.exe`)
		json.Unmarshal(b, &got)
		wb, _ := json.Marshal(want)
		gb, _ := json.Marshal(got)
		if string(wb) != string(gb) || len(want) == 0 {
			t.Errorf("%s:\n got %s\nwant %s", browser, gb, wb)
		}
	}
}

func TestWindowsLayout(t *testing.T) {
	l := platform.LayoutFor("windows", `C:\Users\me`, func(k string) string {
		if k == "LOCALAPPDATA" {
			return `C:\Users\me\AppData\Local`
		}
		return ""
	})
	if l.HelperPath != `C:\Users\me\AppData\Local\yt-toolbar-master\ytm-host.exe` || l.BinDir != `C:\Users\me\AppData\Local\yt-toolbar-master\bin` {
		t.Fatalf("%+v", l)
	}
	if l.Manifests[0].RegistryKey != `Software\Google\Chrome\NativeMessagingHosts\com.chidi0716.yt_toolbar_master` ||
		l.Manifests[1].RegistryKey != `Software\Mozilla\NativeMessagingHosts\com.chidi0716.yt_toolbar_master` ||
		l.Manifests[1].Path != `C:\Users\me\AppData\Local\yt-toolbar-master\com.chidi0716.yt_toolbar_master.firefox.json` {
		t.Fatalf("%+v", l.Manifests)
	}
	mac := platform.LayoutFor("darwin", "/Users/me", nil)
	if mac.Manifests[0].Path != "/Users/me/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.chidi0716.yt_toolbar_master.json" ||
		mac.Manifests[1].Path != "/Users/me/Library/Application Support/Mozilla/NativeMessagingHosts/com.chidi0716.yt_toolbar_master.json" {
		t.Fatalf("%+v", mac.Manifests)
	}
	if PlatformKey("darwin", "arm64") != "darwin-arm64" || PlatformKey("windows", "amd64") != "windows-amd64" || PlatformKey("linux", "amd64") != "" || PlatformKey("windows", "arm64") != "" {
		t.Fatal("PlatformKey")
	}
}
