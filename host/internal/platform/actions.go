package platform

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
)

// Command 是要執行的系統程式。執行檔一律是絕對路徑，參數固定、不含使用者輸入
// （reveal 的檔案路徑來自橋接程式自己的工作紀錄，不是擴充功能傳來的）。
type Command struct {
	Path string
	Args []string
	// CmdLine 只用於 Windows：直接指定整個命令列（explorer.exe 的 /select, 需要特殊的引號格式）。
	CmdLine string
}

func systemRoot(getenv func(string) string) string {
	if r := getenv("SystemRoot"); r != "" {
		return r
	}
	return `C:\Windows`
}

// RevealCommand 回傳「在 Finder／檔案總管中顯示並選取檔案」的命令。
func RevealCommand(goos, path string, getenv func(string) string) (*Command, error) {
	switch goos {
	case "darwin":
		return &Command{Path: "/usr/bin/open", Args: []string{"-R", path}}, nil
	case "windows":
		if strings.ContainsAny(path, "\"\r\n") {
			return nil, errs.New(errs.InvalidArgs, "unexpected characters in path")
		}
		exe := systemRoot(getenv) + `\explorer.exe`
		return &Command{Path: exe, Args: []string{"/select," + path}, CmdLine: `"` + exe + `" /select,"` + path + `"`}, nil
	}
	return nil, errs.New(errs.UnsupportedPlatform, "reveal is not supported on %s", goos)
}

// macPickFolderScript 是 macOS 的選擇資料夾腳本：先讓 osascript 成為前景程式，
// 讓視窗出現在瀏覽器之前；預設位置為「下載」資料夾。
var macPickFolderScript = []string{
	"activate",
	"POSIX path of (choose folder default location (path to downloads folder))",
}

// winPickFolderScript 是 Windows 的選擇資料夾腳本（PowerShell + Windows Forms）。
// 以置頂的隱形視窗作為擁有者，讓對話框出現在瀏覽器之前；以 UTF-8 輸出路徑。
const winPickFolderScript = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.ShowNewFolderButton = $true
$downloads = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
if (Test-Path -LiteralPath $downloads) { $dialog.SelectedPath = $downloads }
try {
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write($dialog.SelectedPath)
  }
} finally {
  $owner.Dispose()
}
`

// encodePowerShell 把腳本編成 -EncodedCommand 需要的格式（UTF-16LE 再以 base64 編碼），
// 避免命令列引號的問題。
func encodePowerShell(script string) string {
	u := utf16.Encode([]rune(script))
	b := make([]byte, 2*len(u))
	for i, c := range u {
		b[2*i] = byte(c)
		b[2*i+1] = byte(c >> 8)
	}
	return base64.StdEncoding.EncodeToString(b)
}

// PickFolderCommand 回傳開啟系統「選擇資料夾」視窗的命令。
func PickFolderCommand(goos string, getenv func(string) string) (*Command, error) {
	switch goos {
	case "darwin":
		var args []string
		for _, line := range macPickFolderScript {
			args = append(args, "-e", line)
		}
		return &Command{Path: "/usr/bin/osascript", Args: args}, nil
	case "windows":
		exe := systemRoot(getenv) + `\System32\WindowsPowerShell\v1.0\powershell.exe`
		return &Command{Path: exe, Args: []string{
			"-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodePowerShell(winPickFolderScript),
		}}, nil
	}
	return nil, errs.New(errs.UnsupportedPlatform, "pickFolder is not supported on %s", goos)
}

// PickFolderResult 是 pickFolder 指令的結果。使用者按「取消」時 Cancelled 為 true、Path 為 null。
type PickFolderResult struct {
	Path      *string `json:"path"`
	Cancelled bool    `json:"cancelled"`
}

// ParsePickFolder 解析選擇資料夾命令的輸出。
func ParsePickFolder(goos string, stdout, stderr string, runErr error) (*PickFolderResult, error) {
	out := strings.TrimSpace(strings.TrimPrefix(stdout, "\uFEFF"))
	if runErr != nil {
		// macOS：使用者取消時 osascript 回傳錯誤 -128（User canceled）。
		if goos == "darwin" && (strings.Contains(stderr, "-128") || strings.Contains(strings.ToLower(stderr), "user canceled")) {
			return &PickFolderResult{Cancelled: true}, nil
		}
		return nil, errs.New(errs.Unknown, "folder dialog failed: %s", firstLine(stderr, runErr))
	}
	if out == "" {
		return &PickFolderResult{Cancelled: true}, nil
	}
	if goos == "darwin" && len(out) > 1 {
		out = strings.TrimSuffix(out, "/")
	}
	if err := validateDirFor(goos, out); err != nil {
		return nil, errs.New(errs.Unknown, "folder dialog returned an unexpected path")
	}
	return &PickFolderResult{Path: &out}, nil
}

func firstLine(s string, err error) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return err.Error()
	}
	l, _, _ := strings.Cut(s, "\n")
	return strings.TrimSpace(l)
}

// validateDirFor 依作業系統檢查路徑格式（測試時可以檢查其他作業系統的格式）。
func validateDirFor(goos, dir string) error { return validate.DirSyntaxFor(goos, dir) }

// Actions 執行平台相關的指令。
type Actions struct {
	GOOS   string
	Getenv func(string) string

	pickMu sync.Mutex
}

// NewActions 建立目前系統的 Actions。
func NewActions() *Actions { return &Actions{GOOS: runtime.GOOS, Getenv: os.Getenv} }

func (a *Actions) command(ctx context.Context, c *Command) *exec.Cmd {
	cmd := exec.CommandContext(ctx, c.Path, c.Args...)
	if c.CmdLine != "" {
		setCmdLine(cmd, c.CmdLine)
	}
	HideConsole(cmd)
	return cmd
}

// Reveal 在 Finder／檔案總管中選取檔案。
func (a *Actions) Reveal(ctx context.Context, path string) error {
	if !IsFile(path) {
		return errs.New(errs.FileNotFound, "the file was moved or deleted")
	}
	c, err := RevealCommand(a.GOOS, path, a.Getenv)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	err = a.command(ctx, c).Run()
	// explorer.exe 即使成功也常回傳 1，所以 Windows 不看結束代碼。
	if err != nil && a.GOOS != "windows" {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) || ctx.Err() != nil {
			return errs.New(errs.Unknown, "could not reveal the file: %v", err)
		}
		return errs.New(errs.UnsupportedPlatform, "could not run %s: %v", c.Path, err)
	}
	return nil
}

// PickFolderTimeout 是選擇資料夾視窗的時間上限。
const PickFolderTimeout = 10 * time.Minute

// PickFolder 開啟系統的選擇資料夾視窗。同一時間只能開一個。
func (a *Actions) PickFolder(ctx context.Context) (*PickFolderResult, error) {
	c, err := PickFolderCommand(a.GOOS, a.Getenv)
	if err != nil {
		return nil, err
	}
	if !a.pickMu.TryLock() {
		return nil, errs.New(errs.Busy, "a folder dialog is already open")
	}
	defer a.pickMu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, PickFolderTimeout)
	defer cancel()
	cmd := a.command(ctx, c)
	var stdout, stderr strings.Builder
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	runErr := cmd.Run()
	if ctx.Err() != nil {
		return nil, errs.New(errs.Timeout, "the folder dialog was closed")
	}
	return ParsePickFolder(a.GOOS, stdout.String(), stderr.String(), runErr)
}
