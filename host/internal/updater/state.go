// Package updater 實作自動更新（plan 4.9、008 FR-20 至 FR-25）：狀態檔、24 小時限制、
// 鎖檔，以及 ytm-host --update 的流程。
package updater

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/jobs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
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
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return platform.WriteJSONAtomic(filepath.Join(dir, StateFileName), s, 0o644)
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

// MigrateRetry 是改裝未封裝版 yt-dlp 失敗後，status 再次自動啟動 --update 的最短間隔。
const MigrateRetry = 10 * time.Minute

// ShouldMigrate 回傳 status 發現 macOS 上還是舊版單一執行檔 yt-dlp 時是否該啟動 --update
// （008 FR-15a）：自動更新開啟，且上一次更新不是在 MigrateRetry 之內失敗。
func ShouldMigrate(s *State, now time.Time) bool {
	if !s.AutoEnabled() {
		return false
	}
	if s.LastResult != ResultFailed || s.LastCheck == nil {
		return true
	}
	d := now.Sub(*s.LastCheck)
	return d >= MigrateRetry || d < -time.Hour
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

// Running 回傳是否有 --update 正在執行（鎖檔存在且其中的程序還在）。
func Running(dir string) bool {
	pid := jobs.LockHolder(filepath.Join(dir, LockFileName))
	return pid > 0 && jobs.ProcessAlive(pid)
}

// ErrLocked 表示已經有另一個 --update 在執行。
var ErrLocked = fmt.Errorf("another update is already running")

// Lock 建立鎖檔，避免同時執行兩個 --update（plan 4.9）。程序已經結束的鎖檔會被取代。
func Lock(dir string) (unlock func(), err error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	unlock, err = jobs.LockFile(filepath.Join(dir, LockFileName), true)
	if os.IsExist(err) {
		return nil, ErrLocked
	}
	return unlock, err
}
