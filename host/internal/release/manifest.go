package release

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// SchemaVersion 是目前的清單格式版本。
const SchemaVersion = 1

// 支援的平台（plan 4.8：macOS Apple Silicon／Intel、Windows x64）。
const (
	DarwinARM64  = "darwin-arm64"
	DarwinAMD64  = "darwin-amd64"
	WindowsAMD64 = "windows-amd64"
)

// Platforms 是每個元件都必須提供的平台。
var Platforms = []string{DarwinARM64, DarwinAMD64, WindowsAMD64}

// 第三方工具的名稱。
const (
	ToolYtDlp  = "yt-dlp"
	ToolDeno   = "deno"
	ToolFFmpeg = "ffmpeg"
)

// ToolNames 是清單中必須有的第三方工具。
var ToolNames = []string{ToolYtDlp, ToolDeno, ToolFFmpeg}

// toolBinaries 是每個工具安裝後的執行檔名稱（Windows 另加 .exe）。
var toolBinaries = map[string][]string{
	ToolYtDlp:  {"yt-dlp"},
	ToolDeno:   {"deno"},
	ToolFFmpeg: {"ffmpeg", "ffprobe"},
}

// Binaries 回傳 tool 在 platform 上安裝後的執行檔名稱。
func Binaries(tool, platform string) []string {
	var out []string
	for _, b := range toolBinaries[tool] {
		out = append(out, ExeName(b, platform))
	}
	return out
}

// ExeName 在 Windows 平台加上 .exe。
func ExeName(name, platform string) string {
	if strings.HasPrefix(platform, "windows-") {
		return name + ".exe"
	}
	return name
}

// MacYtDlpExe 是 macOS 未封裝版 yt-dlp（yt-dlp_macos.zip）資料夾中的執行檔（008 FR-15a）。
const MacYtDlpExe = "yt-dlp_macos"

// UnpackedExe 回傳 tool 在 platform 上以整個資料夾安裝時，資料夾中的執行檔名稱；否則回傳空字串。
// 目前只有 macOS 的 yt-dlp：yt-dlp_macos.zip 整個解壓到 bin/yt-dlp/，執行檔為 bin/yt-dlp/yt-dlp_macos。
func UnpackedExe(tool, platform string) string {
	if tool == ToolYtDlp && strings.HasPrefix(platform, "darwin-") {
		return MacYtDlpExe
	}
	return ""
}

// HelperFileName 回傳小幫手在 Release 中的檔名。
func HelperFileName(platform string) string {
	return ExeName("ytm-host-"+platform, platform)
}

// Asset 是一個可下載的檔案。
type Asset struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
}

// File 是第三方工具的一個下載檔案。
//
//   - Archive 為空字串：下載的檔案本身就是執行檔，安裝為 Name。
//   - Archive 為 "zip"：從壓縮檔中取出 Extract 列出的檔案（只比對檔名，不使用壓縮檔中的路徑）。
//     UnpackedExe 不為空字串的工具例外：整個壓縮檔解壓到 bin/<Extract[0]>/。
//     這個寫法讓 v0.1.0 的小幫手仍然接受新的清單（它只檢查 Extract 是工具的名稱），才能自我更新。
//
// Checksums 只出現在 release/components.lock.json：官方公布檢查碼的網址，發佈流程以它核對 SHA256。
type File struct {
	URL       string   `json:"url"`
	SHA256    string   `json:"sha256"`
	Archive   string   `json:"archive,omitempty"`
	Name      string   `json:"name,omitempty"`
	Extract   []string `json:"extract,omitempty"`
	Checksums string   `json:"checksums,omitempty"`
}

// Produces 回傳這個檔案安裝後產生的執行檔名稱。
func (f *File) Produces() []string {
	if f.Archive == "" {
		return []string{f.Name}
	}
	return f.Extract
}

// Platform 是工具在一個平台上的檔案。Version 省略時使用工具的版本。
type Platform struct {
	Version string `json:"version,omitempty"`
	Files   []File `json:"files"`
}

// Tool 是一個第三方工具。
type Tool struct {
	Version   string              `json:"version"`
	Platforms map[string]Platform `json:"platforms"`
}

// VersionFor 回傳 platform 上的版本。
func (t Tool) VersionFor(platform string) string {
	if p, ok := t.Platforms[platform]; ok && p.Version != "" {
		return p.Version
	}
	return t.Version
}

// Manifest 是 components.json（plan 4.9）。
type Manifest struct {
	Schema  int              `json:"schema"`
	Version string           `json:"version"`
	Helper  map[string]Asset `json:"helper"`
	Tools   map[string]Tool  `json:"tools"`
}

// URLCheck 檢查網址是否允許下載；正式環境為 AllowedURL，測試可以替換成本機伺服器。
type URLCheck func(*url.URL) bool

var (
	sha256Re  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	versionRe = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$`)
	nameRe    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
)

// ValidationError 是清單格式錯誤。
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return "invalid manifest: " + e.Msg }

func invalid(format string, a ...any) error { return &ValidationError{Msg: fmt.Sprintf(format, a...)} }

// ParseManifest 解析並驗證清單。不認得的欄位一律拒絕，避免格式錯誤被忽略。
func ParseManifest(data []byte, allow URLCheck) (*Manifest, error) {
	var m Manifest
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return nil, invalid("%v", err)
	}
	if dec.More() {
		return nil, invalid("trailing data")
	}
	if err := m.Validate(allow); err != nil {
		return nil, err
	}
	return &m, nil
}

// Validate 檢查清單是否完整、網址是否允許、檢查碼格式是否正確。
func (m *Manifest) Validate(allow URLCheck) error {
	if allow == nil {
		allow = AllowedURL
	}
	if m.Schema != SchemaVersion {
		return invalid("unsupported schema %d", m.Schema)
	}
	if _, ok := ParseVersion(m.Version); !ok {
		return invalid("version %q is not x.y.z", m.Version)
	}
	if len(m.Helper) != len(Platforms) {
		return invalid("helper must list exactly %s", strings.Join(Platforms, ", "))
	}
	for _, p := range Platforms {
		a, ok := m.Helper[p]
		if !ok {
			return invalid("helper.%s is missing", p)
		}
		if err := checkURL(a.URL, allow); err != nil {
			return invalid("helper.%s: %v", p, err)
		}
		if !sha256Re.MatchString(a.SHA256) {
			return invalid("helper.%s: sha256 must be 64 lowercase hex characters", p)
		}
	}
	return validateTools(m.Tools, allow, false)
}

// validateTools 檢查工具清單。lock 為 true 時每個檔案都必須有官方檢查碼網址。
func validateTools(tools map[string]Tool, allow URLCheck, lock bool) error {
	if len(tools) != len(ToolNames) {
		names := make([]string, 0, len(tools))
		for n := range tools {
			names = append(names, n)
		}
		sort.Strings(names)
		return invalid("tools must be exactly %s (got %s)", strings.Join(ToolNames, ", "), strings.Join(names, ", "))
	}
	for _, name := range ToolNames {
		t, ok := tools[name]
		if !ok {
			return invalid("tools.%s is missing", name)
		}
		if !versionRe.MatchString(t.Version) {
			return invalid("tools.%s.version is missing or invalid", name)
		}
		if len(t.Platforms) != len(Platforms) {
			return invalid("tools.%s must list exactly %s", name, strings.Join(Platforms, ", "))
		}
		for _, p := range Platforms {
			pl, ok := t.Platforms[p]
			if !ok {
				return invalid("tools.%s.%s is missing", name, p)
			}
			if pl.Version != "" && !versionRe.MatchString(pl.Version) {
				return invalid("tools.%s.%s.version is invalid", name, p)
			}
			if err := validateFiles(name, p, pl.Files, allow, lock); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateFiles(tool, platform string, files []File, allow URLCheck, lock bool) error {
	where := "tools." + tool + "." + platform
	if len(files) == 0 {
		return invalid("%s has no files", where)
	}
	if UnpackedExe(tool, platform) != "" && (len(files) != 1 || files[0].Archive != "zip") {
		return invalid("%s must be a single zip that is unpacked as a folder", where)
	}
	want := map[string]bool{}
	for _, b := range Binaries(tool, platform) {
		want[b] = true
	}
	got := map[string]bool{}
	for i, f := range files {
		at := fmt.Sprintf("%s.files[%d]", where, i)
		if err := checkURL(f.URL, allow); err != nil {
			return invalid("%s: %v", at, err)
		}
		if !sha256Re.MatchString(f.SHA256) {
			return invalid("%s: sha256 must be 64 lowercase hex characters", at)
		}
		if lock {
			if err := checkURL(f.Checksums, allow); err != nil {
				return invalid("%s.checksums: %v", at, err)
			}
		} else if f.Checksums != "" {
			return invalid("%s: checksums is only allowed in the lock file", at)
		}
		switch f.Archive {
		case "":
			if f.Name == "" || len(f.Extract) != 0 {
				return invalid("%s: a plain file needs name and no extract", at)
			}
		case "zip":
			if f.Name != "" || len(f.Extract) == 0 {
				return invalid("%s: a zip needs extract and no name", at)
			}
		default:
			return invalid("%s: unsupported archive %q", at, f.Archive)
		}
		for _, n := range f.Produces() {
			if !nameRe.MatchString(n) || !want[n] {
				return invalid("%s: unexpected file name %q (want %s)", at, n, strings.Join(Binaries(tool, platform), ", "))
			}
			if got[n] {
				return invalid("%s: %q is listed twice", at, n)
			}
			got[n] = true
		}
	}
	if len(got) != len(want) {
		return invalid("%s must provide %s", where, strings.Join(Binaries(tool, platform), ", "))
	}
	return nil
}

func checkURL(s string, allow URLCheck) error {
	if s == "" {
		return fmt.Errorf("url is missing")
	}
	u, err := url.Parse(s)
	if err != nil {
		return fmt.Errorf("url is invalid")
	}
	if !allow(u) {
		return fmt.Errorf("url %q is not an allowed download location", s)
	}
	// 一律使用固定版本的網址（plan 4.9），不使用會變動的 latest。
	if strings.Contains(u.Path, "/latest/") || strings.HasSuffix(u.Path, "/latest") {
		return fmt.Errorf("url %q points to a moving \"latest\" location", s)
	}
	return nil
}

// Marshal 以固定格式（排序過的鍵、兩格縮排、結尾換行）輸出清單。
// 引導腳本以文字比對取出小幫手的 SHA256，所以格式必須固定。
func (m *Manifest) Marshal() ([]byte, error) {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}
