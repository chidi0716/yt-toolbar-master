// Package jobs 管理下載工作（plan 4.6）。
//
// 每個下載由一個獨立、脫離瀏覽器的「執行程序」（橋接程式以 --run-job 模式啟動自己）負責，
// 瀏覽器關閉連線或結束橋接程式時，下載仍會繼續；結果寫在狀態資料夾，
// 下次連線時由 jobs 指令補報（plan 4.6 的「完成的工作記在本機狀態檔」）。
//
// 狀態資料夾：<StateDir>/jobs/<jobId>/
//
//	spec.json    驗證過的下載參數（橋接程式寫入，執行程序讀取後會再驗證一次）
//	status.json  目前狀態（執行程序寫入；以「寫暫存檔再改名」的方式更新）
//	cancel       取消要求（橋接程式建立，執行程序看到後結束整個子程序樹）
//	delivered    結果已經送達擴充功能（完成或失敗的事件已送出、或已由 jobs 回報）
//	runner.lock  避免同一個工作被執行兩次
package jobs

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
)

const (
	StateQueued      = "queued" // 已建立，執行程序還沒開始
	StateDownloading = "downloading"
	StateProcessing  = "processing" // 合併、轉檔、嵌入資訊、搬移檔案
	StateDone        = "done"
	StateFailed      = "failed"
	StateCancelled   = "cancelled"
)

// Final 回傳狀態是否已經結束。
func Final(state string) bool {
	return state == StateDone || state == StateFailed || state == StateCancelled
}

// Spec 是工作的參數。
type Spec struct {
	JobID     string             `json:"jobId"`
	Client    string             `json:"client"` // chrome 或 firefox
	CreatedAt time.Time          `json:"createdAt"`
	Download  *validate.Download `json:"download"`
}

// Status 是工作的狀態，也是 jobs 指令回傳的每一筆資料。
type Status struct {
	JobID      string   `json:"jobId"`
	Client     string   `json:"-"`
	VideoID    string   `json:"videoId"`
	Kind       string   `json:"kind"`
	State      string   `json:"state"`
	Percent    *float64 `json:"percent"`
	Speed      *float64 `json:"speed"`
	ETA        *float64 `json:"eta"`
	Downloaded *float64 `json:"downloaded"`
	Total      *float64 `json:"total"`
	Part       int      `json:"part,omitempty"`
	Parts      int      `json:"parts,omitempty"`
	// Stage 是下載以外的步驟；目前只有 "updating-ytdlp"（008 FR-22：自動更新 yt-dlp 後重試）。
	Stage      string      `json:"stage,omitempty"`
	Path       string      `json:"path,omitempty"`
	FileName   string      `json:"fileName,omitempty"`
	Error      *errs.Error `json:"error,omitempty"`
	CreatedAt  time.Time   `json:"createdAt"`
	UpdatedAt  time.Time   `json:"updatedAt"`
	FinishedAt *time.Time  `json:"finishedAt,omitempty"`
	RunnerPID  int         `json:"-"`
}

// statusFile 是 status.json 的內容（包含不回傳給擴充功能的欄位）。
type statusFile struct {
	Status
	Client    string `json:"client"`
	RunnerPID int    `json:"runnerPid,omitempty"`
}

// Store 是狀態資料夾。
type Store struct {
	Dir string // <StateDir>/jobs
}

// NewID 產生新的工作 ID（16 個十六進位字元）。
func NewID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

// JobDir 回傳工作的資料夾。id 必須已經通過 validate.JobID。
func (s *Store) JobDir(id string) string { return filepath.Join(s.Dir, id) }

func (s *Store) file(id, name string) string { return filepath.Join(s.JobDir(id), name) }

// Create 建立新工作的資料夾、spec.json 與 queued 狀態。
func (s *Store) Create(spec *Spec) (*Status, error) {
	if err := validate.JobID(spec.JobID); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Mkdir(s.JobDir(spec.JobID), 0o700); err != nil {
		return nil, err
	}
	if err := platform.WriteJSONAtomic(s.file(spec.JobID, "spec.json"), spec, 0o600); err != nil {
		return nil, err
	}
	st := &Status{
		JobID: spec.JobID, Client: spec.Client, VideoID: spec.Download.VideoID, Kind: spec.Download.Kind,
		State: StateQueued, CreatedAt: spec.CreatedAt, UpdatedAt: spec.CreatedAt,
	}
	return st, s.WriteStatus(st)
}

// ReadSpec 讀取工作參數。
func (s *Store) ReadSpec(id string) (*Spec, error) {
	if err := validate.JobID(id); err != nil {
		return nil, err
	}
	var spec Spec
	if err := readJSON(s.file(id, "spec.json"), &spec); err != nil {
		return nil, err
	}
	if spec.JobID != id || spec.Download == nil {
		return nil, errs.New(errs.InvalidArgs, "job spec does not match its folder")
	}
	return &spec, nil
}

// ReadStatus 讀取工作狀態。
func (s *Store) ReadStatus(id string) (*Status, error) {
	if err := validate.JobID(id); err != nil {
		return nil, err
	}
	var f statusFile
	var err error
	// 另一個程序正在改名替換這個檔案時，Windows 上會暫時無法開啟：稍等再試。
	for i := 0; i < 5; i++ {
		if err = readJSON(s.file(id, "status.json"), &f); err == nil {
			break
		}
		if errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil {
		return nil, err
	}
	st := f.Status
	st.Client, st.RunnerPID = f.Client, f.RunnerPID
	return &st, nil
}

// WriteStatus 以「寫暫存檔再改名」的方式更新狀態，讀取端不會讀到寫一半的檔案。
func (s *Store) WriteStatus(st *Status) error {
	return platform.WriteJSONAtomic(s.file(st.JobID, "status.json"), &statusFile{Status: *st, Client: st.Client, RunnerPID: st.RunnerPID}, 0o600)
}

// List 回傳全部工作的 ID（依建立時間排序前先以 ID 排序；呼叫端再依狀態排序）。
func (s *Store) List() []string {
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		return nil
	}
	var ids []string
	for _, e := range entries {
		if e.IsDir() && validate.JobID(e.Name()) == nil {
			ids = append(ids, e.Name())
		}
	}
	sort.Strings(ids)
	return ids
}

func (s *Store) touch(id, name string) error {
	f, err := os.OpenFile(s.file(id, name), os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	return f.Close()
}

func (s *Store) exists(id, name string) bool {
	_, err := os.Stat(s.file(id, name))
	return err == nil
}

// RequestCancel 建立取消要求。
func (s *Store) RequestCancel(id string) error { return s.touch(id, "cancel") }

// CancelRequested 回傳是否有取消要求。
func (s *Store) CancelRequested(id string) bool { return s.exists(id, "cancel") }

// MarkDelivered 標記結果已送達擴充功能。
func (s *Store) MarkDelivered(id string) error { return s.touch(id, "delivered") }

// Delivered 回傳結果是否已送達。
func (s *Store) Delivered(id string) bool { return s.exists(id, "delivered") }

// Lock 取得執行鎖；已被其他程序持有時回傳錯誤。
func (s *Store) Lock(id string) (unlock func(), err error) {
	unlock, err = LockFile(s.file(id, "runner.lock"), false)
	if err != nil {
		return nil, fmt.Errorf("job %s is already running: %w", id, err)
	}
	return unlock, nil
}

// Remove 刪除工作的資料夾。
func (s *Store) Remove(id string) error {
	if err := validate.JobID(id); err != nil {
		return err
	}
	return os.RemoveAll(s.JobDir(id))
}

// Prune 刪除過舊的已結束工作：超過 maxAge，或每個呼叫者超過 maxKeep 筆時刪除最舊的；
// 沒有狀態檔、建立超過一天的資料夾也一併刪除。
func (s *Store) Prune(now time.Time, maxAge time.Duration, maxKeep int) {
	type item struct {
		id string
		t  time.Time
	}
	perClient := map[string][]item{}
	for _, id := range s.List() {
		st, err := s.ReadStatus(id)
		if err != nil {
			if info, e := os.Stat(s.JobDir(id)); e == nil && now.Sub(info.ModTime()) > 24*time.Hour {
				s.Remove(id)
			}
			continue
		}
		if !Final(st.State) {
			continue
		}
		t := st.UpdatedAt
		if st.FinishedAt != nil {
			t = *st.FinishedAt
		}
		if now.Sub(t) > maxAge {
			s.Remove(id)
			continue
		}
		perClient[st.Client] = append(perClient[st.Client], item{id, t})
	}
	for _, items := range perClient {
		if len(items) <= maxKeep {
			continue
		}
		sort.Slice(items, func(i, j int) bool { return items[i].t.After(items[j].t) })
		for _, it := range items[maxKeep:] {
			s.Remove(it.id)
		}
	}
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
