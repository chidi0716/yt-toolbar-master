// Package logx 是橋接程式的記錄檔（plan 4.7）。
//
//   - 只記錄指令名稱、錯誤代碼、工作狀態與 yt-dlp 的錯誤訊息，不記錄 cookie 或帳號資訊（NFR-4）；
//   - 使用者家目錄的路徑以「~」取代，避免記錄使用者名稱；
//   - 檔案超過 5MB 時輪替成 host.log.1（只保留一份舊檔）。
//
// 瀏覽器啟動的橋接程式與在背景執行下載的程序會同時寫入，所以每次寫入都重新以附加模式開檔。
package logx

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// MaxSize 是記錄檔輪替的大小上限。
const MaxSize = 5 * 1024 * 1024

// FileName 是記錄檔名稱。
const FileName = "host.log"

// Logger 寫入記錄檔。零值（或 nil）不寫任何東西。
type Logger struct {
	mu   sync.Mutex
	path string
	role string
	home string
	max  int64
}

// New 建立寫到 dir/host.log 的 Logger；role 會出現在每一行（例如 host、job）。
func New(dir, role string) *Logger {
	home, _ := os.UserHomeDir()
	return &Logger{path: filepath.Join(dir, FileName), role: role, home: home, max: MaxSize}
}

// 疑似帳號資訊的片段（cookie、授權標頭、token）一律遮蔽。
// cookie 與授權標頭遮蔽到行尾；token、密碼只遮蔽一個字。
var (
	headerRe = regexp.MustCompile(`(?i)((?:set-cookie|cookie|authorization)\s*[:=]\s*)[^\n]*`)
	secretRe = regexp.MustCompile(`(?i)((?:token|password|passwd)\s*[:=]\s*)\S+`)
)

// Sanitize 遮蔽家目錄與疑似帳號資訊。
func (l *Logger) Sanitize(s string) string {
	if l.home != "" && len(l.home) > 1 {
		s = strings.ReplaceAll(s, l.home, "~")
	}
	s = headerRe.ReplaceAllString(s, "${1}[redacted]")
	s = secretRe.ReplaceAllString(s, "${1}[redacted]")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' {
			return ' '
		}
		return r
	}, s)
}

// Nop 不寫任何東西（記錄檔介面的預設值）。
type Nop struct{}

func (Nop) Printf(string, ...any) {}

// Printf 寫入一行記錄。寫入失敗時安靜地放棄。
func (l *Logger) Printf(format string, a ...any) {
	if l == nil || l.path == "" {
		return
	}
	line := fmt.Sprintf("%s %s[%d] %s\n", time.Now().Format(time.RFC3339), l.role, os.Getpid(),
		l.Sanitize(fmt.Sprintf(format, a...)))
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(l.path), 0o700); err != nil {
		return
	}
	if st, err := os.Stat(l.path); err == nil && st.Size()+int64(len(line)) > l.max {
		os.Rename(l.path, l.path+".1")
	}
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	f.WriteString(line)
	f.Close()
}
