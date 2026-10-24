// Package e2e 是橋接程式的端到端測試：編譯真正的 ytm-host 與假 yt-dlp，
// 模擬瀏覽器經由 stdin/stdout 送出原生訊息（4 位元組長度＋JSON），確認協定與完整流程。
package e2e

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
)

func TestMain(m *testing.M) { testenv.Main(m) }

const chromeOrigin = "chrome-extension://bkjlangdjfpllnkcpfpdlajchbginjdj/"

var (
	hostOnce sync.Once
	hostBin  string
	hostErr  error
)

func buildHost(t *testing.T) string {
	t.Helper()
	hostOnce.Do(func() {
		dir, err := os.MkdirTemp("", "host-bin-")
		if err != nil {
			hostErr = err
			return
		}
		hostBin, hostErr = testenv.Build(dir, "ytm-host", "./cmd/ytm-host")
	})
	if hostErr != nil {
		t.Fatal(hostErr)
	}
	return hostBin
}

// browser 模擬瀏覽器端：啟動橋接程式並交換訊息。
type browser struct {
	t      *testing.T
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	msgs   chan map[string]any
	nextID int
	log    *strings.Builder
	exited chan struct{}
}

type env struct {
	home  string // 假的家目錄：狀態資料夾與記錄檔都在這裡
	tools string // 假 yt-dlp 與 ffmpeg 所在的資料夾（唯一的 PATH）
	extra []string
}

func (e env) vars() []string {
	v := []string{"HOME=" + e.home, "PATH=" + e.tools, "LOCALAPPDATA=" + filepath.Join(e.home, "AppData", "Local")}
	if runtime.GOOS == "windows" {
		v = append(v, "USERPROFILE="+e.home, "SystemRoot="+os.Getenv("SystemRoot"))
	}
	if tmp := os.Getenv("TMPDIR"); tmp != "" {
		v = append(v, "TMPDIR="+tmp)
	}
	return append(v, e.extra...)
}

func start(t *testing.T, e env, args ...string) *browser {
	t.Helper()
	cmd := exec.Command(buildHost(t), args...)
	cmd.Env = e.vars()
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	b := &browser{t: t, cmd: cmd, stdin: stdin, msgs: make(chan map[string]any, 1000), log: &strings.Builder{}, exited: make(chan struct{})}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	go func() {
		r := bufio.NewReader(stdout)
		for {
			var hdr [4]byte
			if _, err := io.ReadFull(r, hdr[:]); err != nil {
				close(b.msgs)
				return
			}
			n := binary.NativeEndian.Uint32(hdr[:])
			if n > 1024*1024 {
				t.Errorf("message of %d bytes exceeds 1MB", n)
			}
			body := make([]byte, n)
			if _, err := io.ReadFull(r, body); err != nil {
				close(b.msgs)
				return
			}
			var m map[string]any
			if err := json.Unmarshal(body, &m); err != nil {
				t.Errorf("invalid JSON from host: %s", body)
				continue
			}
			b.msgs <- m
		}
	}()
	go func() {
		cmd.Wait()
		close(b.exited)
	}()
	t.Cleanup(func() {
		stdin.Close()
		select {
		case <-b.exited:
		case <-time.After(20 * time.Second):
			cmd.Process.Kill()
		}
	})
	return b
}

func (b *browser) sendRaw(body string) {
	b.t.Helper()
	msg := make([]byte, 4+len(body))
	binary.NativeEndian.PutUint32(msg, uint32(len(body)))
	copy(msg[4:], body)
	if _, err := b.stdin.Write(msg); err != nil {
		b.t.Fatal(err)
	}
}

// request 送出請求並等待對應的回應；期間收到的事件交給 onEvent。
func (b *browser) request(cmd string, args any, onEvent func(map[string]any)) map[string]any {
	b.t.Helper()
	b.nextID++
	id := fmt.Sprintf("req-%d", b.nextID)
	body, _ := json.Marshal(map[string]any{"id": id, "cmd": cmd, "args": args})
	b.sendRaw(string(body))
	fmt.Fprintf(b.log, "→ %s\n", body)
	for {
		select {
		case m, ok := <-b.msgs:
			if !ok {
				b.t.Fatalf("host closed the connection while waiting for %s", cmd)
			}
			if m["event"] != nil {
				if onEvent != nil {
					onEvent(m)
				}
				continue
			}
			if m["id"] == id {
				out, _ := json.Marshal(m)
				fmt.Fprintf(b.log, "← %s\n", truncate(string(out), 400))
				return m
			}
			b.t.Fatalf("unexpected message %v", m)
		case <-time.After(60 * time.Second):
			b.t.Fatalf("timeout waiting for %s", cmd)
		}
	}
}

// waitEvent 等待符合條件的事件。
func (b *browser) waitEvent(match func(map[string]any) bool) map[string]any {
	b.t.Helper()
	for {
		select {
		case m, ok := <-b.msgs:
			if !ok {
				b.t.Fatal("host closed the connection while waiting for an event")
			}
			if m["event"] == nil {
				b.t.Fatalf("unexpected response %v", m)
			}
			out, _ := json.Marshal(m)
			fmt.Fprintf(b.log, "← (event) %s\n", truncate(string(out), 400))
			if match(m) {
				return m
			}
		case <-time.After(60 * time.Second):
			b.t.Fatal("timeout waiting for an event")
		}
	}
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func ok(t *testing.T, resp map[string]any) map[string]any {
	t.Helper()
	if resp["ok"] != true {
		t.Fatalf("expected ok, got %v", resp)
	}
	r, _ := resp["result"].(map[string]any)
	return r
}

func errCode(resp map[string]any) string {
	e, _ := resp["error"].(map[string]any)
	s, _ := e["code"].(string)
	return s
}

func newEnv(t *testing.T, extra ...string) env {
	return env{home: t.TempDir(), tools: testenv.FakeToolsDir(t, "ffmpeg", "deno"), extra: extra}
}

func TestEndToEnd(t *testing.T) {
	e := newEnv(t, "FAKE_YTDLP_DELAY_MS=60")
	dl := filepath.Join(e.home, "Downloads")
	os.MkdirAll(dl, 0o755)
	b := start(t, e, chromeOrigin)
	defer func() { t.Logf("transcript:\n%s", b.log) }()

	// status
	st := ok(t, b.request("status", nil, nil))
	versions := map[string]any{}
	for _, c := range st["components"].([]any) {
		c := c.(map[string]any)
		versions[c["name"].(string)] = c["version"]
	}
	if st["ready"] != true || st["complete"] != true || versions["deno"] != "2.1.4" || versions["yt-dlp"] != "2026.10.21" || versions["ffmpeg"] != "7.1-fake" {
		t.Fatalf("status: %v", st)
	}

	// getInfo
	info := ok(t, b.request("getInfo", map[string]any{"videoId": "jNQXAC9IVRw"}, nil))
	if info["id"] != "jNQXAC9IVRw" || len(info["formats"].([]any)) != 10 || info["liveStatus"] != "not_live" {
		t.Fatalf("getInfo: %v", info)
	}

	// 非法指令與參數
	if r := b.request("exec", map[string]any{"cmd": "ls"}, nil); errCode(r) != "UNKNOWN_COMMAND" {
		t.Errorf("unknown command: %v", r)
	}
	if r := b.request("getInfo", map[string]any{"videoId": "../../etc/x"}, nil); errCode(r) != "INVALID_ARGS" {
		t.Errorf("bad video id: %v", r)
	}
	if r := b.request("download", map[string]any{"videoId": "jNQXAC9IVRw", "kind": "mp3", "bitrate": 192, "dir": dl + "/../.."}, nil); errCode(r) != "INVALID_ARGS" {
		t.Errorf("dir with ..: %v", r)
	}
	// 下載資料夾不存在：PERMISSION_DENIED（T15b）
	if r := b.request("download", map[string]any{"videoId": "jNQXAC9IVRw", "kind": "mp3", "bitrate": 192, "dir": dl + "/missing-folder"}, nil); errCode(r) != "PERMISSION_DENIED" {
		t.Errorf("missing dir: %v", r)
	}
	b.sendRaw(`{"id":"broken"`)
	if m := <-b.msgs; m["ok"] != false || m["id"] != nil {
		t.Errorf("malformed request: %v", m)
	}

	// download（影片）：收到進度與完成事件
	res := ok(t, b.request("download", map[string]any{
		"videoId": "jNQXAC9IVRw", "kind": "video", "formatId": "137+140", "container": "mp4", "dir": dl,
	}, nil))
	jobID := res["jobId"].(string)
	progress := 0
	done := b.waitEvent(func(m map[string]any) bool {
		if m["jobId"] != jobID {
			return false
		}
		if m["event"] == "progress" {
			progress++
		}
		return m["event"] == "done" || m["event"] == "failed"
	})
	if done["event"] != "done" || done["fileName"] != "測試影片： Fake⧸Video？ [jNQXAC9IVRw].mp4" {
		t.Fatalf("done: %v", done)
	}
	if _, err := os.Stat(done["path"].(string)); err != nil {
		t.Fatalf("downloaded file: %v", err)
	}

	// jobs
	jobs := ok(t, b.request("jobs", nil, nil))["jobs"].([]any)
	if len(jobs) != 1 || jobs[0].(map[string]any)["state"] != "done" || jobs[0].(map[string]any)["missed"] != false {
		t.Fatalf("jobs: %v", jobs)
	}

	// reveal（Linux 不支援，但要先通過工作檢查）
	if r := b.request("reveal", map[string]any{"jobId": jobID}, nil); runtime.GOOS == "linux" && errCode(r) != "UNSUPPORTED_PLATFORM" {
		t.Errorf("reveal: %v", r)
	}

	// download（MP3，裁切）：檔名加上時間範圍
	mp3ID := ok(t, b.request("download", map[string]any{
		"videoId": "dQw4w9WgXcQ", "kind": "mp3", "bitrate": 320, "dir": dl, "section": map[string]any{"start": 60, "end": 120},
	}, nil))["jobId"].(string)
	done = b.waitEvent(func(m map[string]any) bool {
		return m["jobId"] == mp3ID && (m["event"] == "done" || m["event"] == "failed")
	})
	if done["fileName"] != "測試影片： Fake⧸Video？ [dQw4w9WgXcQ] 01m00s-02m00s.mp3" {
		t.Fatalf("mp3 done: %v", done)
	}
	if progress == 0 {
		t.Error("no progress events for the video job")
	}
}

func TestCancelEndToEnd(t *testing.T) {
	e := newEnv(t, "FAKE_YTDLP_SCENARIO=slow")
	dl := filepath.Join(e.home, "Downloads")
	os.MkdirAll(dl, 0o755)
	b := start(t, e, chromeOrigin)
	defer func() { t.Logf("transcript:\n%s", b.log) }()

	jobID := ok(t, b.request("download", map[string]any{
		"videoId": "jNQXAC9IVRw", "kind": "video", "formatId": "18", "container": "mp4", "dir": dl,
	}, nil))["jobId"].(string)
	b.waitEvent(func(m map[string]any) bool {
		return m["jobId"] == jobID && m["event"] == "progress" && m["percent"] != nil
	})
	r := ok(t, b.request("cancel", map[string]any{"jobId": jobID}, nil))
	if r["state"] != "cancelled" {
		t.Fatalf("cancel: %v", r)
	}
	entries, _ := os.ReadDir(dl)
	if len(entries) != 0 {
		t.Fatalf("cancel left files: %v", entries)
	}
	jobs := ok(t, b.request("jobs", nil, nil))["jobs"].([]any)
	if jobs[0].(map[string]any)["state"] != "cancelled" {
		t.Fatalf("jobs: %v", jobs)
	}
	if r := b.request("reveal", map[string]any{"jobId": jobID}, nil); errCode(r) != "JOB_NOT_FINISHED" {
		t.Errorf("reveal cancelled job: %v", r)
	}
}

// TestDownloadSurvivesHost 確認瀏覽器關閉連線（甚至強制結束橋接程式）後，下載仍會完成，
// 並在下次連線時以 missed 補報（plan 4.6）。
func TestDownloadSurvivesHost(t *testing.T) {
	e := newEnv(t, "FAKE_YTDLP_DELAY_MS=150")
	dl := filepath.Join(e.home, "Downloads")
	os.MkdirAll(dl, 0o755)

	b := start(t, e, chromeOrigin)
	jobID := ok(t, b.request("download", map[string]any{
		"videoId": "jNQXAC9IVRw", "kind": "mp3", "bitrate": 128, "dir": dl,
	}, nil))["jobId"].(string)
	// 瀏覽器結束：強制結束小幫手（模擬瀏覽器關閉連線後結束程序）。
	b.cmd.Process.Kill()
	<-b.exited

	// 下載由獨立的執行程序完成。
	deadline := time.Now().Add(30 * time.Second)
	for {
		if entries, _ := os.ReadDir(dl); len(entries) == 1 && strings.HasSuffix(entries[0].Name(), ".mp3") {
			break
		}
		if time.Now().After(deadline) {
			entries, _ := os.ReadDir(dl)
			t.Fatalf("download did not finish after the host was killed: %v", entries)
		}
		time.Sleep(100 * time.Millisecond)
	}

	// 重新連線：jobs 補報一次 missed，之後不再補報；Firefox 看不到 Chrome 的工作。
	b2 := start(t, e, chromeOrigin)
	jobs := ok(t, b2.request("jobs", nil, nil))["jobs"].([]any)
	j := jobs[0].(map[string]any)
	if j["jobId"] != jobID || j["state"] != "done" || j["missed"] != true {
		t.Fatalf("after reconnect: %v", jobs)
	}
	j = ok(t, b2.request("jobs", nil, nil))["jobs"].([]any)[0].(map[string]any)
	if j["missed"] != false {
		t.Fatalf("missed must be reported once: %v", j)
	}
	ff := start(t, e, filepath.Join(e.home, "x.json"), "yt-toolbar-master@chidi0716")
	if jobs := ok(t, ff.request("jobs", nil, nil))["jobs"].([]any); len(jobs) != 0 {
		t.Fatalf("firefox sees chrome jobs: %v", jobs)
	}

	// stdin 結束且沒有進行中的下載：橋接程式立即結束。
	b2.stdin.Close()
	select {
	case <-b2.exited:
	case <-time.After(10 * time.Second):
		t.Fatal("host did not exit after stdin closed")
	}

	// 記錄檔：只在假的家目錄中，且不含家目錄路徑。
	logs, _ := filepath.Glob(filepath.Join(e.home, "*", "*", "*", "logs", "host.log"))
	if runtime.GOOS == "linux" && len(logs) != 1 {
		t.Fatalf("log file not found under the fake home: %v", logs)
	}
	for _, l := range logs {
		b, _ := os.ReadFile(l)
		if strings.Contains(string(b), e.home) {
			t.Errorf("log contains the home directory:\n%s", b)
		}
		t.Logf("host.log:\n%s", b)
	}
}

func TestRejectsUnknownCaller(t *testing.T) {
	e := newEnv(t)
	for _, args := range [][]string{nil, {"chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"}, {"x.json", "evil@example.com"}, {"--run-job", "../x"}} {
		cmd := exec.Command(buildHost(t), args...)
		cmd.Env = e.vars()
		out, err := cmd.CombinedOutput()
		if err == nil {
			t.Errorf("%v: expected failure, got %s", args, out)
		}
	}
	out, err := exec.Command(buildHost(t), "--version").Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		t.Errorf("--version: %q %v", out, err)
	}
}
