// Package ytdlp 負責尋找 yt-dlp 與 ffmpeg、組合命令列參數、解析輸出（plan 4.5）。
package ytdlp

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
)

// Env 是尋找執行檔時用到的環境，方便在測試中替換。
type Env struct {
	GOOS string
	// BundledDir 是安裝資料夾中的 bin/（plan 4.9）：一行指令安裝的工具放在這裡，
	// 尋找時最優先（008 FR-15）。空字串代表不找。
	BundledDir string
	Getenv     func(string) string
	LookPath   func(string) (string, error)
	Glob       func(string) ([]string, error)
	IsFile     func(string) bool
}

// SystemEnv 回傳目前系統的 Env。
func SystemEnv() Env {
	return Env{
		GOOS:       runtime.GOOS,
		BundledDir: platform.BinDir(),
		Getenv:     os.Getenv,
		LookPath:   exec.LookPath,
		Glob:       filepath.Glob,
		IsFile: func(p string) bool {
			st, err := os.Stat(p)
			return err == nil && st.Mode().IsRegular()
		},
	}
}

func (e Env) join(parts ...string) string {
	if e.GOOS == "windows" {
		return strings.Join(parts, `\`)
	}
	return strings.Join(parts, "/")
}

// ExtraDirs 是 PATH 以外要找的資料夾（plan 4.5）。瀏覽器啟動的程式在 macOS 上
// PATH 很短（/usr/bin:/bin:/usr/sbin:/sbin），看不到 Homebrew 安裝的程式。
func (e Env) ExtraDirs() []string {
	switch e.GOOS {
	case "darwin":
		return []string{"/opt/homebrew/bin", "/usr/local/bin"}
	case "windows":
		if la := e.Getenv("LOCALAPPDATA"); la != "" {
			return []string{e.join(la, "Microsoft", "WinGet", "Links")}
		}
	}
	return nil
}

// packagePatterns 是 winget 套件資料夾內的位置（Links 沒有建立時的備用）。
func (e Env) packagePatterns(tool string) []string {
	if e.GOOS != "windows" {
		return nil
	}
	la := e.Getenv("LOCALAPPDATA")
	if la == "" {
		return nil
	}
	pkgs := e.join(la, "Microsoft", "WinGet", "Packages")
	switch tool {
	case "yt-dlp":
		return []string{e.join(pkgs, "yt-dlp.yt-dlp_*", "yt-dlp.exe"), e.join(pkgs, "*", "yt-dlp.exe")}
	case "ffmpeg", "ffprobe":
		return []string{e.join(pkgs, "Gyan.FFmpeg_*", "*", "bin", tool+".exe"), e.join(pkgs, "*", "*", "bin", tool+".exe")}
	case "deno":
		return []string{e.join(pkgs, "DenoLand.Deno_*", "deno.exe"), e.join(pkgs, "*", "deno.exe")}
	}
	return nil
}

// Find 依序在安裝資料夾的 bin/、PATH、ExtraDirs、winget 套件資料夾尋找 tool
// （"yt-dlp"、"ffmpeg"、"ffprobe" 或 "deno"）。找不到時回傳空字串。
func (e Env) Find(tool string) string {
	exe := tool
	if e.GOOS == "windows" {
		exe += ".exe"
	}
	if e.BundledDir != "" {
		if p := e.join(e.BundledDir, exe); e.IsFile(p) {
			return p
		}
	}
	if p, err := e.LookPath(exe); err == nil && p != "" {
		if abs, err := filepath.Abs(p); err == nil {
			return abs
		}
		return p
	}
	for _, dir := range e.ExtraDirs() {
		if p := e.join(dir, exe); e.IsFile(p) {
			return p
		}
	}
	for _, pat := range e.packagePatterns(tool) {
		matches, _ := e.Glob(pat)
		sort.Sort(sort.Reverse(sort.StringSlice(matches))) // 資料夾名稱含版本號：字串較大的優先
		for _, m := range matches {
			if e.IsFile(m) {
				return m
			}
		}
	}
	return ""
}

// ChildPath 回傳給 yt-dlp 子程序使用的 PATH：原本的 PATH 加上 ExtraDirs 與
// 找到的 ffmpeg、deno 所在資料夾，讓 yt-dlp 也找得到 ffprobe 與 JavaScript 執行環境。
// tools 是執行檔的完整路徑（空字串略過）。
func (e Env) ChildPath(tools ...string) string {
	sep := ":"
	if e.GOOS == "windows" {
		sep = ";"
	}
	var parts []string
	seen := map[string]bool{}
	add := func(p string) {
		if p != "" && !seen[p] {
			seen[p] = true
			parts = append(parts, p)
		}
	}
	for _, p := range strings.Split(e.Getenv("PATH"), sep) {
		add(p)
	}
	for _, p := range e.ExtraDirs() {
		add(p)
	}
	for _, tool := range tools {
		if tool == "" {
			continue
		}
		if e.GOOS == "windows" {
			add(tool[:max(0, strings.LastIndexAny(tool, `\/`))])
		} else {
			add(filepath.Dir(tool))
		}
	}
	return strings.Join(parts, sep)
}

// IsBundled 回傳 path 是否位於安裝資料夾的 bin/ 中。
func (e Env) IsBundled(path string) bool {
	if e.BundledDir == "" || path == "" {
		return false
	}
	dir := path[:max(0, strings.LastIndexAny(path, `\/`))]
	if e.GOOS == "windows" {
		return strings.EqualFold(dir, e.BundledDir)
	}
	return dir == e.BundledDir
}

// Source 回傳工具的來源（008 FR-24、plan 4.9 的 status）：
// "bundled"（安裝資料夾）、"homebrew"、"winget"，其他一律為 "path"。
func (e Env) Source(path string) string {
	if e.IsBundled(path) {
		return "bundled"
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		resolved = path
	}
	switch Manager(e.GOOS, path, resolved, nil) {
	case "homebrew":
		return "homebrew"
	case "winget":
		return "winget"
	}
	return "path"
}

// Manager 判斷 yt-dlp 是由哪個套件管理工具安裝的；不是時回傳空字串。
// path 是找到的路徑，resolved 是解析符號連結後的路徑（Homebrew 會連到 Cellar），
// head 是檔案開頭的幾百個位元組（pip 安裝的是 Python 腳本）。
func Manager(goos, path, resolved string, head []byte) string {
	lower := strings.ToLower(path + "\n" + resolved)
	switch goos {
	case "windows":
		if strings.Contains(lower, `\microsoft\winget\`) || strings.Contains(lower, `/microsoft/winget/`) {
			return "winget"
		}
		if strings.Contains(lower, `\scoop\`) {
			return "scoop"
		}
		if strings.Contains(lower, `\python`) && strings.Contains(lower, `\scripts\`) {
			return "pip"
		}
	default:
		if strings.Contains(lower, "/cellar/") || strings.Contains(lower, "/homebrew/") {
			return "homebrew"
		}
		if strings.Contains(lower, "/pipx/") {
			return "pipx"
		}
		if strings.Contains(lower, "/opt/local/") {
			return "macports"
		}
		if len(head) > 2 && head[0] == '#' && head[1] == '!' {
			line, _, _ := strings.Cut(string(head), "\n")
			// 官方 release 的 yt-dlp 也是以 #!/usr/bin/env python3 開頭的 zip 檔，
			// pip 產生的腳本則會 import yt_dlp。
			if strings.Contains(line, "python") && strings.Contains(string(head), "from yt_dlp") {
				return "pip"
			}
		}
	}
	return ""
}

// UpdateCommand 回傳由套件管理工具安裝時的更新指令。
func UpdateCommand(goos, manager string) string {
	switch manager {
	case "homebrew":
		return "brew upgrade yt-dlp"
	case "winget":
		return "winget upgrade --id yt-dlp.yt-dlp"
	case "scoop":
		return "scoop update yt-dlp"
	case "pipx":
		return "pipx upgrade yt-dlp"
	case "pip":
		if goos == "windows" {
			return "py -m pip install -U yt-dlp"
		}
		return "python3 -m pip install -U yt-dlp"
	case "macports":
		return "sudo port selfupdate && sudo port upgrade yt-dlp"
	}
	return ""
}
