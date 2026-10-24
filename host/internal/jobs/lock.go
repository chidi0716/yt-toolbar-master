package jobs

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// LockFile 建立內容為目前 PID 的鎖檔；已經存在時回傳 os.ErrExist 類的錯誤。
// takeOverStale 為 true 時，鎖檔中的程序已經結束（或內容錯誤）就取代它。
func LockFile(p string, takeOverStale bool) (unlock func(), err error) {
	for attempt := 0; ; attempt++ {
		f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			fmt.Fprintf(f, "%d\n", os.Getpid())
			f.Close()
			return func() { os.Remove(p) }, nil
		}
		if !os.IsExist(err) || !takeOverStale || attempt > 0 {
			return nil, err
		}
		if pid := LockHolder(p); pid > 0 && processAlive(pid) {
			return nil, err
		}
		os.Remove(p)
	}
}

// LockHolder 回傳鎖檔中的 PID：沒有鎖檔時為 0，內容錯誤時為 -1（視為已失效）。
func LockHolder(p string) int {
	b, err := os.ReadFile(p)
	if err != nil {
		return 0
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 0 {
		return -1
	}
	return pid
}
