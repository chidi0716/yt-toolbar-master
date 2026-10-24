package ytdlp

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
)

// TestRealYtDlpLocal 用真正的 yt-dlp 對本機測試伺服器上的影片執行 DownloadArgs 組出的參數，
// 確認 yt-dlp 接受全部選項、輸出格式與解析器一致。不連 YouTube。
//
// 只在設定 YTM_REAL_YTDLP（yt-dlp 的路徑）時執行，並需要系統上有 ffmpeg：
//
//	YTM_REAL_YTDLP=$PWD/../spikes/stage3/.cache/bin/yt-dlp go test ./internal/ytdlp -run Real -v
func TestRealYtDlpLocal(t *testing.T) {
	bin := os.Getenv("YTM_REAL_YTDLP")
	if bin == "" {
		t.Skip("YTM_REAL_YTDLP is not set")
	}
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	www := t.TempDir()
	src := filepath.Join(www, "test.mp4")
	gen := exec.Command(ffmpeg, "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-f", "lavfi", "-i", "sine=frequency=440",
		"-t", "20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v %s", err, out)
	}
	srv := httptest.NewServer(http.FileServer(http.Dir(www)))
	defer srv.Close()

	tools := &Tools{Env: SystemEnv(), YtDlp: bin, FFmpeg: ffmpeg}
	cases := []*validate.Download{
		{VideoID: "dQw4w9WgXcQ", Kind: "video", FormatID: "mp4", Container: "mp4", NamePreset: "title-id", Embed: true},
		{VideoID: "dQw4w9WgXcQ", Kind: "video", FormatID: "mp4", Container: "mp4", NamePreset: "title-id", Embed: true,
			Section: &validate.Section{Start: 3, End: 8}},
		{VideoID: "dQw4w9WgXcQ", Kind: "mp3", Bitrate: 128, NamePreset: "date-title", Embed: true,
			Section: &validate.Section{Start: 2, End: 6}},
	}
	for _, d := range cases {
		tmp := t.TempDir()
		args := DownloadArgs(d, tmp, ffmpeg)
		args[len(args)-1] = srv.URL + "/test.mp4" // 只有這個測試把網址換成本機伺服器
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		cmd, _ := tools.Command(ctx, args...)
		stdout, _ := cmd.StdoutPipe()
		stderr, _ := cmd.StderrPipe()
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		var mu sync.Mutex
		var file string
		var progress, post int
		var all []string
		var wg sync.WaitGroup
		read := func(r io.Reader) {
			defer wg.Done()
			sc := bufio.NewScanner(r)
			for sc.Scan() {
				l := ParseLine(sc.Text())
				mu.Lock()
				all = append(all, sc.Text())
				switch l.Kind {
				case LineProgress:
					progress++
				case LinePost:
					post++
				case LineFile:
					file = l.Path
				}
				mu.Unlock()
			}
		}
		wg.Add(2)
		go read(stdout)
		go read(stderr)
		wg.Wait()
		err := cmd.Wait()
		cancel()
		if err != nil {
			t.Fatalf("%s: %v\n%s", d.Kind, err, strings.Join(all, "\n"))
		}
		if file == "" || progress == 0 || post == 0 || !strings.HasPrefix(file, tmp) {
			t.Fatalf("%s: file=%q progress=%d post=%d\n%s", d.Kind, file, progress, post, strings.Join(all, "\n"))
		}
		st, err := os.Stat(file)
		if err != nil || st.Size() == 0 {
			t.Fatalf("%s: output missing: %v", d.Kind, err)
		}
		t.Logf("%s section=%v -> %s (%d bytes, %d progress lines, %d post lines)", d.Kind, d.Section, filepath.Base(file), st.Size(), progress, post)
	}
}
