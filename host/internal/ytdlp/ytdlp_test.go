package ytdlp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
)

func TestMain(m *testing.M) { testenv.Main(m) }

// fakeEnv 模擬某個作業系統上的檔案與 PATH。
func fakeEnv(goos string, env map[string]string, files ...string) Env {
	set := map[string]bool{}
	for _, f := range files {
		set[f] = true
	}
	return Env{
		GOOS:   goos,
		Getenv: func(k string) string { return env[k] },
		LookPath: func(name string) (string, error) {
			return "", errors.New("not in PATH")
		},
		Glob: func(pat string) ([]string, error) {
			var out []string
			for f := range set {
				slash := func(s string) string { return strings.ReplaceAll(s, `\`, "/") }
				if ok, _ := filepath.Match(slash(pat), slash(f)); ok {
					out = append(out, f)
				}
			}
			return out, nil
		},
		IsFile: func(p string) bool { return set[p] },
	}
}

func TestFindDarwin(t *testing.T) {
	e := fakeEnv("darwin", map[string]string{"PATH": "/usr/bin:/bin"},
		"/opt/homebrew/bin/yt-dlp", "/usr/local/bin/ffmpeg")
	if got := e.Find("yt-dlp"); got != "/opt/homebrew/bin/yt-dlp" {
		t.Errorf("yt-dlp = %q", got)
	}
	if got := e.Find("ffmpeg"); got != "/usr/local/bin/ffmpeg" {
		t.Errorf("ffmpeg = %q", got)
	}
	if got := e.ChildPath("/usr/local/bin/ffmpeg"); got != "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin" {
		t.Errorf("ChildPath = %q", got)
	}
	// PATH 中找到的優先。
	e.LookPath = func(name string) (string, error) { return "/Users/me/bin/" + name, nil }
	if got := e.Find("yt-dlp"); got != "/Users/me/bin/yt-dlp" {
		t.Errorf("PATH yt-dlp = %q", got)
	}
}

func TestFindWindows(t *testing.T) {
	la := `C:\Users\me\AppData\Local`
	e := fakeEnv("windows", map[string]string{"LOCALAPPDATA": la, "PATH": `C:\Windows\system32`},
		la+`\Microsoft\WinGet\Links\yt-dlp.exe`,
		la+`\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-7.1-full_build\bin\ffmpeg.exe`,
	)
	if got := e.Find("yt-dlp"); got != la+`\Microsoft\WinGet\Links\yt-dlp.exe` {
		t.Errorf("yt-dlp = %q", got)
	}
	ff := la + `\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-7.1-full_build\bin\ffmpeg.exe`
	if got := e.Find("ffmpeg"); got != ff {
		t.Errorf("ffmpeg = %q", got)
	}
	want := `C:\Windows\system32;` + la + `\Microsoft\WinGet\Links;` + la + `\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-7.1-full_build\bin`
	if got := e.ChildPath(ff); got != want {
		t.Errorf("ChildPath = %q", got)
	}
	// 只在套件資料夾中的 yt-dlp。
	e2 := fakeEnv("windows", map[string]string{"LOCALAPPDATA": la},
		la+`\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe`)
	if got := e2.Find("yt-dlp"); !strings.HasSuffix(got, `yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe`) {
		t.Errorf("package yt-dlp = %q", got)
	}
	if got := e2.Find("ffmpeg"); got != "" {
		t.Errorf("missing ffmpeg = %q", got)
	}
}

func TestManager(t *testing.T) {
	cases := []struct {
		goos, path, resolved string
		head                 string
		want                 string
	}{
		{"darwin", "/opt/homebrew/bin/yt-dlp", "/opt/homebrew/Cellar/yt-dlp/2026.10.21/libexec/bin/yt-dlp", "", "homebrew"},
		{"darwin", "/usr/local/bin/yt-dlp", "/usr/local/Cellar/yt-dlp/2026.10.21/bin/yt-dlp", "", "homebrew"},
		{"darwin", "/usr/local/bin/yt-dlp", "/usr/local/bin/yt-dlp", "#!/usr/bin/env python3\nPK...", ""},
		{"darwin", "/Users/me/.local/bin/yt-dlp", "/Users/me/.local/pipx/venvs/yt-dlp/bin/yt-dlp", "", "pipx"},
		{"darwin", "/Users/me/Library/Python/3.12/bin/yt-dlp", "/Users/me/Library/Python/3.12/bin/yt-dlp", "#!/usr/bin/python3\n# -*- coding: utf-8 -*-\nimport re\nimport sys\nfrom yt_dlp import main\n", "pip"},
		{"windows", `C:\Users\me\AppData\Local\Microsoft\WinGet\Links\yt-dlp.exe`, `C:\Users\me\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_x\yt-dlp.exe`, "MZ", "winget"},
		{"windows", `C:\Tools\yt-dlp.exe`, `C:\Tools\yt-dlp.exe`, "MZ", ""},
	}
	for _, c := range cases {
		if got := Manager(c.goos, c.path, c.resolved, []byte(c.head)); got != c.want {
			t.Errorf("%s: got %q want %q", c.path, got, c.want)
		}
	}
	if UpdateCommand("darwin", "homebrew") != "brew upgrade yt-dlp" ||
		UpdateCommand("windows", "winget") != "winget upgrade --id yt-dlp.yt-dlp" ||
		UpdateCommand("darwin", "") != "" {
		t.Error("UpdateCommand")
	}
}

func dl(kind string, mod func(*validate.Download)) *validate.Download {
	d := &validate.Download{VideoID: "dQw4w9WgXcQ", Kind: kind, Dir: "/Users/me/Downloads", NamePreset: "title-id", Embed: true}
	if mod != nil {
		mod(d)
	}
	return d
}

func common(tmp, tmpl string) []string {
	return []string{
		"--ignore-config", "--no-playlist", "--newline", "--no-colors", "--progress",
		"--progress-template", progressTemplate, "--progress-template", postTemplate,
		"--print", printTemplate, "--windows-filenames",
		"--match-filters", liveFilter, "-P", tmp, "-o", tmpl,
	}
}

func TestDownloadArgs(t *testing.T) {
	const tmp = "/Users/me/Downloads/.yte-tmp-0123456789abcdef"
	const ff = "/opt/homebrew/bin/ffmpeg"
	url := []string{"--", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
	cases := []struct {
		name string
		d    *validate.Download
		want []string
	}{
		{"video mp4 embed", dl("video", func(d *validate.Download) { d.FormatID, d.Container = "137+140", "mp4" }),
			append(append(common(tmp, "%(title)s [%(id)s].%(ext)s"), "--ffmpeg-location", ff,
				"-f", "137+140", "--merge-output-format", "mp4",
				"--embed-thumbnail", "--embed-metadata", "--embed-chapters"), url...)},
		{"video webm no thumbnail", dl("video", func(d *validate.Download) { d.FormatID, d.Container = "313+251", "webm" }),
			append(append(common(tmp, "%(title)s [%(id)s].%(ext)s"), "--ffmpeg-location", ff,
				"-f", "313+251", "--merge-output-format", "webm",
				"--embed-metadata", "--embed-chapters"), url...)},
		{"video clip", dl("video", func(d *validate.Download) {
			d.FormatID, d.Container, d.Section = "136+140", "mp4", &validate.Section{Start: 620, End: 725}
		}),
			append(append(common(tmp, "%(title)s [%(id)s] 10m20s-12m05s.%(ext)s"), "--ffmpeg-location", ff,
				"-f", "136+140", "--merge-output-format", "mp4",
				"--download-sections", "*620-725", "--force-keyframes-at-cuts",
				"--embed-thumbnail", "--embed-metadata", "--no-embed-chapters"), url...)},
		{"video no embed", dl("video", func(d *validate.Download) { d.FormatID, d.Container, d.Embed = "18", "mp4", false }),
			append(append(common(tmp, "%(title)s [%(id)s].%(ext)s"), "--ffmpeg-location", ff,
				"-f", "18", "--merge-output-format", "mp4"), url...)},
		{"mp3 clip", dl("mp3", func(d *validate.Download) {
			d.Bitrate, d.Section, d.NamePreset = 320, &validate.Section{Start: 90, End: 225}, "channel-title"
		}),
			append(append(common(tmp, "%(channel,uploader|Unknown)s - %(title)s [%(id)s] 01m30s-03m45s.%(ext)s"), "--ffmpeg-location", ff,
				"-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "320K",
				"--download-sections", "*90-225", "--force-keyframes-at-cuts",
				"--embed-thumbnail", "--embed-metadata", "--no-embed-chapters"), url...)},
		{"subtitle srt auto", dl("subtitle", func(d *validate.Download) {
			d.SubLang, d.SubFormat, d.SubAuto, d.Embed = "zh-TW", "srt", true, false
		}),
			append(append(common(tmp, "%(title)s [%(id)s].%(ext)s"), "--ffmpeg-location", ff,
				"--skip-download", "--write-auto-subs", "--sub-langs", "zh-TW", "--sub-format", "vtt",
				"--convert-subs", "srt"), url...)},
		{"subtitle txt", dl("subtitle", func(d *validate.Download) { d.SubLang, d.SubFormat, d.Embed = "en", "txt", false }),
			append(append(common(tmp, "%(title)s [%(id)s].%(ext)s"), "--ffmpeg-location", ff,
				"--skip-download", "--write-subs", "--sub-langs", "en", "--sub-format", "vtt"), url...)},
	}
	for _, c := range cases {
		got := DownloadArgs(c.d, tmp, ff)
		if strings.Join(got, "\n") != strings.Join(c.want, "\n") {
			t.Errorf("%s:\n got %q\nwant %q", c.name, got, c.want)
		}
		// 網址一定在 -- 之後、而且是最後一個參數。
		if got[len(got)-2] != "--" {
			t.Errorf("%s: url is not after --", c.name)
		}
	}
	if got := DownloadArgs(dl("mp3", func(d *validate.Download) { d.Bitrate = 128 }), tmp, ""); strings.Contains(strings.Join(got, " "), "--ffmpeg-location") {
		t.Error("empty ffmpeg path should not add --ffmpeg-location")
	}
}

func TestInfoArgs(t *testing.T) {
	got := strings.Join(InfoArgs("jNQXAC9IVRw"), " ")
	want := "--ignore-config --no-playlist --no-colors -J --ignore-no-formats-error -- https://www.youtube.com/watch?v=jNQXAC9IVRw"
	if got != want {
		t.Fatalf("got %s", got)
	}
}

func TestClipLabel(t *testing.T) {
	for sec, want := range map[int64]string{0: "00m00s", 90: "01m30s", 225: "03m45s", 3599: "59m59s", 3600: "01h00m00s", 3723: "01h02m03s", 36000: "10h00m00s", 360000: "100h00m00s"} {
		if got := ClipLabel(sec); got != want {
			t.Errorf("%d: %s", sec, got)
		}
	}
}

func TestParseLine(t *testing.T) {
	// 以下格式取自真正的 yt-dlp（2026.10.21）在本機測試伺服器上的輸出。
	l := ParseLine(`YTE-PROGRESS {"p":{"status": "downloading", "downloaded_bytes": 3072, "total_bytes": 277808, "eta": 0},"f":"137"}`)
	if l.Kind != LineProgress || l.FormatID != "137" || *l.Progress.Downloaded != 3072 || *l.Progress.Total != 277808 || l.Progress.Speed != nil {
		t.Errorf("progress: %+v", l)
	}
	l = ParseLine(`YTE-PROGRESS {"p":{"status": "downloading", "downloaded_bytes": 1024, "total_bytes": 277808},"f":null}`)
	if l.Kind != LineProgress || l.FormatID != "" {
		t.Errorf("null format: %+v", l)
	}
	l = ParseLine(`YTE-POST {"pp":"Merger","s":"started"}`)
	if l.Kind != LinePost || l.PostName != "Merger" || l.PostStat != "started" {
		t.Errorf("post: %+v", l)
	}
	l = ParseLine(`YTE-FILE "/Users/me/Downloads/.yte-tmp-x/\u6e2c\u8a66 [jNQXAC9IVRw].mp4"` + "\r\n")
	if l.Kind != LineFile || l.Path != "/Users/me/Downloads/.yte-tmp-x/測試 [jNQXAC9IVRw].mp4" {
		t.Errorf("file: %+v", l)
	}
	l = ParseLine(`ERROR: [youtube] jNQXAC9IVRw: Video unavailable`)
	if l.Kind != LineError || l.Message != "Video unavailable" {
		t.Errorf("error: %+v", l)
	}
	for _, s := range []string{"", "[download] 10%", "YTE-PROGRESS not json", "YTE-FILE \"\"", "WARNING: x"} {
		if l := ParseLine(s); l.Kind != LineOther {
			t.Errorf("%q: %+v", s, l)
		}
	}
}

func f(v float64) *float64 { return &v }

func TestTracker(t *testing.T) {
	tr := NewTracker("137+140")
	s := tr.Update(Progress{Status: "downloading", Downloaded: f(50), Total: f(100)}, "137")
	if *s.Percent != 45 || s.Part != 1 || s.Parts != 2 {
		t.Errorf("first half: %v %+v", *s.Percent, s)
	}
	s = tr.Update(Progress{Status: "finished", Downloaded: f(100), Total: f(100)}, "137")
	if *s.Percent != 90 {
		t.Errorf("video done: %v", *s.Percent)
	}
	s = tr.Update(Progress{Status: "downloading", Downloaded: f(0), Total: f(10)}, "140")
	if *s.Percent < 90 || s.Part != 2 {
		t.Errorf("audio start must not go back: %v", *s.Percent)
	}
	s = tr.Update(Progress{Status: "finished", Downloaded: f(10), Total: f(10)}, "140")
	if *s.Percent != 100 {
		t.Errorf("all done: %v", *s.Percent)
	}

	tr = NewTracker("")
	s = tr.Update(Progress{Status: "downloading", FragmentIndex: f(3), FragmentCount: f(12)}, "251")
	if *s.Percent != 25 {
		t.Errorf("fragments: %v", *s.Percent)
	}
	s = tr.Update(Progress{Status: "downloading"}, "251")
	if s.Percent == nil || *s.Percent != 25 {
		t.Errorf("unknown keeps last: %+v", s)
	}
	tr = NewTracker("")
	if s := tr.Update(Progress{Status: "downloading"}, ""); s.Percent != nil {
		t.Errorf("unknown from start: %+v", s)
	}
}

func TestClassify(t *testing.T) {
	cases := []struct {
		lines []string
		code  errs.Code
	}{
		{[]string{"WARNING: x", "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm your age. This video may be inappropriate for some users."}, errs.LoginRequired},
		{[]string{"ERROR: [youtube] dQw4w9WgXcQ: Private video. Sign in if you've been granted access to this video"}, errs.LoginRequired},
		{[]string{"ERROR: [youtube] dQw4w9WgXcQ: Join this channel to get access to members-only content like this video, and other exclusive perks."}, errs.LoginRequired},
		{[]string{"ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication."}, errs.VerificationRequired},
		{[]string{"ERROR: [youtube] dQw4w9WgXcQ: Video unavailable. This video has been removed by the uploader"}, errs.VideoUnavailable},
		{[]string{"ERROR: [youtube] dQw4w9WgXcQ: Video unavailable. The uploader has not made this video available in your country"}, errs.VideoUnavailable},
		{[]string{"ERROR: [youtube] dQw4w9WgXcQ: This live event will begin in 3 hours."}, errs.LiveNotSupported},
		{[]string{"ERROR: [youtube] dQw4w9WgXcQ: Requested format is not available. Use --list-formats for a list of available formats"}, errs.FormatUnavailable},
		{[]string{"ERROR: unable to write data: [Errno 28] No space left on device"}, errs.DiskFull},
		{[]string{"ERROR: unable to open for writing: [Errno 13] Permission denied: '/x/y.part'"}, errs.PermissionDenied},
		{[]string{"ERROR: [youtube] dQw4w9WgXcQ: Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided, or not known> (caused by TransportError(...))"}, errs.Network},
		{[]string{"ERROR: unable to download video data: HTTP Error 403: Forbidden"}, errs.YtDlpOutdated},
		{[]string{"ERROR: [youtube] dQw4w9WgXcQ: Signature extraction failed: Some formats may be missing"}, errs.YtDlpOutdated},
		{[]string{"Usage: yt-dlp [OPTIONS] URL [URL...]", "", "yt-dlp: error: no such option: --progress-template"}, errs.YtDlpOutdated},
		{[]string{"ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using --ffmpeg-location"}, errs.FFmpegNotFound},
		{[]string{"ERROR: something completely new"}, errs.Unknown},
		{[]string{"Traceback (most recent call last):"}, errs.Unknown},
	}
	for _, c := range cases {
		e := Classify(c.lines)
		if e.Code != c.code {
			t.Errorf("%q: got %s (%s), want %s", c.lines, e.Code, e.Message, c.code)
		}
		if e.Message == "" || strings.HasPrefix(e.Message, "ERROR:") {
			t.Errorf("%q: message %q", c.lines, e.Message)
		}
	}
	if e := Classify([]string{"ERROR: [youtube] dQw4w9WgXcQ: Video unavailable"}); e.Message != "Video unavailable" {
		t.Errorf("message = %q", e.Message)
	}
}

func TestVTTToText(t *testing.T) {
	in := "WEBVTT\r\nKind: captions\r\nLanguage: en\r\n\r\n" +
		"NOTE this is a comment\r\n--> not a cue\r\n\r\n" +
		"STYLE\r\n::cue { color: red }\r\n\r\n" +
		"1\r\n00:00:00.000 --> 00:00:02.000 align:start position:0%\r\n<v Speaker>Hello &amp; welcome</v>\r\n\r\n" +
		"00:00:02.000 --> 00:00:04.000\r\nSecond <i>line</i>\r\nThird   line\r\n\r\n" +
		"00:00:04.000 --> 00:00:05.000\r\n&lt;music&gt;\r\n"
	got, err := VTTToText(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	// NOTE 區塊雖然含有 -->，但第一行是 NOTE：依 WebVTT 規格不是 cue。這裡的實作以「含 --> 的
	// 那一行之後」為文字，NOTE 區塊的 --> 之後沒有文字，因此不影響輸出。
	want := "Hello & welcome\nSecond line\nThird line\n<music>\n"
	if got != want {
		t.Errorf("got %q\nwant %q", got, want)
	}

	// YouTube 自動字幕的滾動格式：每個 cue 會重複上一行。
	auto := `WEBVTT
Kind: captions
Language: en

00:00:00.480 --> 00:00:02.869 align:start position:0%

hello<00:00:01.040><c> everyone</c><00:00:01.520><c> and</c>

00:00:02.869 --> 00:00:02.879 align:start position:0%
hello everyone and


00:00:02.879 --> 00:00:05.110 align:start position:0%
hello everyone and
welcome<00:00:03.360><c> to</c><00:00:03.600><c> the</c><00:00:04.000><c> show</c>

00:00:05.110 --> 00:00:05.120 align:start position:0%
welcome to the show

`
	got, err = VTTToText(strings.NewReader(auto))
	if err != nil {
		t.Fatal(err)
	}
	if want := "hello everyone and\nwelcome to the show\n"; got != want {
		t.Errorf("auto: got %q want %q", got, want)
	}
	if got, _ := VTTToText(strings.NewReader("WEBVTT\n")); got != "" {
		t.Errorf("empty: %q", got)
	}
}

func readFixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(testenv.HostDir(), "testdata", "fake-yt-dlp", "info.json"))
	if err != nil {
		t.Fatal(err)
	}
	return []byte(strings.ReplaceAll(string(b), "FAKEVIDEOID", "dQw4w9WgXcQ"))
}

func TestParseInfo(t *testing.T) {
	info, err := ParseInfo(readFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	if info.ID != "dQw4w9WgXcQ" || info.Channel != "Fake Channel" || *info.Duration != 245 || info.LiveStatus != "not_live" || info.IsLive {
		t.Errorf("basic: %+v", info)
	}
	if len(info.Chapters) != 2 || info.Chapters[1].Title != "Main part" || info.Chapters[1].Start != 60 {
		t.Errorf("chapters: %+v", info.Chapters)
	}
	ids := []string{}
	for _, f := range info.Formats {
		ids = append(ids, f.ID)
	}
	if got := strings.Join(ids, ","); got != "139-drc,140,251,18,136,137,248,299,313,401" {
		t.Errorf("formats (storyboard and DRM must be dropped): %s", got)
	}
	if len(info.Subtitles) != 2 || info.Subtitles[0].Lang != "en" || info.Subtitles[1].Name != "中文（台灣）" ||
		strings.Join(info.Subtitles[0].Exts, ",") != "json3,vtt" {
		t.Errorf("subtitles: %+v", info.Subtitles)
	}
	if len(info.AutoCaptions) != 3 || info.AutoCaptions[0].Lang != "en" || info.AutoCaptions[1].Lang != "en-orig" {
		t.Errorf("auto captions: %+v", info.AutoCaptions)
	}
	b, _ := json.Marshal(info)
	for _, bad := range []string{"://", "googlevideo", "description", "thumbnail"} {
		if strings.Contains(string(b), bad) {
			t.Errorf("slim info must not contain %q", bad)
		}
	}

	live, _ := ParseInfo([]byte(`{"id":"x","is_live":true,"formats":[]}`))
	if live.LiveStatus != "is_live" || !live.IsLive {
		t.Errorf("live: %+v", live)
	}
}

func TestFitInfo(t *testing.T) {
	info, _ := ParseInfo(readFixture(t))
	for i := 0; i < 2000; i++ {
		info.AutoCaptions = append(info.AutoCaptions, SubTrack{Lang: "xx", Name: strings.Repeat("n", 100)})
	}
	b, _ := json.Marshal(info)
	limit := len(b) / 2
	FitInfo(info, limit)
	b, _ = json.Marshal(info)
	if len(b) > limit || !info.Truncated || len(info.Formats) == 0 {
		t.Fatalf("size %d > %d or formats dropped: %d", len(b), limit, len(info.Formats))
	}
	// 畫質最高的格式要保留。
	if info.Formats[len(info.Formats)-1].ID != "401" {
		t.Errorf("best format dropped")
	}
}

func fakeTools(t *testing.T) *Tools {
	t.Helper()
	dir := testenv.FakeYtDlpDir(t)
	env := SystemEnv()
	tools := &Tools{Env: env, YtDlp: filepath.Join(dir, "yt-dlp")}
	if env.GOOS == "windows" {
		tools.YtDlp += ".exe"
	}
	return tools
}

func TestRunWithFake(t *testing.T) {
	tools := fakeTools(t)
	ctx := context.Background()
	t.Setenv("FAKE_YTDLP_VERSION", "2099.01.02")
	if v, err := tools.YtDlpVersion(ctx); err != nil || v != "2099.01.02" {
		t.Fatalf("version: %q %v", v, err)
	}
	info, err := tools.GetInfo(ctx, "jNQXAC9IVRw")
	if err != nil || info.ID != "jNQXAC9IVRw" || len(info.Formats) == 0 {
		t.Fatalf("getInfo: %+v %v", info, err)
	}
	for scenario, code := range map[string]errs.Code{
		"login": errs.LoginRequired, "bot": errs.VerificationRequired, "network": errs.Network,
		"outdated": errs.YtDlpOutdated, "unavailable": errs.VideoUnavailable, "crash": errs.Unknown,
	} {
		t.Setenv("FAKE_YTDLP_SCENARIO", scenario)
		_, err := tools.GetInfo(ctx, "jNQXAC9IVRw")
		if e := errs.From(err); e == nil || e.Code != code {
			t.Errorf("%s: got %v, want %s", scenario, err, code)
		}
	}
	missing := &Tools{Env: tools.Env}
	if _, err := missing.GetInfo(ctx, "jNQXAC9IVRw"); errs.From(err).Code != errs.YtDlpNotFound {
		t.Errorf("missing yt-dlp: %v", err)
	}
	if _, err := missing.FFmpegVersion(ctx); errs.From(err).Code != errs.FFmpegNotFound {
		t.Errorf("missing ffmpeg: %v", err)
	}
}

func TestFindDeno(t *testing.T) {
	mac := fakeEnv("darwin", map[string]string{"PATH": "/usr/bin:/bin"}, "/opt/homebrew/bin/deno")
	if got := mac.Find("deno"); got != "/opt/homebrew/bin/deno" {
		t.Errorf("darwin deno = %q", got)
	}
	la := `C:\Users\me\AppData\Local`
	deno := la + `\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe`
	win := fakeEnv("windows", map[string]string{"LOCALAPPDATA": la, "PATH": `C:\Windows`}, deno)
	if got := win.Find("deno"); got != deno {
		t.Errorf("windows deno = %q", got)
	}
	// deno 所在的資料夾要加進 yt-dlp 的 PATH。
	want := `C:\Windows;` + la + `\Microsoft\WinGet\Links;` + la + `\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe`
	if got := win.ChildPath("", deno); got != want {
		t.Errorf("ChildPath = %q", got)
	}
}

func TestDenoVersion(t *testing.T) {
	dir := testenv.FakeToolsDir(t, "deno")
	exe := ""
	if SystemEnv().GOOS == "windows" {
		exe = ".exe"
	}
	tools := &Tools{Env: SystemEnv(), Deno: filepath.Join(dir, "deno"+exe)}
	if v, err := tools.DenoVersion(context.Background()); err != nil || v != "2.1.4" {
		t.Fatalf("deno version: %q %v", v, err)
	}
	if _, err := (&Tools{Env: SystemEnv()}).DenoVersion(context.Background()); errs.From(err).Code != errs.DenoNotFound {
		t.Fatalf("missing deno: %v", err)
	}
}

func TestChildEnv(t *testing.T) {
	tools := &Tools{Env: fakeEnv("darwin", map[string]string{"PATH": "/usr/bin:/bin"}), YtDlp: "/x/yt-dlp", FFmpeg: "/opt/homebrew/bin/ffmpeg"}
	env := strings.Join(tools.ChildEnv(), "\n")
	for _, want := range []string{"PATH=/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin", "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8"} {
		if !strings.Contains(env, want) {
			t.Errorf("missing %s", want)
		}
	}
	if strings.Count(env, "\nPATH=")+boolInt(strings.HasPrefix(env, "PATH=")) != 1 {
		t.Error("PATH must appear once")
	}
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
