package ytdlp

import (
	"context"
	"errors"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
)

// UpdateResult 是 updateYtDlp 指令的結果。
type UpdateResult struct {
	// Ran 為 false 代表 yt-dlp 由套件管理工具安裝，橋接程式沒有執行更新，
	// 請使用者自行執行 Command（002 FR-60）。
	Ran      bool   `json:"ran"`
	Manager  string `json:"manager,omitempty"`
	Command  string `json:"command,omitempty"`
	Updated  bool   `json:"updated"`  // 有安裝新版本
	UpToDate bool   `json:"upToDate"` // 已經是最新版本
	Version  string `json:"version,omitempty"`
	Output   string `json:"output,omitempty"` // yt-dlp -U 輸出的最後幾行
}

var (
	updatedRe  = regexp.MustCompile(`(?i)updated yt-dlp to\s+(\S+)`)
	upToDateRe = regexp.MustCompile(`(?i)yt-dlp is up to date\s*\(([^)\s]+)`)
)

// ParseUpdateOutput 解析 yt-dlp -U 成功時的輸出。
func ParseUpdateOutput(out string) *UpdateResult {
	r := &UpdateResult{Ran: true}
	if m := updatedRe.FindStringSubmatch(out); m != nil {
		r.Updated, r.Version = true, m[1]
	} else if m := upToDateRe.FindStringSubmatch(out); m != nil {
		r.UpToDate, r.Version = true, m[1]
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) > 5 {
		lines = lines[len(lines)-5:]
	}
	r.Output = strings.TrimSpace(strings.Join(lines, "\n"))
	return r
}

// Update 實作 updateYtDlp：由套件管理工具安裝時只回傳更新指令；否則執行 yt-dlp -U
// （constitution 第 2 點：yt-dlp 自我更新是唯一允許連到 YouTube 以外的情況）。
func (t *Tools) Update(ctx context.Context) (*UpdateResult, error) {
	if t.YtDlp == "" {
		return nil, errs.New(errs.YtDlpNotFound, "yt-dlp was not found")
	}
	manager := t.ManagerOf()
	if cmd := UpdateCommand(t.Env.GOOS, manager); cmd != "" {
		return &UpdateResult{Ran: false, Manager: manager, Command: cmd}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, UpdateTimeout)
	defer cancel()
	cmd, err := t.Command(ctx, "--ignore-config", "-U")
	if err != nil {
		return nil, err
	}
	cmd.WaitDelay = 5 * time.Second
	out, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, errs.New(errs.Timeout, "yt-dlp -U did not finish in %s", UpdateTimeout)
	}
	if err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			return nil, errs.New(errs.UpdateFailed, "could not run yt-dlp: %v", err)
		}
		msg := "yt-dlp -U failed"
		for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if s := strings.TrimSpace(l); s != "" {
				msg = CleanErrorMessage(s)
			}
		}
		return nil, errs.New(errs.UpdateFailed, "%s", msg)
	}
	return ParseUpdateOutput(string(out)), nil
}
