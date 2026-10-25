package installer

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
)

// StateFileName 記錄安裝資料夾中各工具是依哪個清單版本安裝的（install-state.json）。
// deno 與 ffmpeg 的版本與清單不同時才重新下載（plan 4.9）；yt-dlp 安裝後由自動更新處理
// （Windows：yt-dlp -U；macOS：UpdateMacYtDlp）。
const StateFileName = "install-state.json"

// State 是 install-state.json 的內容。
type State struct {
	Tools map[string]string `json:"tools"` // 工具名稱 → 清單中的版本
	// Archives 是整個資料夾安裝的工具（macOS 的 yt-dlp）目前所用 zip 的 SHA256；
	// 自動更新時與官方 SHA2-256SUMS 比對，不同時才下載（008 FR-20）。
	Archives map[string]string `json:"archives,omitempty"`
}

// LoadState 讀取狀態；不存在或格式錯誤時回傳空的狀態。
func LoadState(installDir string) *State {
	s := &State{}
	if b, err := os.ReadFile(filepath.Join(installDir, StateFileName)); err == nil {
		json.Unmarshal(b, s)
	}
	if s.Tools == nil {
		s.Tools = map[string]string{}
	}
	if s.Archives == nil {
		s.Archives = map[string]string{}
	}
	return s
}

// Save 以「寫暫存檔再改名」的方式寫入狀態。
func (s *State) Save(installDir string) error {
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return err
	}
	return platform.WriteJSONAtomic(filepath.Join(installDir, StateFileName), s, 0o644)
}
