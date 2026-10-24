package validate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
)

func TestMain(m *testing.M) { testenv.Main(m) }

func wantCode(t *testing.T, label string, err error, code errs.Code) {
	t.Helper()
	e := errs.From(err)
	if e == nil || e.Code != code {
		t.Errorf("%s: want %s, got %v", label, code, err)
	}
}

func TestVideoID(t *testing.T) {
	for _, s := range []string{"dQw4w9WgXcQ", "jNQXAC9IVRw", "a-b_c-d_e-f", "___________"} {
		if err := VideoID(s); err != nil {
			t.Errorf("%q: %v", s, err)
		}
	}
	for _, s := range []string{
		"", "dQw4w9WgXc", "dQw4w9WgXcQQ", "dQw4w9WgXc!", "../../../..", "dQw4w9WgXc ",
		"https://www", "dQw4w9WgXc\n", "dQw4w9WgXc;", "dQw4w9WgX%Q", "-- -rm -rf", "dQw4w9WgXcé",
	} {
		wantCode(t, s, VideoID(s), errs.InvalidArgs)
	}
}

func TestFormatID(t *testing.T) {
	for _, s := range []string{"18", "137+140", "139-drc", "hls-1080p", "616+251-drc", "a", "0123456789+0123456789"} {
		if err := FormatID(s); err != nil {
			t.Errorf("%q: %v", s, err)
		}
	}
	for _, s := range []string{
		"", "+140", "137+", "137+140+251", "-x", "137+-140", "bestvideo*", "best[height<=720]",
		"137/140", "137,140", "01234567890", "137 140", "--exec", "137+140;rm", "../18", "137\x00",
	} {
		wantCode(t, s, FormatID(s), errs.InvalidArgs)
	}
}

func TestContainerBitrateSubFormat(t *testing.T) {
	for _, s := range []string{"mp4", "webm"} {
		if err := Container(s); err != nil {
			t.Error(err)
		}
	}
	for _, s := range []string{"", "MP4", "mkv", "mp4 ", "mp4/webm"} {
		wantCode(t, s, Container(s), errs.InvalidArgs)
	}
	for _, n := range []int{64, 128, 192, 256, 320} {
		if err := Bitrate(n); err != nil {
			t.Error(err)
		}
	}
	for _, n := range []int{0, -192, 96, 193, 321, 1000} {
		wantCode(t, "bitrate", Bitrate(n), errs.InvalidArgs)
	}
	for _, s := range []string{"srt", "vtt", "txt"} {
		if err := SubFormat(s); err != nil {
			t.Error(err)
		}
	}
	for _, s := range []string{"", "ass", "SRT", "srt/vtt", "best"} {
		wantCode(t, s, SubFormat(s), errs.InvalidArgs)
	}
}

func TestSubLang(t *testing.T) {
	for _, s := range []string{"en", "zh-TW", "zh-Hant", "en-orig", "pt-BR", "x", "a1234567890123456789"} {
		if err := SubLang(s); err != nil {
			t.Errorf("%q: %v", s, err)
		}
	}
	for _, s := range []string{
		"", "all", "ALL", "-en", "en.*", "en,ja", "en|ja", "en_US", "a12345678901234567890",
		"en ", "../en", "en\n", "(en)", "-live_chat",
	} {
		wantCode(t, s, SubLang(s), errs.InvalidArgs)
	}
}

func TestNamePreset(t *testing.T) {
	for _, p := range NamePresets {
		if err := NamePresetID(p.ID); err != nil {
			t.Error(err)
		}
		// 範本內不得含路徑分隔字元，避免跳出下載資料夾。
		if strings.ContainsAny(p.Template, `/\`) {
			t.Errorf("preset %s contains a path separator", p.ID)
		}
	}
	for _, s := range []string{"", "%(title)s", "../x", "TITLE-ID", "custom"} {
		wantCode(t, s, NamePresetID(s), errs.InvalidArgs)
	}
	if _, ok := LookupNamePreset(DefaultNamePreset); !ok {
		t.Fatal("default preset missing")
	}
}

func TestJobID(t *testing.T) {
	if err := JobID("0123456789abcdef"); err != nil {
		t.Error(err)
	}
	for _, s := range []string{"", "0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "../../etc/passwd", "0123456789abcde/"} {
		wantCode(t, s, JobID(s), errs.InvalidArgs)
	}
}

func TestSection(t *testing.T) {
	s, err := SectionFromJSON(json.RawMessage(`{"start":90,"end":225}`))
	if err != nil || s.Start != 90 || s.End != 225 {
		t.Fatalf("got %+v, %v", s, err)
	}
	if s, err := SectionFromJSON(json.RawMessage(`null`)); s != nil || err != nil {
		t.Fatalf("null: %+v %v", s, err)
	}
	for _, in := range []string{
		`{"start":10,"end":10}`, `{"start":20,"end":10}`, `{"start":-1,"end":10}`,
		`{"start":1.5,"end":10}`, `{"start":1e2,"end":1000}`, `{"start":"1","end":10}`,
		`{"start":0}`, `{"end":10}`, `{"start":0,"end":10,"x":1}`, `[0,10]`, `"0-10"`,
		`{"start":0,"end":360001}`, `{"start":0,"end":99999999999999999999}`,
	} {
		_, err := SectionFromJSON(json.RawMessage(in))
		wantCode(t, in, err, errs.InvalidArgs)
	}
}

func TestDirSyntax(t *testing.T) {
	unixOK := []string{"/Users/me/Downloads", "/Users/me/My Videos", "/Users/me/影片", "/"}
	for _, d := range unixOK {
		if err := dirSyntax(d, "darwin"); err != nil {
			t.Errorf("darwin %q: %v", d, err)
		}
	}
	unixBad := []string{
		"", "Downloads", "./Downloads", "~/Downloads", "/Users/me/../../etc", "/Users/me/./x",
		"/Users/me/..", "/Users/me\x00/x", "/Users/me\n/x", "C:\\Users\\me", strings.Repeat("/a", 600),
		"/Users/me\\..\\x",
	}
	for _, d := range unixBad {
		wantCode(t, d, dirSyntax(d, "darwin"), errs.InvalidArgs)
	}
	winOK := []string{`C:\Users\me\Downloads`, `D:\`, `c:/Users/me`, `\\nas\share\videos`, `C:\Users\me\影片`}
	for _, d := range winOK {
		if err := dirSyntax(d, "windows"); err != nil {
			t.Errorf("windows %q: %v", d, err)
		}
	}
	winBad := []string{
		"", `Downloads`, `C:Downloads`, `\Users\me`, `/Users/me`, `\\?\C:\x`, `\\.\pipe\x`,
		`C:\Users\me\..\..\Windows`, `\\nas`, `C:\a` + "\x07",
	}
	for _, d := range winBad {
		wantCode(t, d, dirSyntax(d, "windows"), errs.InvalidArgs)
	}
	if string(filepath.Separator) == "/" {
		if err := DirSyntax("/tmp"); err != nil {
			t.Error(err)
		}
	}
}

func TestDir(t *testing.T) {
	dir := t.TempDir()
	got, err := Dir(dir + string(filepath.Separator))
	if err != nil || got != dir {
		t.Fatalf("Dir = %q, %v", got, err)
	}
	// 檢查可寫入時建立的暫存檔要被刪掉。
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("write test left %d files", len(entries))
	}
	_, err = Dir(filepath.Join(dir, "missing"))
	wantCode(t, "missing", err, errs.PermissionDenied)
	file := filepath.Join(dir, "file.txt")
	os.WriteFile(file, []byte("x"), 0o644)
	_, err = Dir(file)
	wantCode(t, "file", err, errs.PermissionDenied)
	// 格式錯誤仍是 INVALID_ARGS。
	_, err = Dir("relative/path")
	wantCode(t, "relative", err, errs.InvalidArgs)
	if runtime.GOOS != "windows" && os.Geteuid() != 0 {
		ro := filepath.Join(dir, "ro")
		os.Mkdir(ro, 0o555)
		_, err = Dir(ro)
		wantCode(t, "read-only", err, errs.PermissionDenied)
	}
}

func dl(t *testing.T, args string) (*Download, error) {
	t.Helper()
	return DownloadArgs(json.RawMessage(args))
}

func TestDownloadArgsValid(t *testing.T) {
	d, err := dl(t, `{"videoId":"dQw4w9WgXcQ","kind":"video","formatId":"137+140","container":"mp4","dir":"/Users/me/Downloads"}`)
	if err != nil {
		t.Fatal(err)
	}
	if d.NamePreset != DefaultNamePreset || !d.Embed || d.Section != nil {
		t.Fatalf("defaults: %+v", d)
	}
	d, err = dl(t, `{"videoId":"dQw4w9WgXcQ","kind":"video","formatId":"313+251","container":"webm","dir":"/x","section":{"start":620,"end":725},"embed":false,"namePreset":"date-title"}`)
	if err != nil || d.Embed || d.Section.Start != 620 || d.NamePreset != "date-title" {
		t.Fatalf("%+v %v", d, err)
	}
	d, err = dl(t, `{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":320,"dir":"/x","section":{"start":60,"end":120}}`)
	if err != nil || d.Bitrate != 320 || d.Section.End != 120 {
		t.Fatalf("%+v %v", d, err)
	}
	d, err = dl(t, `{"videoId":"dQw4w9WgXcQ","kind":"subtitle","subLang":"zh-TW","subFormat":"txt","subAuto":true,"dir":"/x"}`)
	if err != nil || d.SubLang != "zh-TW" || d.SubFormat != "txt" || !d.SubAuto || d.Embed {
		t.Fatalf("%+v %v", d, err)
	}
	if err := Recheck(d); err != nil {
		t.Fatalf("Recheck: %v", err)
	}
}

func TestDownloadArgsInvalid(t *testing.T) {
	cases := []string{
		`{}`,
		`{"videoId":"dQw4w9WgXcQ"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"playlist","dir":"/x"}`,
		`{"videoId":"bad","kind":"mp3","bitrate":192,"dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"relative"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"/x/../y"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":"192","dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192.5,"dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":100,"dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"/x","formatId":"18"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"/x","url":"https://evil.example"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"/x","args":["--exec","rm"]}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"/x","namePreset":"%(title)s/../../x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"/x","section":{"start":5,"end":1}}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"/x","embed":"yes"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"video","container":"mp4","dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"video","formatId":"137","dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"video","formatId":"best","container":"mkv","dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"video","formatId":"--exec=calc","container":"mp4","dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"video","formatId":"137","container":"mp4","dir":"/x","bitrate":192}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"video","formatId":"137","container":"mp4","dir":"/x","subLang":"en"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"subtitle","subFormat":"srt","dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"subtitle","subLang":"en","dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"subtitle","subLang":"all","subFormat":"srt","dir":"/x"}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"subtitle","subLang":"en","subFormat":"srt","dir":"/x","section":{"start":0,"end":5}}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"subtitle","subLang":"en","subFormat":"srt","dir":"/x","embed":true}`,
		`{"videoId":"dQw4w9WgXcQ","kind":"subtitle","subLang":"en","subFormat":"srt","dir":"/x","subAuto":"true"}`,
		`[1,2]`,
		`{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"/x"} {"x":1}`,
	}
	for _, c := range cases {
		_, err := dl(t, c)
		wantCode(t, c, err, errs.InvalidArgs)
	}
}

func TestRecheckDetectsTampering(t *testing.T) {
	d := &Download{VideoID: "dQw4w9WgXcQ", Kind: KindVideo, FormatID: "best[height<9]", Container: "mp4", Dir: "/x", NamePreset: DefaultNamePreset, Embed: true}
	wantCode(t, "tampered format", Recheck(d), errs.InvalidArgs)
	d = &Download{VideoID: "dQw4w9WgXcQ", Kind: KindSubtitle, SubLang: "en", SubFormat: "srt", Dir: "/x", NamePreset: DefaultNamePreset, Embed: true}
	wantCode(t, "subtitle with embed", Recheck(d), errs.InvalidArgs)
	d = &Download{VideoID: "dQw4w9WgXcQ", Kind: KindMP3, Bitrate: 192, Dir: "/x", NamePreset: DefaultNamePreset, Section: &Section{Start: 1, End: 2}, Embed: true}
	if err := Recheck(d); err != nil {
		t.Fatal(err)
	}
}
