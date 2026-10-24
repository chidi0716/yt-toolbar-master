package release

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
)

func TestMain(m *testing.M) { testenv.Main(m) }

func hex64(c byte) string { return strings.Repeat(string(c), 64) }

// sampleManifest 回傳一份合法的清單（網址都在允許範圍內）。
func sampleManifest() *Manifest {
	gh := "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/"
	deno := "https://github.com/denoland/deno/releases/download/v2.9.8/"
	mr := "https://ffmpeg.martin-riedl.de/download/macos/arm64/1_9.0.2/"
	win := "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/autobuild-2026-09-30-18-57/"
	m := &Manifest{Schema: 1, Version: "0.2.0", Helper: map[string]Asset{}, Tools: map[string]Tool{}}
	for _, p := range Platforms {
		m.Helper[p] = Asset{URL: ProjectDownloadURL("v0.2.0", HelperFileName(p)), SHA256: hex64('a')}
	}
	yt := Tool{Version: "2026.10.21", Platforms: map[string]Platform{}}
	dn := Tool{Version: "2.9.8", Platforms: map[string]Platform{}}
	ff := Tool{Version: "9.0.2", Platforms: map[string]Platform{}}
	for _, p := range []string{DarwinARM64, DarwinAMD64} {
		yt.Platforms[p] = Platform{Files: []File{{URL: gh + "yt-dlp_macos", SHA256: hex64('b'), Name: "yt-dlp"}}}
		dn.Platforms[p] = Platform{Files: []File{{URL: deno + "deno-" + p + ".zip", SHA256: hex64('c'), Archive: "zip", Extract: []string{"deno"}}}}
		ff.Platforms[p] = Platform{Files: []File{
			{URL: mr + "ffmpeg.zip", SHA256: hex64('d'), Archive: "zip", Extract: []string{"ffmpeg"}},
			{URL: mr + "ffprobe.zip", SHA256: hex64('e'), Archive: "zip", Extract: []string{"ffprobe"}},
		}}
	}
	yt.Platforms[WindowsAMD64] = Platform{Files: []File{{URL: gh + "yt-dlp.exe", SHA256: hex64('b'), Name: "yt-dlp.exe"}}}
	dn.Platforms[WindowsAMD64] = Platform{Files: []File{{URL: deno + "deno-win.zip", SHA256: hex64('c'), Archive: "zip", Extract: []string{"deno.exe"}}}}
	ff.Platforms[WindowsAMD64] = Platform{Version: "N-1", Files: []File{{URL: win + "ffmpeg-win64-gpl.zip", SHA256: hex64('f'), Archive: "zip", Extract: []string{"ffmpeg.exe", "ffprobe.exe"}}}}
	m.Tools[ToolYtDlp], m.Tools[ToolDeno], m.Tools[ToolFFmpeg] = yt, dn, ff
	return m
}

func marshal(t *testing.T, m *Manifest) []byte {
	t.Helper()
	b, err := m.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestAllowedManifestURL 確認清單只能從本專案 GitHub 的 Release（含 GitHub 的轉址目的地）取得（008 SR-2）。
func TestAllowedManifestURL(t *testing.T) {
	ok := []string{
		LatestBase + ManifestName,
		"https://github.com/chidi0716/yt-toolbar-master/releases/download/v0.2.0/components.json",
		"https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r",
		"https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/2",
	}
	bad := []string{
		"https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/components.json",
		"https://github.com/chidi0716/yt-toolbar-master/raw/main/components.json",
		"https://github.com/chidi0716/yt-toolbar-master-fork/releases/download/v1/components.json",
		"https://ffmpeg.martin-riedl.de/download/components.json",
		"http://github.com/chidi0716/yt-toolbar-master/releases/latest/download/components.json",
		"https://evil.example/chidi0716/yt-toolbar-master/releases/latest/download/components.json",
	}
	for _, s := range ok {
		if u, _ := url.Parse(s); !AllowedManifestURL(u) {
			t.Errorf("should be allowed: %s", s)
		}
	}
	for _, s := range bad {
		if u, _ := url.Parse(s); AllowedManifestURL(u) {
			t.Errorf("should be denied: %s", s)
		}
	}
}

func TestManifestValidation(t *testing.T) {
	if _, err := ParseManifest(marshal(t, sampleManifest()), AllowedURL); err != nil {
		t.Fatalf("sample manifest rejected: %v", err)
	}
	cases := []struct {
		name   string
		mutate func(m *Manifest)
	}{
		{"schema", func(m *Manifest) { m.Schema = 2 }},
		{"version missing", func(m *Manifest) { m.Version = "" }},
		{"version not semver", func(m *Manifest) { m.Version = "latest" }},
		{"helper platform missing", func(m *Manifest) { delete(m.Helper, WindowsAMD64) }},
		{"helper extra platform", func(m *Manifest) { m.Helper["linux-amd64"] = m.Helper[DarwinARM64] }},
		{"helper sha256 missing", func(m *Manifest) { a := m.Helper[DarwinARM64]; a.SHA256 = ""; m.Helper[DarwinARM64] = a }},
		{"helper sha256 uppercase", func(m *Manifest) { a := m.Helper[DarwinARM64]; a.SHA256 = hex64('A'); m.Helper[DarwinARM64] = a }},
		{"helper url missing", func(m *Manifest) { a := m.Helper[DarwinARM64]; a.URL = ""; m.Helper[DarwinARM64] = a }},
		{"helper url other host", func(m *Manifest) {
			a := m.Helper[DarwinARM64]
			a.URL = "https://example.com/ytm-host"
			m.Helper[DarwinARM64] = a
		}},
		{"helper url http", func(m *Manifest) {
			a := m.Helper[DarwinARM64]
			a.URL = strings.Replace(a.URL, "https:", "http:", 1)
			m.Helper[DarwinARM64] = a
		}},
		{"helper url other repo", func(m *Manifest) {
			a := m.Helper[DarwinARM64]
			a.URL = "https://github.com/someone/else/releases/download/v1/ytm-host"
			m.Helper[DarwinARM64] = a
		}},
		{"tool missing", func(m *Manifest) { delete(m.Tools, ToolDeno) }},
		{"tool extra", func(m *Manifest) { m.Tools["python"] = m.Tools[ToolDeno] }},
		{"tool platform missing", func(m *Manifest) { delete(m.Tools[ToolYtDlp].Platforms, DarwinAMD64) }},
		{"tool version missing", func(m *Manifest) { t := m.Tools[ToolYtDlp]; t.Version = ""; m.Tools[ToolYtDlp] = t }},
		{"tool no files", func(m *Manifest) { m.Tools[ToolDeno].Platforms[DarwinARM64] = Platform{} }},
		{"tool latest url", func(m *Manifest) {
			m.Tools[ToolYtDlp].Platforms[DarwinARM64] = Platform{Files: []File{{URL: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos", SHA256: hex64('b'), Name: "yt-dlp"}}}
		}},
		{"tool sha256 bad", func(m *Manifest) {
			p := m.Tools[ToolYtDlp].Platforms[DarwinARM64]
			p.Files[0].SHA256 = "abc"
			m.Tools[ToolYtDlp].Platforms[DarwinARM64] = p
		}},
		{"tool wrong binary name", func(m *Manifest) {
			p := m.Tools[ToolYtDlp].Platforms[DarwinARM64]
			p.Files[0].Name = "evil"
			m.Tools[ToolYtDlp].Platforms[DarwinARM64] = p
		}},
		{"tool path in name", func(m *Manifest) {
			p := m.Tools[ToolYtDlp].Platforms[DarwinARM64]
			p.Files[0].Name = "../yt-dlp"
			m.Tools[ToolYtDlp].Platforms[DarwinARM64] = p
		}},
		{"windows binary without exe", func(m *Manifest) {
			p := m.Tools[ToolYtDlp].Platforms[WindowsAMD64]
			p.Files[0].Name = "yt-dlp"
			m.Tools[ToolYtDlp].Platforms[WindowsAMD64] = p
		}},
		{"ffprobe missing", func(m *Manifest) {
			p := m.Tools[ToolFFmpeg].Platforms[DarwinARM64]
			p.Files = p.Files[:1]
			m.Tools[ToolFFmpeg].Platforms[DarwinARM64] = p
		}},
		{"zip without extract", func(m *Manifest) {
			p := m.Tools[ToolDeno].Platforms[DarwinARM64]
			p.Files[0].Extract = nil
			m.Tools[ToolDeno].Platforms[DarwinARM64] = p
		}},
		{"unknown archive", func(m *Manifest) {
			p := m.Tools[ToolDeno].Platforms[DarwinARM64]
			p.Files[0].Archive = "tar.gz"
			m.Tools[ToolDeno].Platforms[DarwinARM64] = p
		}},
		{"checksums in manifest", func(m *Manifest) {
			p := m.Tools[ToolDeno].Platforms[DarwinARM64]
			p.Files[0].Checksums = "https://github.com/denoland/deno/releases/download/v2.9.8/x.sha256sum"
			m.Tools[ToolDeno].Platforms[DarwinARM64] = p
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := sampleManifest()
			c.mutate(m)
			b, _ := json.Marshal(m)
			if _, err := ParseManifest(b, AllowedURL); err == nil {
				t.Fatal("invalid manifest accepted")
			}
		})
	}

	// 不認得的欄位、多餘的資料、不是 JSON。
	good := string(marshal(t, sampleManifest()))
	for _, bad := range []string{
		strings.Replace(good, `"schema": 1,`, `"schema": 1, "extra": true,`, 1),
		good + "{}",
		"not json",
		"",
	} {
		if _, err := ParseManifest([]byte(bad), AllowedURL); err == nil {
			t.Fatalf("accepted %.40q", bad)
		}
	}
}

func TestAllowedURL(t *testing.T) {
	allowed := []string{
		"https://github.com/chidi0716/yt-toolbar-master/releases/download/v0.2.0/components.json",
		"https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/components.json",
		"https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp_macos",
		"https://github.com/denoland/deno/releases/download/v2.9.8/deno-aarch64-apple-darwin.zip",
		"https://github.com/yt-dlp/FFmpeg-Builds/releases/download/autobuild-2026-09-30-18-57/checksums.sha256",
		"https://GitHub.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe",
		"https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip",
		"https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r",
		"https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/2",
	}
	denied := []string{
		"http://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp_macos",
		"https://github.com/yt-dlp/yt-dlp/archive/refs/heads/master.zip",
		"https://github.com/chidi0716/other/releases/download/v1/x",
		"https://github.com/yt-dlp/yt-dlp/releases/../../evil/releases/download/x",
		"https://github.com/yt-dlp/yt-dlp/releases/download/%2e%2e/x",
		"https://github.com/yt-dlp/yt-dlp/releases/download/a%2Fb",
		"https://github.com:8443/yt-dlp/yt-dlp/releases/download/x",
		"https://user:pw@github.com/yt-dlp/yt-dlp/releases/download/x",
		"https://github.com.evil.example/yt-dlp/yt-dlp/releases/download/x",
		"https://evil.example/https://github.com/yt-dlp/yt-dlp/releases/",
		"https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip",
		"https://www.youtube.com/watch?v=aaaaaaaaaaa",
		"file:///etc/passwd",
		"",
	}
	for _, s := range allowed {
		if !AllowedURLString(s) {
			t.Errorf("should be allowed: %s", s)
		}
	}
	for _, s := range denied {
		if AllowedURLString(s) {
			t.Errorf("should be denied: %s", s)
		}
	}
	hosts := strings.Join(AllowedHosts(), ",")
	if hosts != "github.com,ffmpeg.martin-riedl.de,objects.githubusercontent.com,release-assets.githubusercontent.com" {
		t.Fatalf("unexpected hosts: %s", hosts)
	}
}

// TestNoOtherDomains 確認小幫手與安裝腳本的原始碼中只出現允許的網域（plan 4.9「網路連線範圍」）。
// YouTube 只出現在交給 yt-dlp 的影片網址中。
func TestNoOtherDomains(t *testing.T) {
	ok := map[string]bool{"www.youtube.com": true}
	for _, h := range AllowedHosts() {
		ok[h] = true
	}
	urlRe := regexp.MustCompile(`https?://([A-Za-z0-9.-]+)`)
	repo := filepath.Join(testenv.HostDir(), "..")
	// 安裝腳本只檢查一行指令會下載執行的引導腳本（install/bootstrap）；手動安裝用的舊腳本
	// 不會連線，只在說明文字中提到 Homebrew 等網址。
	roots := []string{filepath.Join(repo, "host"), filepath.Join(repo, "install", "bootstrap")}
	checked := 0
	for _, root := range roots {
		filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			name := d.Name()
			if d.IsDir() {
				if name == "testdata" || name == "dist" || name == ".testtmp" || name == "e2e" || name == "testenv" {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.HasSuffix(name, "_test.go") || !(strings.HasSuffix(name, ".go") || strings.HasSuffix(name, ".sh") || strings.HasSuffix(name, ".ps1")) {
				return nil
			}
			b, err := os.ReadFile(p)
			if err != nil {
				t.Fatal(err)
			}
			checked++
			for _, m := range urlRe.FindAllStringSubmatch(string(b), -1) {
				host := strings.ToLower(strings.TrimRight(m[1], "."))
				if !ok[host] {
					t.Errorf("%s: unexpected domain %s", p, host)
				}
			}
			return nil
		})
	}
	if checked < 5 {
		t.Fatalf("only %d files checked", checked)
	}
}

func TestParseChecksums(t *testing.T) {
	a, b := hex64('a'), hex64('b')
	cases := []struct {
		text, name, want string
	}{
		{a + "  yt-dlp.exe\n" + b + "  yt-dlp_macos\n", "yt-dlp_macos", b},
		{a + " *yt-dlp.exe\n", "yt-dlp.exe", a},
		{strings.ToUpper(a) + "  ./sub/x.zip\r\n", "x.zip", a},
		{"SHA256 (deno.zip) = " + b + "\n", "deno.zip", b},
		{a + "  ffmpeg.zip\n", "FFMPEG.ZIP", a},
		{"\nAlgorithm : SHA256\nHash      : " + strings.ToUpper(b) + "\nPath      : C:\\a\\deno\\target\\release\\deno-x86_64-pc-windows-msvc.zip\n\n", "deno-x86_64-pc-windows-msvc.zip", b},
		{"  " + a + "\n", "anything.zip", a},
	}
	for _, c := range cases {
		got, err := ParseChecksums(c.text, c.name)
		if err != nil || got != c.want {
			t.Errorf("ParseChecksums(%q, %q) = %q, %v", c.text, c.name, got, err)
		}
	}
	for _, c := range []struct{ text, name string }{
		{a + "  other.zip\n", "x.zip"},
		{"Algorithm : SHA256\nHash : " + a + "\nPath : C:\\other.zip\n", "x.zip"},
		{"Algorithm : MD5\nHash : " + a + "\nPath : C:\\x.zip\n", "x.zip"},
		{"", "x.zip"},
		{"abc  x.zip", "x.zip"},
	} {
		if got, err := ParseChecksums(c.text, c.name); err == nil {
			t.Errorf("ParseChecksums(%q, %q) = %q, want error", c.text, c.name, got)
		}
	}
}

func TestVersionCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.10.0", "0.9.0", 1},
		{"0.9.0", "0.10.0", -1},
		{"1.0.0", "1.0.0", 0},
		{"v1.2.3", "1.2.3", 0},
		{"1.0.0", "1.0.0-beta.1", 1},
		{"1.0.0-beta.2", "1.0.0-beta.1", 1},
		{"2.0.0", "10.0.0", -1},
	}
	for _, c := range cases {
		a, ok1 := ParseVersion(c.a)
		b, ok2 := ParseVersion(c.b)
		if !ok1 || !ok2 || a.Compare(b) != c.want {
			t.Errorf("%s vs %s: got %d (%v %v), want %d", c.a, c.b, a.Compare(b), ok1, ok2, c.want)
		}
	}
	for _, bad := range []string{"", "dev", "1.0", "1.0.0.0", "01.0.0", "1.0.0-", "a.b.c", "1.0.0-be ta"} {
		if _, ok := ParseVersion(bad); ok {
			t.Errorf("ParseVersion(%q) accepted", bad)
		}
	}
	if Newer("0.2.0", "dev") || !Newer("0.10.0", "0.9.0") || Newer("0.9.0", "0.9.0") {
		t.Error("Newer")
	}
}

func repoLockPath() string {
	return filepath.Join(testenv.HostDir(), "..", "release", "components.lock.json")
}

// TestRepoLockFile 確認 repo 中的 lock 檔格式正確，且每個檔案都有官方檢查碼網址。
func TestRepoLockFile(t *testing.T) {
	b, err := os.ReadFile(repoLockPath())
	if err != nil {
		t.Fatal(err)
	}
	l, err := ParseLock(b)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range l.uniqueFiles() {
		if !AllowedURLString(f.Checksums) {
			t.Errorf("%s: checksums url %q", f.URL, f.Checksums)
		}
	}
}

func TestBuildManifest(t *testing.T) {
	b, err := os.ReadFile(repoLockPath())
	if err != nil {
		t.Fatal(err)
	}
	l, err := ParseLock(b)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	for i, p := range Platforms {
		if err := os.WriteFile(filepath.Join(dir, HelperFileName(p)), []byte{byte(i)}, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	m, err := BuildManifest(l, "0.2.0", "v0.2.0", dir)
	if err != nil {
		t.Fatal(err)
	}
	data := marshal(t, m)
	if strings.Contains(string(data), "checksums") {
		t.Fatal("checksums leaked into the manifest")
	}
	m2, err := ParseManifest(data, AllowedURL)
	if err != nil {
		t.Fatal(err)
	}
	if m2.Helper[WindowsAMD64].URL != "https://github.com/chidi0716/yt-toolbar-master/releases/download/v0.2.0/ytm-host-windows-amd64.exe" ||
		m2.Helper[DarwinAMD64].SHA256 != HashBytes([]byte{1}) {
		t.Fatalf("helper entries: %+v", m2.Helper)
	}
	// 輸出固定：再輸出一次結果相同。
	if string(marshal(t, m2)) != string(data) {
		t.Fatal("Marshal is not stable")
	}
	if _, err := BuildManifest(l, "0.2.0", "v0.3.0", dir); err == nil {
		t.Fatal("tag/version mismatch accepted")
	}
	os.Remove(filepath.Join(dir, HelperFileName(DarwinARM64)))
	if _, err := BuildManifest(l, "0.2.0", "v0.2.0", dir); err == nil {
		t.Fatal("missing helper accepted")
	}
}

// TestLockVerifyOnline 以本機伺服器模擬官方檢查碼與檔案：相符、檢查碼不符、檔案內容不符。
func TestLockVerifyOnline(t *testing.T) {
	content := map[string]string{"/tool.bin": "hello"}
	sum := HashBytes([]byte("hello"))
	checksums := sum + "  tool.bin\n"
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/SUMS":
			w.Write([]byte(checksums))
		case "/tool.bin":
			w.Write([]byte(content["/tool.bin"]))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	f := &Fetcher{Client: srv.Client(), Allow: func(u *url.URL) bool { return u.Scheme == "https" }}
	l := &Lock{Schema: 1, Tools: map[string]Tool{ToolYtDlp: {Version: "1", Platforms: map[string]Platform{
		DarwinARM64: {Files: []File{{URL: srv.URL + "/tool.bin", SHA256: sum, Name: "yt-dlp", Checksums: srv.URL + "/SUMS"}}},
	}}}}
	logf := func(string, ...any) {}
	ctx := context.Background()
	if err := l.VerifyOnline(ctx, f, true, t.TempDir(), logf); err != nil {
		t.Fatalf("matching lock rejected: %v", err)
	}
	checksums = hex64('0') + "  tool.bin\n"
	if err := l.VerifyOnline(ctx, f, false, t.TempDir(), logf); err == nil || !strings.Contains(err.Error(), "official checksum") {
		t.Fatalf("checksum mismatch: %v", err)
	}
	checksums = sum + "  tool.bin\n"
	content["/tool.bin"] = "tampered"
	if err := l.VerifyOnline(ctx, f, true, t.TempDir(), logf); err == nil || !strings.Contains(err.Error(), "downloaded file") {
		t.Fatalf("content mismatch: %v", err)
	}
}

func TestFetcherRejectsDisallowedRedirect(t *testing.T) {
	var target *httptest.Server
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/x", http.StatusFound)
	}))
	defer srv.Close()
	target = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) }))
	defer target.Close()
	srvURL, _ := url.Parse(srv.URL)
	f := &Fetcher{Client: srv.Client(), Allow: func(u *url.URL) bool { return u.Host == srvURL.Host }}
	if _, err := f.Get(context.Background(), srv.URL+"/a"); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("redirect to another host: got %v", err)
	}
	if _, err := f.Get(context.Background(), target.URL+"/a"); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("disallowed URL: got %v", err)
	}
}
