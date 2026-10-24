package ytdlp

import (
	"encoding/json"
	"strings"
)

// LineKind 是一行 yt-dlp 輸出的種類。
type LineKind int

const (
	LineOther    LineKind = iota
	LineProgress          // 下載進度
	LinePost              // 後處理（合併、轉檔、嵌入）
	LineFile              // 最終檔案路徑
	LineError             // ERROR: 開頭的錯誤訊息
)

// Progress 是一行進度資料（缺少的數值為 nil）。
type Progress struct {
	Status        string   `json:"status"`
	Downloaded    *float64 `json:"downloaded_bytes"`
	Total         *float64 `json:"total_bytes"`
	TotalEstimate *float64 `json:"total_bytes_estimate"`
	Speed         *float64 `json:"speed"`
	ETA           *float64 `json:"eta"`
	FragmentIndex *float64 `json:"fragment_index"`
	FragmentCount *float64 `json:"fragment_count"`
}

// Line 是解析後的一行輸出。
type Line struct {
	Kind     LineKind
	Progress Progress
	FormatID string // 進度所屬的格式 ID
	PostName string // 後處理器名稱，例如 Merger、ExtractAudio
	PostStat string // started、processing、finished
	Path     string // LineFile 的路徑
	Message  string // LineError 的訊息（去掉 ERROR: 前綴）
}

// ParseLine 解析 yt-dlp 的一行輸出（stdout 或 stderr）。
func ParseLine(s string) Line {
	s = strings.TrimRight(s, "\r\n")
	switch {
	case strings.HasPrefix(s, ProgressPrefix):
		var v struct {
			P Progress `json:"p"`
			F any      `json:"f"`
		}
		if json.Unmarshal([]byte(s[len(ProgressPrefix):]), &v) == nil {
			l := Line{Kind: LineProgress, Progress: v.P}
			if f, ok := v.F.(string); ok {
				l.FormatID = f
			}
			return l
		}
	case strings.HasPrefix(s, PostPrefix):
		var v struct {
			PP any `json:"pp"`
			S  any `json:"s"`
		}
		if json.Unmarshal([]byte(s[len(PostPrefix):]), &v) == nil {
			l := Line{Kind: LinePost}
			l.PostName, _ = v.PP.(string)
			l.PostStat, _ = v.S.(string)
			return l
		}
	case strings.HasPrefix(s, FilePrefix):
		var p string
		if json.Unmarshal([]byte(s[len(FilePrefix):]), &p) == nil && p != "" {
			return Line{Kind: LineFile, Path: p}
		}
	case strings.HasPrefix(s, "ERROR:"):
		return Line{Kind: LineError, Message: CleanErrorMessage(s)}
	}
	return Line{Kind: LineOther}
}

// CleanErrorMessage 去掉 ERROR: 前綴與「[youtube] <id>: 」這類來源標記，並限制長度。
func CleanErrorMessage(s string) string {
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "ERROR:"))
	if strings.HasPrefix(s, "[") {
		if i := strings.Index(s, "] "); i > 0 {
			rest := s[i+2:]
			// 「[youtube] dQw4w9WgXcQ: 訊息」
			if j := strings.Index(rest, ": "); j > 0 && j <= 20 && !strings.Contains(rest[:j], " ") {
				rest = rest[j+2:]
			}
			s = rest
		}
	}
	const maxLen = 300
	if len(s) > maxLen {
		s = s[:maxLen] + "…"
	}
	return s
}

// Tracker 把逐行的進度整合成整體百分比。
// 影像＋聲音（例如 137+140）會分成兩段下載，整體百分比依各段已知的大小加權
// （後面的段落還沒開始、大小未知時，先保留 10%）；數值只會往上，不會倒退。
type Tracker struct {
	parts   []string
	totals  map[string]float64
	done    map[string]float64
	percent float64
}

// NewTracker 依要求的格式 ID 建立 Tracker（mp3 與字幕傳空字串）。
func NewTracker(formatID string) *Tracker {
	t := &Tracker{totals: map[string]float64{}, done: map[string]float64{}}
	if formatID != "" {
		t.parts = strings.Split(formatID, "+")
	}
	return t
}

// Snapshot 是給擴充功能的進度。
type Snapshot struct {
	Percent    *float64 `json:"percent"`    // 0–100；未知時為 null
	Speed      *float64 `json:"speed"`      // 位元組／秒
	ETA        *float64 `json:"eta"`        // 秒
	Downloaded *float64 `json:"downloaded"` // 目前這一段已下載的位元組
	Total      *float64 `json:"total"`      // 目前這一段的總位元組（有時是估計值）
	Part       int      `json:"part"`       // 第幾段（從 1 開始）
	Parts      int      `json:"parts"`      // 共幾段
}

// Update 加入一行進度，回傳最新的整體進度。
func (t *Tracker) Update(p Progress, formatID string) Snapshot {
	key := formatID
	if key == "" {
		key = "_"
	}
	total := 0.0
	if p.Total != nil {
		total = *p.Total
	} else if p.TotalEstimate != nil {
		total = *p.TotalEstimate
	}
	if total > 0 {
		t.totals[key] = total
	}
	if p.Downloaded != nil {
		t.done[key] = *p.Downloaded
	}
	if p.Status == "finished" && t.totals[key] > 0 {
		t.done[key] = t.totals[key]
	}

	parts := len(t.parts)
	if parts == 0 {
		parts = 1
	}
	part := 1
	for i, id := range t.parts {
		if id == formatID {
			part = i + 1
		}
	}

	snap := Snapshot{Speed: p.Speed, ETA: p.ETA, Part: part, Parts: parts}
	if p.Downloaded != nil {
		snap.Downloaded = p.Downloaded
	}
	if total > 0 {
		snap.Total = &total
	}

	var sumTotal, sumDone float64
	for k, v := range t.totals {
		sumTotal += v
		sumDone += min(t.done[k], v)
	}
	var pct float64
	switch {
	case sumTotal > 0:
		pct = sumDone / sumTotal * 100
		// 還沒開始的段落（例如聲音）大小未知：先保留 10% 給它們。
		if parts > 1 && len(t.totals) < parts {
			pct *= 0.9
		}
	case p.FragmentIndex != nil && p.FragmentCount != nil && *p.FragmentCount > 0:
		pct = *p.FragmentIndex / *p.FragmentCount * 100
		if parts > 1 {
			pct = (float64(part-1) + pct/100) / float64(parts) * 100
		}
	default:
		if t.percent > 0 {
			v := t.percent
			snap.Percent = &v
		}
		return snap
	}
	pct = min(pct, 100)
	if pct > t.percent {
		t.percent = pct
	}
	v := t.percent
	snap.Percent = &v
	return snap
}
