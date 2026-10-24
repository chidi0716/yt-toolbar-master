package jobs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
	"github.com/chidi0716/yt-toolbar-master/host/internal/ytdlp"
)

func TestMain(m *testing.M) { testenv.Main(m) }

type harness struct {
	t        *testing.T
	store    *Store
	mgr      *Manager
	tools    *ytdlp.Tools
	dir      string // 下載資料夾
	mu       sync.Mutex
	events   []*Event
	failEmit bool
	runs     sync.WaitGroup
	// updateYtDlp 傳給 Runner.UpdateYtDlp（008 FR-22 的測試使用）。
	updateYtDlp func(ctx context.Context) (bool, error)
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	bin := testenv.FakeToolsDir(t, "ffmpeg", "deno")
	exe := ""
	if runtime.GOOS == "windows" {
		exe = ".exe"
	}
	h := &harness{t: t, store: &Store{Dir: filepath.Join(t.TempDir(), "jobs")}, dir: t.TempDir()}
	h.tools = &ytdlp.Tools{Env: ytdlp.SystemEnv(), YtDlp: filepath.Join(bin, "yt-dlp"+exe), FFmpeg: filepath.Join(bin, "ffmpeg"+exe)}
	h.mgr = &Manager{
		Store:  h.store,
		Client: "chrome",
		Spawn: func(id string) (int, error) {
			h.runs.Add(1)
			go func() {
				defer h.runs.Done()
				r := &Runner{Store: h.store, Tools: h.tools, UpdateYtDlp: h.updateYtDlp}
				r.Run(id)
			}()
			return os.Getpid(), nil
		},
		Emit: func(ev *Event) error {
			h.mu.Lock()
			defer h.mu.Unlock()
			if h.failEmit {
				return errors.New("disconnected")
			}
			h.events = append(h.events, ev)
			return nil
		},
	}
	h.mgr.Init()
	t.Cleanup(h.runs.Wait)
	return h
}

func (h *harness) download(mod func(d *validate.Download)) string {
	h.t.Helper()
	d := &validate.Download{VideoID: "dQw4w9WgXcQ", Kind: validate.KindVideo, FormatID: "137+140", Container: "mp4",
		Dir: h.dir, NamePreset: validate.DefaultNamePreset, Embed: true}
	if mod != nil {
		mod(d)
	}
	st, err := h.mgr.Start(d)
	if err != nil {
		h.t.Fatal(err)
	}
	return st.JobID
}

// wait 輪詢直到工作結束，回傳最後的狀態。
func (h *harness) wait(id string) *Status {
	h.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		h.mgr.Poll()
		st, err := h.store.ReadStatus(id)
		if err == nil && Final(st.State) {
			h.runs.Wait()
			h.mgr.Poll()
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
	h.t.Fatalf("job %s did not finish", id)
	return nil
}

func (h *harness) eventsFor(id string) []*Event {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []*Event
	for _, e := range h.events {
		if e.JobID == id {
			out = append(out, e)
		}
	}
	return out
}

func (h *harness) files() []string {
	entries, _ := os.ReadDir(h.dir)
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

const wantVideoName = "測試影片： Fake⧸Video？ [dQw4w9WgXcQ].mp4"

func TestDownloadVideo(t *testing.T) {
	h := newHarness(t)
	t.Setenv("FAKE_YTDLP_DELAY_MS", "40") // 讓輪詢來得及看到進度
	id := h.download(nil)
	st := h.wait(id)
	if st.State != StateDone || st.FileName != wantVideoName || st.Path != filepath.Join(h.dir, wantVideoName) {
		t.Fatalf("status: %+v", st)
	}
	if got := h.files(); len(got) != 1 || got[0] != wantVideoName {
		t.Fatalf("download folder: %v (temporary folder must be removed)", got)
	}
	evs := h.eventsFor(id)
	last := evs[len(evs)-1]
	if last.Event != "done" || last.Path != st.Path || last.FileName != wantVideoName || last.Kind != "video" {
		t.Fatalf("done event: %+v", last)
	}
	progress := 0
	for _, e := range evs[:len(evs)-1] {
		if e.Event != "progress" {
			t.Errorf("unexpected event %+v", e)
		}
		progress++
	}
	if progress == 0 {
		t.Error("no progress events")
	}
	if !h.store.Delivered(id) {
		t.Error("delivered marker missing")
	}
	// 同名檔案已存在：改名為 (2)。
	id2 := h.download(nil)
	if st := h.wait(id2); st.FileName != "測試影片： Fake⧸Video？ [dQw4w9WgXcQ] (2).mp4" {
		t.Fatalf("second download: %+v", st)
	}
}

func TestDownloadKinds(t *testing.T) {
	h := newHarness(t)
	cases := []struct {
		mod  func(d *validate.Download)
		name string
		body string
	}{
		{func(d *validate.Download) { d.Section = &validate.Section{Start: 90, End: 225} },
			"測試影片： Fake⧸Video？ [dQw4w9WgXcQ] 01m30s-03m45s.mp4", ""},
		{func(d *validate.Download) {
			d.Kind, d.FormatID, d.Container, d.Bitrate, d.NamePreset = validate.KindMP3, "", "", 192, "channel-title"
		}, "Fake Channel - 測試影片： Fake⧸Video？ [dQw4w9WgXcQ].mp3", ""},
		{func(d *validate.Download) {
			d.Kind, d.FormatID, d.Container, d.SubLang, d.SubFormat, d.Embed = validate.KindSubtitle, "", "", "en", "srt", false
		}, "測試影片： Fake⧸Video？ [dQw4w9WgXcQ].en.srt", "Hello world"},
		{func(d *validate.Download) {
			d.Kind, d.FormatID, d.Container, d.SubLang, d.SubFormat, d.Embed = validate.KindSubtitle, "", "", "en", "vtt", false
		}, "測試影片： Fake⧸Video？ [dQw4w9WgXcQ].en.vtt", "WEBVTT"},
		{func(d *validate.Download) {
			d.Kind, d.FormatID, d.Container, d.SubLang, d.SubFormat, d.SubAuto, d.Embed = validate.KindSubtitle, "", "", "en", "txt", true, false
		}, "測試影片： Fake⧸Video？ [dQw4w9WgXcQ].en.txt", "Hello world\nsecond line & more\n"},
	}
	for _, c := range cases {
		id := h.download(c.mod)
		st := h.wait(id)
		if st.State != StateDone || st.FileName != c.name {
			t.Errorf("%s: %+v %+v", c.name, st, st.Error)
			continue
		}
		b, _ := os.ReadFile(st.Path)
		if c.body != "" && !strings.Contains(string(b), c.body) {
			t.Errorf("%s: content %q", c.name, b)
		}
		if strings.HasSuffix(c.name, ".txt") && (strings.Contains(string(b), "-->") || string(b) != c.body) {
			t.Errorf("txt must not contain timestamps: %q", b)
		}
	}
	for _, f := range h.files() {
		if strings.HasPrefix(f, ".ytm-tmp-") {
			t.Errorf("temporary folder left: %s", f)
		}
	}
}

func TestDownloadFailures(t *testing.T) {
	h := newHarness(t)
	cases := []struct {
		scenario string
		mod      func(d *validate.Download)
		code     errs.Code
	}{
		{"login", nil, errs.LoginRequired},
		{"bot", nil, errs.VerificationRequired},
		{"network", nil, errs.Network},
		{"diskfull", nil, errs.DiskFull},
		{"format", nil, errs.FormatUnavailable},
		{"outdated", nil, errs.YtDlpOutdated},
		{"live", nil, errs.LiveNotSupported},
		{"crash", nil, errs.Unknown},
		{"nosubs", func(d *validate.Download) {
			d.Kind, d.FormatID, d.Container, d.SubLang, d.SubFormat, d.Embed = validate.KindSubtitle, "", "", "ja", "srt", false
		}, errs.NoSubtitles},
	}
	for _, c := range cases {
		t.Setenv("FAKE_YTDLP_SCENARIO", c.scenario)
		id := h.download(c.mod)
		st := h.wait(id)
		if st.State != StateFailed || st.Error == nil || st.Error.Code != c.code {
			t.Errorf("%s: %+v %+v", c.scenario, st, st.Error)
			continue
		}
		evs := h.eventsFor(id)
		if last := evs[len(evs)-1]; last.Event != "failed" || last.Error.Code != c.code {
			t.Errorf("%s: last event %+v", c.scenario, last)
		}
	}
	if got := h.files(); len(got) != 0 {
		t.Errorf("failed downloads left files: %v", got)
	}
}

func TestCancel(t *testing.T) {
	h := newHarness(t)
	t.Setenv("FAKE_YTDLP_SCENARIO", "slow")
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	t.Setenv("FAKE_YTDLP_CHILD_PID", pidFile)
	id := h.download(nil)

	// 等到開始下載，而且模擬 ffmpeg 的子程序已經啟動。
	var childPID int
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		h.mgr.Poll()
		b, _ := os.ReadFile(pidFile)
		childPID, _ = strconv.Atoi(strings.TrimSpace(string(b)))
		st, _ := h.store.ReadStatus(id)
		if childPID > 0 && st != nil && st.State == StateDownloading && st.Percent != nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if childPID == 0 {
		t.Fatal("child process did not start")
	}
	tmp := filepath.Join(h.dir, TmpDirName(id))
	if _, err := os.Stat(filepath.Join(tmp, wantVideoName+".part")); err != nil {
		t.Fatalf("expected a .part file while downloading: %v", err)
	}

	st, err := h.mgr.Cancel(context.Background(), id)
	if err != nil || st.State != StateCancelled {
		t.Fatalf("cancel: %+v %v", st, err)
	}
	h.runs.Wait()
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Errorf("temporary folder must be removed after cancel: %v", err)
	}
	if got := h.files(); len(got) != 0 {
		t.Errorf("cancel left files: %v", got)
	}
	// 子程序樹（模擬的 ffmpeg）也要被結束。
	gone := false
	for i := 0; i < 50 && !gone; i++ {
		gone = !processAlive(childPID)
		time.Sleep(50 * time.Millisecond)
	}
	if !gone {
		t.Errorf("child process %d is still running", childPID)
	}
	for _, e := range h.eventsFor(id) {
		if e.Event != "progress" {
			t.Errorf("cancel must not send done/failed events: %+v", e)
		}
	}
	// 已結束的工作再取消：直接回傳目前狀態。
	if st, err := h.mgr.Cancel(context.Background(), id); err != nil || st.State != StateCancelled {
		t.Errorf("second cancel: %+v %v", st, err)
	}
	if _, err := h.mgr.Cancel(context.Background(), "0123456789abcdef"); errs.From(err).Code != errs.JobNotFound {
		t.Errorf("unknown job: %v", err)
	}
}

func TestMissedNotifications(t *testing.T) {
	h := newHarness(t)
	h.failEmit = true // 擴充功能沒有連線
	id := h.download(nil)
	h.wait(id)
	if h.store.Delivered(id) {
		t.Fatal("must not be delivered while disconnected")
	}
	// 新的連線（新的 Manager）：jobs 回報一次 missed，之後不再回報。
	m2 := &Manager{Store: h.store, Client: "chrome", Emit: func(*Event) error { return nil }}
	m2.Init()
	list := m2.List()
	if len(list) != 1 || !list[0].Missed || list[0].State != StateDone {
		t.Fatalf("first list: %+v", list)
	}
	if list := m2.List(); list[0].Missed {
		t.Fatal("missed must be reported only once")
	}
	// 其他瀏覽器看不到這個工作。
	m3 := &Manager{Store: h.store, Client: "firefox"}
	m3.Init()
	if list := m3.List(); len(list) != 0 {
		t.Fatalf("firefox sees chrome jobs: %+v", list)
	}
	if _, err := m3.Get(id); errs.From(err).Code != errs.JobNotFound {
		t.Fatal("firefox can access chrome job")
	}
}

func TestReconnectPicksUpRunningJob(t *testing.T) {
	h := newHarness(t)
	// 模擬前一個連線留下的進行中工作：狀態檔寫入，但執行程序由測試直接啟動。
	spec := &Spec{JobID: NewID(), Client: "chrome", CreatedAt: time.Now(), Download: &validate.Download{
		VideoID: "dQw4w9WgXcQ", Kind: validate.KindMP3, Bitrate: 128, Dir: h.dir, NamePreset: "title", Embed: true}}
	if _, err := h.store.Create(spec); err != nil {
		t.Fatal(err)
	}
	var got []*Event
	var mu sync.Mutex
	m2 := &Manager{Store: h.store, Client: "chrome", Emit: func(ev *Event) error {
		mu.Lock()
		got = append(got, ev)
		mu.Unlock()
		return nil
	}}
	m2.Init()
	r := &Runner{Store: h.store, Tools: h.tools}
	if st, err := r.Run(spec.JobID); err != nil || st.State != StateDone {
		t.Fatalf("run: %+v %v", st, err)
	}
	m2.Poll()
	mu.Lock()
	defer mu.Unlock()
	if len(got) == 0 || got[len(got)-1].Event != "done" || got[len(got)-1].FileName != "測試影片： Fake⧸Video？.mp3" {
		t.Fatalf("events: %+v", got)
	}
}

func TestStaleJobsAreInterrupted(t *testing.T) {
	h := newHarness(t)
	old := time.Now().Add(-time.Hour)
	spec := &Spec{JobID: NewID(), Client: "chrome", CreatedAt: old, Download: &validate.Download{
		VideoID: "dQw4w9WgXcQ", Kind: validate.KindMP3, Bitrate: 128, Dir: h.dir, NamePreset: "title", Embed: true}}
	st, _ := h.store.Create(spec)
	st.State, st.RunnerPID, st.UpdatedAt = StateDownloading, 999999999, old
	h.store.WriteStatus(st)
	tmp := filepath.Join(h.dir, TmpDirName(spec.JobID))
	os.MkdirAll(tmp, 0o700)
	os.WriteFile(filepath.Join(tmp, "x.part"), []byte("x"), 0o600)

	list := h.mgr.List()
	if len(list) != 1 || list[0].State != StateFailed || list[0].Error.Code != errs.Interrupted {
		t.Fatalf("%+v", list)
	}
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Error("temporary folder of an interrupted job must be removed")
	}
}

func TestRunnerRejectsTamperedSpec(t *testing.T) {
	h := newHarness(t)
	spec := &Spec{JobID: NewID(), Client: "chrome", CreatedAt: time.Now(), Download: &validate.Download{
		VideoID: "dQw4w9WgXcQ", Kind: validate.KindVideo, FormatID: "best --exec rm", Container: "mp4", Dir: h.dir, NamePreset: "title-id", Embed: true}}
	h.store.Create(spec)
	r := &Runner{Store: h.store, Tools: h.tools}
	st, err := r.Run(spec.JobID)
	if err != nil || st.State != StateFailed || st.Error.Code != errs.InvalidArgs {
		t.Fatalf("%+v %v", st, err)
	}
	// 同一個工作不能同時被執行兩次。
	spec2 := &Spec{JobID: NewID(), Client: "chrome", CreatedAt: time.Now(), Download: spec.Download}
	h.store.Create(spec2)
	unlock, err := h.store.Lock(spec2.JobID)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if _, err := r.Run(spec2.JobID); err == nil {
		t.Fatal("second runner must be refused")
	}
	if _, err := r.Run("../../etc"); err == nil {
		t.Fatal("invalid id must be refused")
	}
}

func TestTooManyJobs(t *testing.T) {
	h := newHarness(t)
	h.mgr.Spawn = func(string) (int, error) { return os.Getpid(), nil } // 不實際執行
	for i := 0; i < MaxActive; i++ {
		h.download(nil)
	}
	_, err := h.mgr.Start(&validate.Download{VideoID: "dQw4w9WgXcQ", Kind: validate.KindMP3, Bitrate: 128, Dir: h.dir, NamePreset: "title", Embed: true})
	if errs.From(err).Code != errs.TooManyJobs {
		t.Fatalf("got %v", err)
	}
	// 執行程序啟動失敗時立即回報錯誤。
	h2 := newHarness(t)
	h2.mgr.Spawn = func(string) (int, error) { return 0, errors.New("exec failed") }
	if _, err := h2.mgr.Start(&validate.Download{VideoID: "dQw4w9WgXcQ", Kind: validate.KindMP3, Bitrate: 128, Dir: h2.dir, NamePreset: "title", Embed: true}); err == nil {
		t.Fatal("spawn failure must be reported")
	}
}

func TestPrune(t *testing.T) {
	s := &Store{Dir: filepath.Join(t.TempDir(), "jobs")}
	now := time.Now()
	mk := func(client string, age time.Duration, state string) string {
		spec := &Spec{JobID: NewID(), Client: client, CreatedAt: now.Add(-age), Download: &validate.Download{VideoID: "dQw4w9WgXcQ", Kind: "mp3"}}
		st, _ := s.Create(spec)
		fin := now.Add(-age)
		st.State, st.UpdatedAt = state, fin
		if Final(state) {
			st.FinishedAt = &fin
		}
		s.WriteStatus(st)
		return spec.JobID
	}
	old := mk("chrome", 8*24*time.Hour, StateDone)
	running := mk("chrome", 8*24*time.Hour, StateDownloading)
	var recent []string
	for i := 0; i < 4; i++ {
		recent = append(recent, mk("chrome", time.Duration(i)*time.Minute, StateDone))
	}
	s.Prune(now, 7*24*time.Hour, 3)
	ids := strings.Join(s.List(), ",")
	if strings.Contains(ids, old) || !strings.Contains(ids, running) || strings.Contains(ids, recent[3]) || !strings.Contains(ids, recent[0]) {
		t.Fatalf("after prune: %s", ids)
	}
}

func TestMoveUnique(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()
	for i := 1; i <= 3; i++ {
		p := filepath.Join(src, "a.en.srt")
		os.WriteFile(p, []byte(strconv.Itoa(i)), 0o644)
		got, err := moveUnique(p, dst)
		if err != nil {
			t.Fatal(err)
		}
		want := "a.en.srt"
		if i > 1 {
			want = "a.en (" + strconv.Itoa(i) + ").srt"
		}
		if filepath.Base(got) != want {
			t.Errorf("%d: %s", i, got)
		}
	}
}
