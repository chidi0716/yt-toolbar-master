package ytdlp

import (
	"encoding/json"
	"sort"
	"strings"
)

// rawInfo 是 yt-dlp -J 輸出中會用到的欄位。
type rawInfo struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Channel     string         `json:"channel"`
	Uploader    string         `json:"uploader"`
	Duration    *float64       `json:"duration"`
	UploadDate  string         `json:"upload_date"`
	LiveStatus  string         `json:"live_status"`
	IsLive      *bool          `json:"is_live"`
	WasLive     *bool          `json:"was_live"`
	Chapters    []rawChapter   `json:"chapters"`
	Formats     []rawFormat    `json:"formats"`
	Subtitles   map[string]any `json:"subtitles"`
	AutoCaption map[string]any `json:"automatic_captions"`
}

type rawChapter struct {
	Start *float64 `json:"start_time"`
	End   *float64 `json:"end_time"`
	Title string   `json:"title"`
}

type rawFormat struct {
	FormatID       string   `json:"format_id"`
	Ext            string   `json:"ext"`
	VCodec         *string  `json:"vcodec"`
	ACodec         *string  `json:"acodec"`
	Width          *int     `json:"width"`
	Height         *int     `json:"height"`
	FPS            *float64 `json:"fps"`
	TBR            *float64 `json:"tbr"`
	ABR            *float64 `json:"abr"`
	VBR            *float64 `json:"vbr"`
	Filesize       *int64   `json:"filesize"`
	FilesizeApprox *int64   `json:"filesize_approx"`
	FormatNote     *string  `json:"format_note"`
	Protocol       string   `json:"protocol"`
	DynamicRange   *string  `json:"dynamic_range"`
	Language       *string  `json:"language"`
	AudioChannels  *int     `json:"audio_channels"`
	HasDRM         any      `json:"has_drm"`
}

// Info 是 getInfo 回傳給擴充功能的精簡資料（plan 4.3），不含任何網址。
type Info struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Channel      string     `json:"channel"`
	Duration     *float64   `json:"duration"`
	UploadDate   string     `json:"uploadDate"`
	LiveStatus   string     `json:"liveStatus"` // not_live、is_live、is_upcoming、was_live、post_live
	IsLive       bool       `json:"isLive"`
	Chapters     []Chapter  `json:"chapters"`
	Formats      []Format   `json:"formats"`
	Subtitles    []SubTrack `json:"subtitles"`
	AutoCaptions []SubTrack `json:"autoCaptions"`
	Truncated    bool       `json:"truncated,omitempty"` // 為了符合 1MB 上限而省略了部分資料
}

type Chapter struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Title string  `json:"title"`
}

// Format 是一個可下載的格式。數值未知時為 null。
type Format struct {
	ID             string   `json:"id"`
	Ext            string   `json:"ext"`
	VCodec         string   `json:"vcodec"` // "none" 代表沒有影像
	ACodec         string   `json:"acodec"` // "none" 代表沒有聲音；空字串代表未知
	Width          *int     `json:"width"`
	Height         *int     `json:"height"`
	FPS            *float64 `json:"fps"`
	TBR            *float64 `json:"tbr"`
	ABR            *float64 `json:"abr"`
	VBR            *float64 `json:"vbr"`
	Filesize       *int64   `json:"filesize"`
	FilesizeApprox *int64   `json:"filesizeApprox"`
	Note           string   `json:"note"`
	Protocol       string   `json:"protocol"`
	DynamicRange   string   `json:"dynamicRange"`
	Language       string   `json:"language"`
	AudioChannels  *int     `json:"audioChannels"`
}

// SubTrack 是一個字幕語言。
type SubTrack struct {
	Lang string   `json:"lang"`
	Name string   `json:"name"`
	Exts []string `json:"exts,omitempty"`
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ParseInfo 把 yt-dlp -J 的輸出精簡成 Info。
func ParseInfo(b []byte) (*Info, error) {
	var r rawInfo
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	info := &Info{
		ID:         r.ID,
		Title:      r.Title,
		Channel:    r.Channel,
		Duration:   r.Duration,
		UploadDate: r.UploadDate,
		LiveStatus: r.LiveStatus,
		IsLive:     (r.IsLive != nil && *r.IsLive) || r.LiveStatus == "is_live",
	}
	if info.Channel == "" {
		info.Channel = r.Uploader
	}
	if info.LiveStatus == "" {
		switch {
		case info.IsLive:
			info.LiveStatus = "is_live"
		case r.WasLive != nil && *r.WasLive:
			info.LiveStatus = "was_live"
		default:
			info.LiveStatus = "not_live"
		}
	}
	info.Chapters = []Chapter{}
	for _, c := range r.Chapters {
		if c.Start == nil || c.End == nil {
			continue
		}
		info.Chapters = append(info.Chapters, Chapter{Start: *c.Start, End: *c.End, Title: c.Title})
	}
	info.Formats = []Format{}
	for _, f := range r.Formats {
		if f.FormatID == "" || f.Ext == "mhtml" || strings.Contains(strings.ToLower(str(f.FormatNote)), "storyboard") {
			continue
		}
		if drm, ok := f.HasDRM.(bool); ok && drm {
			continue
		}
		info.Formats = append(info.Formats, Format{
			ID: f.FormatID, Ext: f.Ext, VCodec: str(f.VCodec), ACodec: str(f.ACodec),
			Width: f.Width, Height: f.Height, FPS: f.FPS, TBR: f.TBR, ABR: f.ABR, VBR: f.VBR,
			Filesize: f.Filesize, FilesizeApprox: f.FilesizeApprox, Note: str(f.FormatNote),
			Protocol: f.Protocol, DynamicRange: str(f.DynamicRange), Language: str(f.Language),
			AudioChannels: f.AudioChannels,
		})
	}
	info.Subtitles = subTracks(r.Subtitles, true)
	info.AutoCaptions = subTracks(r.AutoCaption, false)
	return info, nil
}

// subTracks 把 yt-dlp 的 {語言: [{ext, name, url}...]} 轉成清單（依語言代碼排序）。
// live_chat（聊天重播）不是字幕，略過。
func subTracks(m map[string]any, withExts bool) []SubTrack {
	out := []SubTrack{}
	for lang, v := range m {
		if lang == "live_chat" || lang == "" {
			continue
		}
		t := SubTrack{Lang: lang}
		list, _ := v.([]any)
		for _, item := range list {
			e, _ := item.(map[string]any)
			if e == nil {
				continue
			}
			if name, ok := e["name"].(string); ok && t.Name == "" {
				t.Name = name
			}
			if ext, ok := e["ext"].(string); ok && withExts {
				t.Exts = append(t.Exts, ext)
			}
		}
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Lang < out[j].Lang })
	return out
}

// FitInfo 確保 Info 編碼後不超過 limit 位元組：依序省略自動字幕的名稱、
// 自動字幕清單、超出部分的格式，並標記 Truncated。
func FitInfo(info *Info, limit int) *Info {
	size := func() int {
		b, _ := json.Marshal(info)
		return len(b)
	}
	if size() <= limit {
		return info
	}
	info.Truncated = true
	for i := range info.AutoCaptions {
		info.AutoCaptions[i].Name = ""
	}
	if size() <= limit {
		return info
	}
	info.AutoCaptions = []SubTrack{}
	// yt-dlp 的格式由差到好排列，從前面（畫質較低的）開始省略。
	for size() > limit && len(info.Formats) > 0 {
		keep := len(info.Formats) * 9 / 10
		info.Formats = info.Formats[len(info.Formats)-keep:]
	}
	for size() > limit && len(info.Chapters) > 0 {
		info.Chapters = info.Chapters[:len(info.Chapters)/2]
	}
	return info
}
