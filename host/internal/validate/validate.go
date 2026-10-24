// Package validate 實作指令參數的驗證規則（plan 4.4、002 FR-71 至 FR-73）。
//
// 原則：
//   - 每個參數都是白名單或明確的格式檢查，通過後才會被組成 yt-dlp 的參數；
//   - 不認得的欄位、型別不符、不屬於該下載種類的欄位一律拒絕；
//   - 所有錯誤都是 errs.InvalidArgs，訊息指出是哪一個欄位。
package validate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
)

var (
	// videoIDRe：YouTube 影片 ID，11 碼英數字、-、_（FR-71）。
	videoIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	// formatIDRe：yt-dlp 的格式 ID，可以是「影像+聲音」兩個 ID。
	// 比 plan 4.4 更嚴格：每段開頭必須是英數字，避免被 yt-dlp 當成選項。
	formatIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,9}(\+[A-Za-z0-9][A-Za-z0-9_-]{0,9})?$`)
	// subLangRe：字幕語言代碼（例如 en、zh-TW、en-orig）。
	// yt-dlp 的 --sub-langs 接受正規表示式、逗號分隔清單、開頭的「-」代表排除，
	// 因此只允許英數字與「-」，而且開頭必須是英數字。
	subLangRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,19}$`)
	// jobIDRe：橋接程式產生的工作 ID（16 個小寫十六進位字元）。
	jobIDRe = regexp.MustCompile(`^[0-9a-f]{16}$`)
)

// 下載種類。
const (
	KindVideo    = "video"
	KindMP3      = "mp3"
	KindSubtitle = "subtitle"
)

// 白名單。
var (
	Containers = []string{"mp4", "webm"}
	Bitrates   = []int{64, 128, 192, 256, 320}
	SubFormats = []string{"srt", "vtt", "txt"}
)

// NamePreset 是內建的檔名格式（FR-60：不開放任意 yt-dlp 範本）。
// Template 是 yt-dlp 的輸出範本（不含副檔名與時間範圍），只在橋接程式內定義。
type NamePreset struct {
	ID       string
	Template string
	Example  string
}

// DefaultNamePreset 是預設的檔名格式（FR-8：「影片標題 [影片ID]」）。
const DefaultNamePreset = "title-id"

// NamePresets 是全部的檔名格式，依顯示順序排列。
var NamePresets = []NamePreset{
	{ID: "title-id", Template: "%(title)s [%(id)s]", Example: "Title [dQw4w9WgXcQ]"},
	{ID: "title", Template: "%(title)s", Example: "Title"},
	{ID: "channel-title", Template: "%(channel,uploader|Unknown)s - %(title)s [%(id)s]", Example: "Channel - Title [dQw4w9WgXcQ]"},
	{ID: "date-title", Template: "%(upload_date>%Y-%m-%d|Unknown)s %(title)s [%(id)s]", Example: "2009-10-25 Title [dQw4w9WgXcQ]"},
}

// LookupNamePreset 依 ID 找檔名格式。
func LookupNamePreset(id string) (NamePreset, bool) {
	for _, p := range NamePresets {
		if p.ID == id {
			return p, true
		}
	}
	return NamePreset{}, false
}

// MaxSectionSeconds 是時間範圍的上限（100 小時），避免不合理的數值。
const MaxSectionSeconds = 100 * 3600

// MaxDirLength 是下載資料夾路徑的長度上限（位元組）。
const MaxDirLength = 1024

// Section 是時間範圍（秒），Start < End。
type Section struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

// Download 是通過驗證的下載參數。
type Download struct {
	VideoID    string   `json:"videoId"`
	Kind       string   `json:"kind"`
	FormatID   string   `json:"formatId,omitempty"`
	Container  string   `json:"container,omitempty"`
	Bitrate    int      `json:"bitrate,omitempty"`
	Section    *Section `json:"section,omitempty"`
	SubLang    string   `json:"subLang,omitempty"`
	SubFormat  string   `json:"subFormat,omitempty"`
	SubAuto    bool     `json:"subAuto,omitempty"`
	Dir        string   `json:"dir"`
	NamePreset string   `json:"namePreset"`
	Embed      bool     `json:"embed"`
}

func invalid(field, format string, a ...any) *errs.Error {
	return errs.New(errs.InvalidArgs, "%s: %s", field, fmt.Sprintf(format, a...))
}

// decodeStrict 把 JSON 物件解到 v，不認得的欄位或多餘資料都算錯。
func decodeStrict(raw json.RawMessage, v any) error {
	if len(raw) == 0 {
		raw = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	dec.UseNumber()
	if err := dec.Decode(v); err != nil {
		return errs.New(errs.InvalidArgs, "args: %v", err)
	}
	if dec.More() {
		return errs.New(errs.InvalidArgs, "args: trailing data")
	}
	return nil
}

// NoArgs 檢查不需要參數的指令：args 必須省略或是空物件。
func NoArgs(raw json.RawMessage) error {
	var v struct{}
	return decodeStrict(raw, &v)
}

// VideoID 檢查影片 ID。
func VideoID(s string) error {
	if !videoIDRe.MatchString(s) {
		return invalid("videoId", "must be 11 characters of A-Z a-z 0-9 _ -")
	}
	return nil
}

// JobID 檢查工作 ID。
func JobID(s string) error {
	if !jobIDRe.MatchString(s) {
		return invalid("jobId", "must be 16 lowercase hex characters")
	}
	return nil
}

// FormatID 檢查格式 ID。
func FormatID(s string) error {
	if !formatIDRe.MatchString(s) {
		return invalid("formatId", "must look like 137 or 137+140")
	}
	return nil
}

// Container 檢查容器格式。
func Container(s string) error {
	for _, c := range Containers {
		if s == c {
			return nil
		}
	}
	return invalid("container", "must be one of %s", strings.Join(Containers, ", "))
}

// Bitrate 檢查 MP3 位元率。
func Bitrate(n int) error {
	for _, b := range Bitrates {
		if n == b {
			return nil
		}
	}
	return invalid("bitrate", "must be one of 64, 128, 192, 256, 320")
}

// SubLang 檢查字幕語言代碼。
func SubLang(s string) error {
	if !subLangRe.MatchString(s) || strings.EqualFold(s, "all") {
		return invalid("subLang", "must be a language code such as en or zh-TW")
	}
	return nil
}

// SubFormat 檢查字幕格式。
func SubFormat(s string) error {
	for _, f := range SubFormats {
		if s == f {
			return nil
		}
	}
	return invalid("subFormat", "must be one of srt, vtt, txt")
}

// NamePresetID 檢查檔名格式 ID。
func NamePresetID(s string) error {
	if _, ok := LookupNamePreset(s); !ok {
		ids := make([]string, len(NamePresets))
		for i, p := range NamePresets {
			ids[i] = p.ID
		}
		return invalid("namePreset", "must be one of %s", strings.Join(ids, ", "))
	}
	return nil
}

var wholeNumberRe = regexp.MustCompile(`^[0-9]{1,10}$`)

// parseSeconds 把 JSON 數字解析成非負整數秒數；字串、小數、指數、負數都拒絕。
func parseSeconds(field string, raw json.RawMessage) (int64, error) {
	s := string(bytes.TrimSpace(raw))
	if !wholeNumberRe.MatchString(s) {
		return 0, invalid(field, "must be a non-negative whole number of seconds")
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil || v > MaxSectionSeconds {
		return 0, invalid(field, "must be between 0 and %d", MaxSectionSeconds)
	}
	return v, nil
}

// SectionFromJSON 檢查時間範圍。
func SectionFromJSON(raw json.RawMessage) (*Section, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var s struct {
		Start json.RawMessage `json:"start"`
		End   json.RawMessage `json:"end"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil || dec.More() {
		return nil, invalid("section", "must be {\"start\": seconds, \"end\": seconds}")
	}
	if s.Start == nil || s.End == nil {
		return nil, invalid("section", "start and end are required")
	}
	start, err := parseSeconds("section.start", s.Start)
	if err != nil {
		return nil, err
	}
	end, err := parseSeconds("section.end", s.End)
	if err != nil {
		return nil, err
	}
	if start >= end {
		return nil, invalid("section", "start must be before end")
	}
	return &Section{Start: start, End: end}, nil
}

// DirSyntax 只檢查下載資料夾的字串格式（不碰檔案系統）：
// 絕對路徑、合法 UTF-8、沒有控制字元、沒有「..」、長度有上限；
// Windows 上拒絕 \\?\ 與 \\.\ 開頭的裝置路徑。
func DirSyntax(dir string) error {
	return dirSyntax(dir, runtime.GOOS)
}

// DirSyntaxFor 依指定作業系統的路徑規則檢查（DirSyntax 使用目前的作業系統）。
func DirSyntaxFor(goos, dir string) error { return dirSyntax(dir, goos) }

func dirSyntax(dir, goos string) error {
	if dir == "" {
		return invalid("dir", "is required")
	}
	if len(dir) > MaxDirLength {
		return invalid("dir", "is too long")
	}
	if !utf8.ValidString(dir) {
		return invalid("dir", "is not valid UTF-8")
	}
	for _, r := range dir {
		if unicode.IsControl(r) {
			return invalid("dir", "contains control characters")
		}
	}
	var isAbs bool
	if goos == "windows" {
		isAbs = windowsIsAbs(dir)
		if strings.HasPrefix(dir, `\\?\`) || strings.HasPrefix(dir, `\\.\`) ||
			strings.HasPrefix(dir, `//?/`) || strings.HasPrefix(dir, `//./`) {
			return invalid("dir", "device paths are not allowed")
		}
	} else {
		isAbs = strings.HasPrefix(dir, "/")
	}
	if !isAbs {
		return invalid("dir", "must be an absolute path")
	}
	for _, part := range strings.FieldsFunc(dir, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part == ".." || part == "." {
			return invalid("dir", "must not contain . or .. components")
		}
	}
	return nil
}

// windowsIsAbs 判斷 Windows 的絕對路徑（C:\... 或 \\server\share\...），
// 與執行時的作業系統無關，方便在 Linux 上測試。
func windowsIsAbs(p string) bool {
	if len(p) >= 3 && isLetter(p[0]) && p[1] == ':' && (p[2] == '\\' || p[2] == '/') {
		return true
	}
	if len(p) >= 5 && (strings.HasPrefix(p, `\\`) || strings.HasPrefix(p, `//`)) {
		rest := strings.FieldsFunc(p[2:], func(r rune) bool { return r == '/' || r == '\\' })
		return len(rest) >= 2
	}
	return false
}

func isLetter(c byte) bool { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }

// Dir 檢查下載資料夾：格式正確、存在、是資料夾、可以寫入（FR-73）。
// 回傳整理過的路徑（filepath.Clean）。格式錯誤為 INVALID_ARGS；不存在、不是資料夾或無法寫入為
// PERMISSION_DENIED，擴充功能顯示「無法寫入下載資料夾」並附開啟設定頁（002 FR-6a、QUESTIONS Q46）。
func Dir(dir string) (string, error) {
	if err := DirSyntax(dir); err != nil {
		return "", err
	}
	clean := filepath.Clean(dir)
	st, err := os.Stat(clean)
	if err != nil {
		return "", errs.New(errs.PermissionDenied, "dir: folder does not exist")
	}
	if !st.IsDir() {
		return "", errs.New(errs.PermissionDenied, "dir: not a folder")
	}
	f, err := os.CreateTemp(clean, ".ytm-write-test-*")
	if err != nil {
		return "", errs.New(errs.PermissionDenied, "dir: folder is not writable")
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return clean, nil
}

// downloadJSON 是 download 指令的原始參數。指標型別用來分辨「沒給」與「給了零值」。
type downloadJSON struct {
	VideoID    *string         `json:"videoId"`
	Kind       *string         `json:"kind"`
	FormatID   *string         `json:"formatId"`
	Container  *string         `json:"container"`
	Bitrate    json.RawMessage `json:"bitrate"`
	Section    json.RawMessage `json:"section"`
	SubLang    *string         `json:"subLang"`
	SubFormat  *string         `json:"subFormat"`
	SubAuto    *bool           `json:"subAuto"`
	Dir        *string         `json:"dir"`
	NamePreset *string         `json:"namePreset"`
	Embed      *bool           `json:"embed"`
}

// DownloadArgs 解析並檢查 download 指令的參數（不碰檔案系統）。
// 下載資料夾是否存在、可寫入由 Dir 另外檢查。
func DownloadArgs(raw json.RawMessage) (*Download, error) {
	var a downloadJSON
	if err := decodeStrict(raw, &a); err != nil {
		return nil, err
	}
	d := &Download{NamePreset: DefaultNamePreset, Embed: true}

	if a.VideoID == nil {
		return nil, invalid("videoId", "is required")
	}
	if err := VideoID(*a.VideoID); err != nil {
		return nil, err
	}
	d.VideoID = *a.VideoID

	if a.Kind == nil {
		return nil, invalid("kind", "is required")
	}
	d.Kind = *a.Kind

	if a.Dir == nil {
		return nil, invalid("dir", "is required")
	}
	if err := DirSyntax(*a.Dir); err != nil {
		return nil, err
	}
	d.Dir = *a.Dir

	if a.NamePreset != nil {
		if err := NamePresetID(*a.NamePreset); err != nil {
			return nil, err
		}
		d.NamePreset = *a.NamePreset
	}

	section, err := SectionFromJSON(a.Section)
	if err != nil {
		return nil, err
	}

	// 不屬於該種類的欄位一律拒絕，避免擴充功能誤以為某個參數有作用。
	forbid := func(name string, present bool) error {
		if present {
			return invalid(name, "is not allowed for kind %q", d.Kind)
		}
		return nil
	}
	sectionGiven := len(a.Section) > 0 && string(a.Section) != "null"

	switch d.Kind {
	case KindVideo:
		if a.FormatID == nil {
			return nil, invalid("formatId", "is required")
		}
		if err := FormatID(*a.FormatID); err != nil {
			return nil, err
		}
		if a.Container == nil {
			return nil, invalid("container", "is required")
		}
		if err := Container(*a.Container); err != nil {
			return nil, err
		}
		for _, f := range []struct {
			name    string
			present bool
		}{{"bitrate", a.Bitrate != nil}, {"subLang", a.SubLang != nil}, {"subFormat", a.SubFormat != nil}, {"subAuto", a.SubAuto != nil}} {
			if err := forbid(f.name, f.present); err != nil {
				return nil, err
			}
		}
		d.FormatID, d.Container, d.Section = *a.FormatID, *a.Container, section
		if a.Embed != nil {
			d.Embed = *a.Embed
		}
	case KindMP3:
		if a.Bitrate == nil {
			return nil, invalid("bitrate", "is required")
		}
		if !wholeNumberRe.MatchString(string(bytes.TrimSpace(a.Bitrate))) {
			return nil, invalid("bitrate", "must be a whole number")
		}
		n, err := strconv.Atoi(string(bytes.TrimSpace(a.Bitrate)))
		if err != nil {
			return nil, invalid("bitrate", "must be a whole number")
		}
		if err := Bitrate(n); err != nil {
			return nil, err
		}
		for _, f := range []struct {
			name    string
			present bool
		}{{"formatId", a.FormatID != nil}, {"container", a.Container != nil}, {"subLang", a.SubLang != nil}, {"subFormat", a.SubFormat != nil}, {"subAuto", a.SubAuto != nil}} {
			if err := forbid(f.name, f.present); err != nil {
				return nil, err
			}
		}
		d.Bitrate, d.Section = n, section
		if a.Embed != nil {
			d.Embed = *a.Embed
		}
	case KindSubtitle:
		if a.SubLang == nil {
			return nil, invalid("subLang", "is required")
		}
		if err := SubLang(*a.SubLang); err != nil {
			return nil, err
		}
		if a.SubFormat == nil {
			return nil, invalid("subFormat", "is required")
		}
		if err := SubFormat(*a.SubFormat); err != nil {
			return nil, err
		}
		for _, f := range []struct {
			name    string
			present bool
		}{{"formatId", a.FormatID != nil}, {"container", a.Container != nil}, {"bitrate", a.Bitrate != nil}, {"section", sectionGiven}, {"embed", a.Embed != nil}} {
			if err := forbid(f.name, f.present); err != nil {
				return nil, err
			}
		}
		d.SubLang, d.SubFormat = *a.SubLang, *a.SubFormat
		if a.SubAuto != nil {
			d.SubAuto = *a.SubAuto
		}
		d.Embed = false
	default:
		return nil, invalid("kind", "must be one of video, mp3, subtitle")
	}
	return d, nil
}

// Recheck 再次檢查一份已儲存的下載參數（執行下載的程序從狀態資料夾讀回時使用）：
// 轉回 download 指令的參數形式再驗證一次，結果必須與原本完全相同。
func Recheck(d *Download) error {
	again, err := DownloadArgs(ToArgs(d))
	if err != nil {
		return err
	}
	if !Equal(again, d) {
		return errs.New(errs.InvalidArgs, "stored job does not match its validated form")
	}
	return nil
}

// Equal 比較兩份下載參數。
func Equal(a, b *Download) bool {
	sa, sb := a.Section, b.Section
	a2, b2 := *a, *b
	a2.Section, b2.Section = nil, nil
	if a2 != b2 {
		return false
	}
	if (sa == nil) != (sb == nil) {
		return false
	}
	return sa == nil || *sa == *sb
}

// ToArgs 把 Download 轉回 download 指令的參數形式（只含屬於該種類的欄位）。
func ToArgs(d *Download) json.RawMessage {
	m := map[string]any{
		"videoId":    d.VideoID,
		"kind":       d.Kind,
		"dir":        d.Dir,
		"namePreset": d.NamePreset,
	}
	switch d.Kind {
	case KindVideo:
		m["formatId"], m["container"], m["embed"] = d.FormatID, d.Container, d.Embed
	case KindMP3:
		m["bitrate"], m["embed"] = d.Bitrate, d.Embed
	case KindSubtitle:
		m["subLang"], m["subFormat"], m["subAuto"] = d.SubLang, d.SubFormat, d.SubAuto
	}
	if d.Section != nil && d.Kind != KindSubtitle {
		m["section"] = d.Section
	}
	b, _ := json.Marshal(m)
	return b
}
