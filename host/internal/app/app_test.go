package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/jobs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
	"github.com/chidi0716/yt-toolbar-master/host/internal/ytdlp"
)

func TestRevealAndUpdate(t *testing.T) {
	m := &jobs.Manager{
		Store:  &jobs.Store{Dir: filepath.Join(t.TempDir(), "jobs")},
		Client: "chrome",
		Spawn:  func(string) (int, error) { return os.Getpid(), nil }, // 不實際執行
		Emit:   func(*jobs.Event) error { return nil },
	}
	m.Init()
	a := &App{Version: "x", Env: envWithPath(testenv.FakeToolsDir(t, "ffmpeg", "deno")), Manager: m, Actions: platform.NewActions()}
	ctx := context.Background()
	if _, err := a.Reveal(ctx, "0123456789abcdef"); errs.From(err).Code != errs.JobNotFound {
		t.Errorf("unknown job: %v", err)
	}
	dir := t.TempDir()
	v, err := a.Download(ctx, &validate.Download{VideoID: "dQw4w9WgXcQ", Kind: "mp3", Bitrate: 192, Dir: dir, NamePreset: "title-id", Embed: true})
	if err != nil {
		t.Fatal(err)
	}
	id := v.(*DownloadResult).JobID
	if _, err := a.Reveal(ctx, id); errs.From(err).Code != errs.JobNotFinished {
		t.Errorf("unfinished job: %v", err)
	}
	// 完成後檔案被刪除：FILE_NOT_FOUND。
	st, _ := m.Store.ReadStatus(id)
	st.State, st.Path = jobs.StateDone, filepath.Join(dir, "gone.mp3")
	m.Store.WriteStatus(st)
	if _, err := a.Reveal(ctx, id); errs.From(err).Code != errs.FileNotFound {
		t.Errorf("deleted file: %v", err)
	}
	r, err := a.UpdateYtDlp(ctx)
	if err != nil || !r.(*ytdlp.UpdateResult).UpToDate {
		t.Errorf("update: %+v %v", r, err)
	}
	// 沒有 ffmpeg 時，影片下載立即回報 FFMPEG_NOT_FOUND。
	a.Env = envWithPath(testenv.FakeToolsDir(t))
	_, err = a.Download(ctx, &validate.Download{VideoID: "dQw4w9WgXcQ", Kind: "video", FormatID: "18", Container: "mp4", Dir: dir, NamePreset: "title-id"})
	if errs.From(err).Code != errs.FFmpegNotFound {
		t.Errorf("no ffmpeg: %v", err)
	}
}

func TestMain(m *testing.M) { testenv.Main(m) }

// envWithPath 讓 App 只在 dir 中尋找執行檔（不受測試機器上安裝的程式影響）。
func envWithPath(dir string) ytdlp.Env {
	e := ytdlp.SystemEnv()
	e.GOOS = runtime.GOOS
	e.Getenv = func(k string) string {
		if k == "PATH" {
			return dir
		}
		return os.Getenv(k)
	}
	e.LookPath = func(name string) (string, error) {
		p := filepath.Join(dir, name)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
		return "", errors.New("not found")
	}
	e.Glob = func(string) ([]string, error) { return nil, nil }
	e.IsFile = func(string) bool { return false }
	return e
}

func TestStatus(t *testing.T) {
	a := &App{Version: "1.2.3", Env: envWithPath(testenv.FakeToolsDir(t, "ffmpeg", "deno"))}
	v, err := a.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	s := v.(*StatusResult)
	if !s.Ready || !s.Complete || s.HostVersion != "1.2.3" || s.YtDlp.Version != "2026.10.21" ||
		s.FFmpeg.Version != "7.1-fake" || s.Deno.Version != "2.1.4" || !s.Deno.Found {
		t.Fatalf("%+v", s)
	}
	if len(s.Missing) != 0 || s.InstallCommand != "" || s.YtDlp.Error != "" || s.Deno.Error != "" {
		t.Fatalf("nothing should be missing: %+v", s)
	}
	if s.DefaultDir == "" || len(s.NamePresets) != 4 || s.NamePresets[0].ID != "title-id" {
		t.Fatalf("%+v", s)
	}

	// deno 缺少時仍可下載（ready），但不完整，並列出缺少的元件。
	a.Env = envWithPath(testenv.FakeToolsDir(t, "ffmpeg"))
	v, _ = a.Status(context.Background())
	s = v.(*StatusResult)
	if !s.Ready || s.Complete || s.Deno.Found || s.Deno.Error != "DENO_NOT_FOUND" || strings.Join(s.Missing, ",") != "deno" {
		t.Fatalf("without deno: %+v", s)
	}

	a.Env = envWithPath(testenv.FakeToolsDir(t))
	v, _ = a.Status(context.Background())
	s = v.(*StatusResult)
	if s.Ready || !s.YtDlp.Found || s.FFmpeg.Found || s.FFmpeg.Error != "FFMPEG_NOT_FOUND" || strings.Join(s.Missing, ",") != "ffmpeg,deno" {
		t.Fatalf("without ffmpeg: %+v", s)
	}

	a.Env = envWithPath(t.TempDir())
	v, _ = a.Status(context.Background())
	s = v.(*StatusResult)
	if s.Ready || s.Complete || s.YtDlp.Found || s.FFmpeg.Found || s.YtDlp.Error != "YTDLP_NOT_FOUND" ||
		strings.Join(s.Missing, ",") != "yt-dlp,ffmpeg,deno" {
		t.Fatalf("nothing installed: %+v", s)
	}
}

func TestInstallCommand(t *testing.T) {
	all := []string{"yt-dlp", "ffmpeg", "deno"}
	if got := InstallCommand("darwin", all); got != "brew install yt-dlp ffmpeg deno" {
		t.Errorf("darwin: %s", got)
	}
	if got := InstallCommand("windows", all); got != "winget install yt-dlp.yt-dlp Gyan.FFmpeg DenoLand.Deno" {
		t.Errorf("windows: %s", got)
	}
	if got := InstallCommand("windows", []string{"deno"}); got != "winget install DenoLand.Deno" {
		t.Errorf("windows deno: %s", got)
	}
	if InstallCommand("darwin", nil) != "" || InstallCommand("linux", all) != "" {
		t.Error("expected empty command")
	}
}

func TestGetInfo(t *testing.T) {
	a := &App{Version: "x", Env: envWithPath(testenv.FakeToolsDir(t, "ffmpeg", "deno"))}
	v, err := a.GetInfo(context.Background(), "jNQXAC9IVRw")
	if err != nil {
		t.Fatal(err)
	}
	if info := v.(*ytdlp.Info); info.ID != "jNQXAC9IVRw" || info.Title == "" {
		t.Fatalf("%+v", info)
	}
	a.Env = envWithPath(t.TempDir())
	if _, err := a.GetInfo(context.Background(), "jNQXAC9IVRw"); errs.From(err).Code != errs.YtDlpNotFound {
		t.Fatalf("missing: %v", err)
	}
}
