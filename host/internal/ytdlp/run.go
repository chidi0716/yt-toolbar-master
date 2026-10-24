package ytdlp

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
)

// 各種呼叫的時限。
const (
	VersionTimeout = 30 * time.Second
	InfoTimeout    = 90 * time.Second
	UpdateTimeout  = 5 * time.Minute
	// maxInfoOutput 是 yt-dlp -J 輸出的上限；超過代表輸出不正常。
	maxInfoOutput = 64 * 1024 * 1024
)

// Tools 是找到的 yt-dlp、ffmpeg 與 deno。路徑為空字串代表沒找到。
// deno 是 yt-dlp 取得 YouTube 完整格式所需的 JavaScript 執行環境（002 FR-2、Q39），
// 橋接程式本身不執行它，只把它所在的資料夾加進 yt-dlp 的 PATH，並在 status 回報。
type Tools struct {
	Env     Env
	YtDlp   string
	FFmpeg  string
	FFprobe string
	Deno    string
}

// Locate 尋找 yt-dlp 與 ffmpeg。
func Locate(env Env) *Tools {
	return &Tools{Env: env, YtDlp: env.Find("yt-dlp"), FFmpeg: env.Find("ffmpeg"), FFprobe: env.Find("ffprobe"), Deno: env.Find("deno")}
}

// ChildEnv 回傳 yt-dlp 子程序的環境變數：補上 PATH，並要求 Python 以 UTF-8 輸出
// （Windows 的主控台編碼不一定能表示影片標題中的字元）。
func (t *Tools) ChildEnv() []string {
	env := os.Environ()
	env = setEnv(env, "PATH", t.Env.ChildPath(t.FFmpeg, t.Deno), t.Env.GOOS == "windows")
	env = setEnv(env, "PYTHONUTF8", "1", t.Env.GOOS == "windows")
	env = setEnv(env, "PYTHONIOENCODING", "utf-8", t.Env.GOOS == "windows")
	return env
}

func setEnv(env []string, key, value string, foldCase bool) []string {
	out := env[:0:0]
	for _, kv := range env {
		k, _, _ := strings.Cut(kv, "=")
		if k == key || (foldCase && strings.EqualFold(k, key)) {
			continue
		}
		out = append(out, kv)
	}
	return append(out, key+"="+value)
}

// Command 建立執行 yt-dlp 的 exec.Cmd（參數以陣列傳入，不經過 shell）。
func (t *Tools) Command(ctx context.Context, args ...string) (*exec.Cmd, error) {
	if t.YtDlp == "" {
		return nil, errs.New(errs.YtDlpNotFound, "yt-dlp was not found")
	}
	cmd := exec.CommandContext(ctx, t.YtDlp, args...)
	cmd.Env = t.ChildEnv()
	platform.HideConsole(cmd)
	return cmd, nil
}

// limitedBuffer 超過上限後丟棄後續內容並記錄溢位。
type limitedBuffer struct {
	buf      bytes.Buffer
	limit    int
	overflow bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.buf.Len()+len(p) > b.limit {
		b.overflow = true
		return len(p), nil
	}
	return b.buf.Write(p)
}

// run 執行 yt-dlp 並回傳 stdout；失敗時依 stderr 分類錯誤。
func (t *Tools) run(ctx context.Context, timeout time.Duration, limit int, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd, err := t.Command(ctx, args...)
	if err != nil {
		return nil, err
	}
	stdout := &limitedBuffer{limit: limit}
	stderr := &limitedBuffer{limit: 1024 * 1024}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	cmd.WaitDelay = 5 * time.Second
	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, errs.New(errs.Timeout, "yt-dlp did not finish in %s", timeout)
	}
	if ctx.Err() != nil {
		return nil, errs.New(errs.Unknown, "cancelled")
	}
	if err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			return nil, errs.New(errs.YtDlpNotFound, "could not run yt-dlp: %v", err)
		}
		return nil, Classify(lines(stderr.buf.Bytes(), stdout.buf.Bytes()))
	}
	if stdout.overflow {
		return nil, errs.New(errs.Unknown, "yt-dlp output is too large")
	}
	return stdout.buf.Bytes(), nil
}

func lines(chunks ...[]byte) []string {
	var out []string
	for _, c := range chunks {
		sc := bufio.NewScanner(bytes.NewReader(c))
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			out = append(out, sc.Text())
		}
	}
	return out
}

// YtDlpVersion 執行 yt-dlp --version。
func (t *Tools) YtDlpVersion(ctx context.Context) (string, error) {
	out, err := t.run(ctx, VersionTimeout, 64*1024, "--ignore-config", "--version")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(firstLine(string(out))), nil
}

var ffmpegVersionRe = regexp.MustCompile(`(?i)^ffmpeg version (\S+)`)

// FFmpegVersion 執行 ffmpeg -version，回傳版本字串。
func (t *Tools) FFmpegVersion(ctx context.Context) (string, error) {
	if t.FFmpeg == "" {
		return "", errs.New(errs.FFmpegNotFound, "ffmpeg was not found")
	}
	ctx, cancel := context.WithTimeout(ctx, VersionTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, t.FFmpeg, "-hide_banner", "-version")
	platform.HideConsole(cmd)
	out, err := cmd.Output()
	if err != nil {
		// 有些版本不接受 -hide_banner 與 -version 同時使用，改用單純的 -version。
		cmd = exec.CommandContext(ctx, t.FFmpeg, "-version")
		platform.HideConsole(cmd)
		if out, err = cmd.Output(); err != nil {
			return "", errs.New(errs.FFmpegNotFound, "could not run ffmpeg: %v", err)
		}
	}
	if m := ffmpegVersionRe.FindStringSubmatch(firstLine(string(out))); m != nil {
		return m[1], nil
	}
	return strings.TrimSpace(firstLine(string(out))), nil
}

var ffprobeVersionRe = regexp.MustCompile(`(?i)^ffprobe version (\S+)`)

// FFprobeVersion 執行 ffprobe -version，回傳版本字串。
func (t *Tools) FFprobeVersion(ctx context.Context) (string, error) {
	if t.FFprobe == "" {
		return "", errs.New(errs.FFmpegNotFound, "ffprobe was not found")
	}
	ctx, cancel := context.WithTimeout(ctx, VersionTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, t.FFprobe, "-version")
	platform.HideConsole(cmd)
	out, err := cmd.Output()
	if err != nil {
		return "", errs.New(errs.FFmpegNotFound, "could not run ffprobe: %v", err)
	}
	if m := ffprobeVersionRe.FindStringSubmatch(firstLine(string(out))); m != nil {
		return m[1], nil
	}
	return strings.TrimSpace(firstLine(string(out))), nil
}

var denoVersionRe = regexp.MustCompile(`(?i)^deno (\S+)`)

// DenoVersion 執行 deno --version，回傳版本字串（例如 2.1.4）。
func (t *Tools) DenoVersion(ctx context.Context) (string, error) {
	if t.Deno == "" {
		return "", errs.New(errs.DenoNotFound, "deno was not found")
	}
	ctx, cancel := context.WithTimeout(ctx, VersionTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, t.Deno, "--version")
	platform.HideConsole(cmd)
	out, err := cmd.Output()
	if err != nil {
		return "", errs.New(errs.DenoNotFound, "could not run deno: %v", err)
	}
	if m := denoVersionRe.FindStringSubmatch(firstLine(string(out))); m != nil {
		return m[1], nil
	}
	return strings.TrimSpace(firstLine(string(out))), nil
}

func firstLine(s string) string {
	l, _, _ := strings.Cut(s, "\n")
	return strings.TrimRight(l, "\r")
}

// GetInfo 執行 yt-dlp -J 並回傳精簡後的資料。
func (t *Tools) GetInfo(ctx context.Context, videoID string) (*Info, error) {
	out, err := t.run(ctx, InfoTimeout, maxInfoOutput, InfoArgs(videoID)...)
	if err != nil {
		return nil, err
	}
	info, err := ParseInfo(out)
	if err != nil {
		return nil, errs.New(errs.YtDlpOutdated, "could not parse yt-dlp output: %v", err)
	}
	return info, nil
}

// ManagerOf 判斷 yt-dlp 是否由套件管理工具安裝（Homebrew、winget 等）。
func (t *Tools) ManagerOf() string {
	if t.YtDlp == "" {
		return ""
	}
	resolved, err := filepath.EvalSymlinks(t.YtDlp)
	if err != nil {
		resolved = t.YtDlp
	}
	var head []byte
	if f, err := os.Open(resolved); err == nil {
		head = make([]byte, 512)
		n, _ := f.Read(head)
		head = head[:n]
		f.Close()
	}
	return Manager(t.Env.GOOS, t.YtDlp, resolved, head)
}
