// Package updater 實作自動更新（plan 4.9、008 FR-20 至 FR-25）：狀態檔、24 小時限制、
// 鎖檔，以及 yte-host --update 的流程。
package updater

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/jobs"
)

// 檔案名稱（都在安裝資料夾中）。
const (
	StateFileName = "update-state.json"
	LockFileName  = "update.lock"
)

// CheckEvery 是自動檢查的最短間隔（008 FR-20）。
const CheckEvery = 24 * time.Hour

// 最近一次檢查的結果。
const (
	ResultOK      = "ok"      // 已是最新
	ResultUpdated = "updated" // 有元件被更新
	ResultFailed  = "failed"
)

// State 是 update-state.json。
type State struct {
	// Auto 為 nil 時視為開啟（008 FR-24：預設開啟）。
	Auto                *bool      `json:"auto,omitempty"`
	LastCheck           *time.Time `json:"lastCheck,omitempty"`
	LastResult          string     `json:"lastResult,omitempty"`
	ConsecutiveFailures int        `json:"consecutiveFailures"`
	// LastError 是最近一次失敗的錯誤代碼（只記錄代碼，不含路徑等資訊）。
	LastError string `json:"lastError,omitempty"`
	// Updated 列出最近一次更新的元件（例如 "yt-dlp"、"helper"）。
	Updated []string `json:"updated,omitempty"`
}

// AutoEnabled 回傳自動更新是否開啟。
func (s *State) AutoEnabled() bool { return s.Auto == nil || *s.Auto }

// Load 讀取狀態；不存在或格式錯誤時回傳預設值。
func Load(dir string) *State {
	s := &State{}
	if b, err := os.ReadFile(filepath.Join(dir, StateFileName)); err == nil {
		if json.Unmarshal(b, s) != nil {
			s = &State{}
		}
	}
	return s
}

// Save 以「寫暫存檔再改名」的方式寫入。
func (s *State) Save(dir string) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	p := filepath.Join(dir, StateFileName)
	tmp := fmt.Sprintf("%s.tmp-%d", p, os.Getpid())
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// ShouldCheck 回傳開始下載時是否該啟動自動更新：自動更新開啟，且從沒檢查過或距上次檢查
// 已超過 24 小時（上次檢查時間在未來超過一小時時，視為時鐘被調整過，也重新檢查）。
func ShouldCheck(s *State, now time.Time) bool {
	if !s.AutoEnabled() {
		return false
	}
	if s.LastCheck == nil {
		return true
	}
	d := now.Sub(*s.LastCheck)
	return d >= CheckEvery || d < -time.Hour
}

// View 是 status 指令中的 update 欄位（plan 4.9）。
type View struct {
	Auto                bool    `json:"auto"`
	LastCheck           *string `json:"lastCheck"`  // RFC 3339；沒有檢查過時為 null
	LastResult          *string `json:"lastResult"` // ok、updated、failed；沒有檢查過時為 null
	ConsecutiveFailures int     `json:"consecutiveFailures"`
	Running             bool    `json:"running"`
}

// ViewOf 產生 status 用的資料。
func ViewOf(dir string) View {
	s := Load(dir)
	v := View{Auto: s.AutoEnabled(), ConsecutiveFailures: s.ConsecutiveFailures, Running: Running(dir)}
	if s.LastCheck != nil {
		t := s.LastCheck.UTC().Format(time.RFC3339)
		v.LastCheck = &t
	}
	if s.LastResult != "" {
		r := s.LastResult
		v.LastResult = &r
	}
	return v
}

// SetAuto 開啟或關閉自動更新。
func SetAuto(dir string, enabled bool) error {
	s := Load(dir)
	s.Auto = &enabled
	return s.Save(dir)
}

// lockPID 讀取鎖檔中的 PID；沒有鎖檔時回傳 0。
func lockPID(dir string) int {
	b, err := os.ReadFile(filepath.Join(dir, LockFileName))
	if err != nil {
		return 0
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 0 {
		return -1 // 內容錯誤的鎖檔視為已失效
	}
	return pid
}

// Running 回傳是否有 --update 正在執行（鎖檔存在且其中的程序還在）。
func Running(dir string) bool {
	pid := lockPID(dir)
	return pid > 0 && jobs.ProcessAlive(pid)
}

// ErrLocked 表示已經有另一個 --update 在執行。
var ErrLocked = fmt.Errorf("another update is already running")

// Lock 建立鎖檔，避免同時執行兩個 --update（plan 4.9）。程序已經結束的鎖檔會被取代。
func Lock(dir string) (unlock func(), err error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	p := filepath.Join(dir, LockFileName)
	for attempt := 0; attempt < 2; attempt++ {
		f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			fmt.Fprintf(f, "%d\n", os.Getpid())
			f.Close()
			return func() { os.Remove(p) }, nil
		}
		if !os.IsExist(err) {
			return nil, err
		}
		if pid := lockPID(dir); pid > 0 && jobs.ProcessAlive(pid) {
			return nil, ErrLocked
		}
		os.Remove(p)
	}
	return nil, ErrLocked
}
