package jobs

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"sync"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
)

// 橋接程式（瀏覽器端）的時間設定。
const (
	PollEvery = 300 * time.Millisecond
	// StaleAfter：執行程序每 5 秒更新一次狀態；超過這個時間沒有更新代表它已經意外結束。
	StaleAfter = 2 * time.Minute
	// QueuedStaleAfter：建立後超過這個時間仍未開始，代表執行程序沒有啟動成功。
	QueuedStaleAfter = time.Minute
	// CancelWait 是 cancel 指令等待執行程序結束子程序樹與清理暫存檔的時間上限。
	CancelWait = 20 * time.Second
	// MaxActive 是同一個瀏覽器同時進行的下載上限。
	MaxActive = 8
	// 保留已結束工作的期間與筆數（給 jobs 指令與補發通知使用）。
	KeepFinished    = 7 * 24 * time.Hour
	KeepFinishedMax = 100
)

// Event 是主動推送給擴充功能的事件（plan 4.2）。
type Event struct {
	Event    string      `json:"event"` // progress、done、failed
	JobID    string      `json:"jobId"`
	VideoID  string      `json:"videoId"`
	Kind     string      `json:"kind"`
	State    string      `json:"state,omitempty"`
	Percent  *float64    `json:"percent,omitempty"`
	Speed    *float64    `json:"speed,omitempty"`
	ETA      *float64    `json:"eta,omitempty"`
	Part     int         `json:"part,omitempty"`
	Parts    int         `json:"parts,omitempty"`
	Stage    string      `json:"stage,omitempty"` // "updating-ytdlp"（008 FR-22）
	Path     string      `json:"path,omitempty"`
	FileName string      `json:"fileName,omitempty"`
	Error    *errs.Error `json:"error,omitempty"`
}

// Manager 是瀏覽器端（原生訊息連線中的橋接程式）的工作管理：建立工作、啟動執行程序、
// 追蹤狀態並推送事件、取消、列出工作。
type Manager struct {
	Store  *Store
	Client string
	// Spawn 啟動工作的執行程序，回傳其 PID。
	Spawn func(jobID string) (int, error)
	// Emit 把事件送給擴充功能；連線已關閉時回傳錯誤。
	Emit func(ev *Event) error
	Log  Logger
	Now  func() time.Time

	mu      sync.Mutex
	watched map[string]*watch
	started map[string]bool // 由這個程序建立的工作
	wake    chan struct{}
}

type watch struct {
	last *Status
}

func (m *Manager) init() {
	if m.watched == nil {
		m.watched = map[string]*watch{}
		m.started = map[string]bool{}
		m.wake = make(chan struct{}, 1)
	}
	if m.Log == nil {
		m.Log = nopLogger{}
	}
	if m.Now == nil {
		m.Now = time.Now
	}
}

// Init 清理過舊的工作，並開始追蹤之前的連線留下、仍在進行中的工作
// （例如瀏覽器重新連線時，讓新的連線繼續收到進度與完成事件）。
func (m *Manager) Init() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	m.Store.Prune(m.Now(), KeepFinished, KeepFinishedMax)
	for _, id := range m.Store.List() {
		st, err := m.Store.ReadStatus(id)
		if err != nil || st.Client != m.Client || Final(st.State) {
			continue
		}
		m.watched[id] = &watch{}
	}
}

// Start 建立並啟動一個下載工作，回傳工作 ID。
func (m *Manager) Start(d *validate.Download) (*Status, error) {
	m.mu.Lock()
	m.init()
	active := 0
	for _, id := range m.Store.List() {
		if st, err := m.Store.ReadStatus(id); err == nil && st.Client == m.Client && !Final(st.State) {
			active++
		}
	}
	if active >= MaxActive {
		m.mu.Unlock()
		return nil, errs.New(errs.TooManyJobs, "too many downloads in progress (limit %d)", MaxActive)
	}
	id := NewID()
	st, err := m.Store.Create(&Spec{JobID: id, Client: m.Client, CreatedAt: m.Now(), Download: d})
	if err != nil {
		m.mu.Unlock()
		return nil, errs.New(errs.Unknown, "could not create job: %v", err)
	}
	m.watched[id] = &watch{}
	m.started[id] = true
	m.mu.Unlock()

	pid, err := m.Spawn(id)
	if err != nil {
		now := m.Now()
		st.State, st.Error, st.FinishedAt, st.UpdatedAt = StateFailed, errs.New(errs.Unknown, "could not start the download process: %v", err), &now, now
		m.Store.WriteStatus(st)
		m.Store.MarkDelivered(id) // 錯誤直接回在 download 指令的回應中
		m.forget(id)
		return nil, st.Error
	}
	m.Log.Printf("job %s started (%s, runner pid %d)", id, d.Kind, pid)
	m.poke()
	return st, nil
}

func (m *Manager) forget(id string) {
	m.mu.Lock()
	delete(m.watched, id)
	m.mu.Unlock()
}

func (m *Manager) poke() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

// Run 定期讀取追蹤中工作的狀態並推送事件，直到 ctx 結束。
func (m *Manager) Run(ctx context.Context) {
	m.mu.Lock()
	m.init()
	m.mu.Unlock()
	t := time.NewTicker(PollEvery)
	defer t.Stop()
	for {
		m.Poll()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-m.wake:
		}
	}
}

// Poll 檢查一次所有追蹤中的工作。
func (m *Manager) Poll() {
	m.mu.Lock()
	m.init()
	ids := make([]string, 0, len(m.watched))
	for id := range m.watched {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	sort.Strings(ids)
	for _, id := range ids {
		m.check(id)
	}
}

func (m *Manager) check(id string) {
	st, err := m.Store.ReadStatus(id)
	if err != nil {
		if os.IsNotExist(err) {
			m.forget(id)
		}
		return
	}
	if !Final(st.State) && m.isStale(st) {
		st = m.markInterrupted(st)
	}
	m.mu.Lock()
	w := m.watched[id]
	m.mu.Unlock()
	if w == nil {
		return
	}
	if Final(st.State) {
		var ev *Event
		switch st.State {
		case StateDone:
			ev = &Event{Event: "done", Path: st.Path, FileName: st.FileName}
		case StateFailed:
			ev = &Event{Event: "failed", Error: st.Error}
		}
		if ev != nil && !m.Store.Delivered(id) {
			ev.JobID, ev.VideoID, ev.Kind = st.JobID, st.VideoID, st.Kind
			if err := m.Emit(ev); err == nil {
				m.Store.MarkDelivered(id)
			}
		} else if st.State == StateCancelled {
			m.Store.MarkDelivered(id)
		}
		m.Log.Printf("job %s %s", id, st.State)
		m.forget(id)
		return
	}
	if w.last != nil && sameProgress(w.last, st) {
		return
	}
	w.last = st
	if st.State == StateQueued {
		return
	}
	m.Emit(&Event{
		Event: "progress", JobID: st.JobID, VideoID: st.VideoID, Kind: st.Kind, State: st.State,
		Percent: st.Percent, Speed: st.Speed, ETA: st.ETA, Part: st.Part, Parts: st.Parts, Stage: st.Stage,
	})
}

func sameProgress(a, b *Status) bool {
	return a.State == b.State && a.Stage == b.Stage && reflect.DeepEqual(a.Percent, b.Percent) &&
		reflect.DeepEqual(a.Speed, b.Speed) && reflect.DeepEqual(a.ETA, b.ETA) && a.Part == b.Part
}

func (m *Manager) isStale(st *Status) bool {
	age := m.Now().Sub(st.UpdatedAt)
	if st.State == StateQueued {
		return age > QueuedStaleAfter
	}
	return age > StaleAfter && !processAlive(st.RunnerPID)
}

// markInterrupted 把執行程序已經不在的工作標記為失敗，並刪除暫存資料夾。
func (m *Manager) markInterrupted(st *Status) *Status {
	now := m.Now()
	st.State, st.FinishedAt, st.UpdatedAt = StateFailed, &now, now
	st.Error = errs.New(errs.Interrupted, "the download process stopped unexpectedly")
	m.Store.WriteStatus(st)
	m.cleanupTmp(st.JobID)
	m.Log.Printf("job %s interrupted", st.JobID)
	return st
}

func (m *Manager) cleanupTmp(id string) {
	spec, err := m.Store.ReadSpec(id)
	if err != nil || validate.DirSyntax(spec.Download.Dir) != nil {
		return
	}
	removeAllRetry(filepath.Join(spec.Download.Dir, TmpDirName(id)))
}

// get 讀取屬於這個瀏覽器的工作。
func (m *Manager) get(id string) (*Status, error) {
	st, err := m.Store.ReadStatus(id)
	if err != nil || st.Client != m.Client {
		return nil, errs.New(errs.JobNotFound, "job not found")
	}
	return st, nil
}

// Get 回傳工作狀態（reveal 使用）。
func (m *Manager) Get(id string) (*Status, error) { return m.get(id) }

// Cancel 取消工作：要求執行程序結束整個子程序樹並刪除暫存檔，等它完成後才回傳。
// 已經結束的工作不做任何事，直接回傳目前狀態。
func (m *Manager) Cancel(ctx context.Context, id string) (*Status, error) {
	st, err := m.get(id)
	if err != nil {
		return nil, err
	}
	if Final(st.State) {
		return st, nil
	}
	if err := m.Store.RequestCancel(id); err != nil {
		return nil, errs.New(errs.Unknown, "could not cancel: %v", err)
	}
	m.Log.Printf("job %s cancel requested", id)
	deadline := time.NewTimer(CancelWait)
	defer deadline.Stop()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		st, err = m.Store.ReadStatus(id)
		if err == nil && Final(st.State) {
			m.check(id)
			return st, nil
		}
		if err == nil && (st.State == StateQueued || m.isStale(st)) && !processAlive(st.RunnerPID) && m.Now().Sub(st.UpdatedAt) > 2*time.Second {
			// 執行程序不在（還沒開始或已經意外結束）：直接標記為已取消。
			now := m.Now()
			st.State, st.FinishedAt, st.UpdatedAt = StateCancelled, &now, now
			m.Store.WriteStatus(st)
			m.cleanupTmp(id)
			m.check(id)
			return st, nil
		}
		select {
		case <-ctx.Done():
			return nil, errs.New(errs.Unknown, "cancelled")
		case <-deadline.C:
			return nil, errs.New(errs.Timeout, "the download did not stop in %s", CancelWait)
		case <-tick.C:
		}
	}
}

// JobView 是 jobs 指令回傳的一筆工作。
type JobView struct {
	*Status
	// Missed 為 true 代表這個工作在擴充功能沒有連線時結束，還沒通知過使用者；
	// 回報一次後就會標記為已送達（plan 4.6 的補發通知）。
	Missed bool `json:"missed"`
}

// List 回傳這個瀏覽器的工作：進行中的在前，其餘依建立時間由新到舊。
func (m *Manager) List() []JobView {
	var out []JobView
	for _, id := range m.Store.List() {
		st, err := m.Store.ReadStatus(id)
		if err != nil || st.Client != m.Client {
			continue
		}
		if !Final(st.State) && m.isStale(st) {
			st = m.markInterrupted(st)
		}
		v := JobView{Status: st}
		if Final(st.State) && st.State != StateCancelled && !m.Store.Delivered(id) {
			m.mu.Lock()
			watching := m.watched[id] != nil
			m.mu.Unlock()
			if !watching {
				v.Missed = true
				m.Store.MarkDelivered(id)
			}
		}
		out = append(out, v)
	}
	sort.SliceStable(out, func(i, j int) bool {
		fi, fj := Final(out[i].State), Final(out[j].State)
		if fi != fj {
			return !fi
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	if out == nil {
		out = []JobView{}
	}
	return out
}

// RunJobFlag 是執行程序模式的命令列參數（橋接程式以這個參數啟動自己）。
const RunJobFlag = "--run-job"

// SpawnSelf 以 --run-job <id> 啟動橋接程式自己，作為脫離瀏覽器的執行程序。
func SpawnSelf(id string) (int, error) {
	if err := validate.JobID(id); err != nil {
		return 0, err
	}
	exe, err := os.Executable()
	if err != nil {
		return 0, err
	}
	return spawnDetached(exe, []string{RunJobFlag, id})
}

// SpawnDetached 以脫離瀏覽器的方式啟動 exe（與 --run-job 相同的方式），
// 給 --update 與 --uninstall 使用。回傳 PID。
func SpawnDetached(exe string, args ...string) (int, error) { return spawnDetached(exe, args) }

// ProcessAlive 回傳 PID 對應的程序是否還在。
func ProcessAlive(pid int) bool { return processAlive(pid) }

// ActiveCount 回傳所有瀏覽器進行中的下載數量（不含執行程序已經不在的工作）。
// 自動更新等到沒有進行中的下載才替換工具（008 FR-21），移除下載功能時也用來判斷 JOBS_RUNNING。
func (s *Store) ActiveCount(now time.Time) int {
	n := 0
	for _, id := range s.List() {
		st, err := s.ReadStatus(id)
		if err != nil || Final(st.State) {
			continue
		}
		age := now.Sub(st.UpdatedAt)
		if st.State == StateQueued && age > QueuedStaleAfter {
			continue
		}
		if st.State != StateQueued && age > StaleAfter && !processAlive(st.RunnerPID) {
			continue
		}
		n++
	}
	return n
}

// Wait 等待這個程序建立的工作全部結束，最長 max（plan 4.6：瀏覽器關閉連線後最多等 6 小時）。
// 下載由獨立的執行程序負責，不會因為這裡結束而中斷。
func (m *Manager) Wait(max time.Duration) {
	deadline := time.Now().Add(max)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		pending := 0
		for id := range m.started {
			if st, err := m.Store.ReadStatus(id); err == nil && !Final(st.State) {
				pending++
			}
		}
		m.mu.Unlock()
		if pending == 0 {
			return
		}
		m.Poll()
		time.Sleep(time.Second)
	}
}
