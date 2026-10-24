package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/installer"
	"github.com/chidi0716/yt-toolbar-master/host/internal/updater"
)

// versionCache 記住工具的版本，鍵為「路徑＋大小＋修改時間」，重複的 status 只做 stat。
// 只記住成功取得的版本；無法執行的工具每次重新檢查。
// 安裝資料夾中的安裝、更新狀態檔或更新鎖檔改變時（--install、--update 執行過）全部清空，
// updateYtDlp 之後也清空。
type versionCache struct {
	mu    sync.Mutex
	stamp string
	m     map[string]versionEntry
}

type versionEntry struct {
	size    int64
	mod     time.Time
	version string
}

func fileKey(path string) (versionEntry, bool) {
	st, err := os.Stat(path)
	if err != nil {
		return versionEntry{}, false
	}
	return versionEntry{size: st.Size(), mod: st.ModTime()}, true
}

// sync 在安裝資料夾的狀態改變時清空。
func (c *versionCache) sync(installDir string) {
	stamp := ""
	for _, name := range []string{installer.StateFileName, updater.StateFileName, updater.LockFileName} {
		if k, ok := fileKey(filepath.Join(installDir, name)); ok {
			stamp += fmt.Sprintf("%s:%d:%d;", name, k.size, k.mod.UnixNano())
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if stamp != c.stamp {
		c.stamp, c.m = stamp, nil
	}
}

func (c *versionCache) clear() {
	c.mu.Lock()
	c.m = nil
	c.mu.Unlock()
}

// version 回傳 path 的版本：檔案沒有改變時用記住的版本，否則執行 run。
func (c *versionCache) version(ctx context.Context, path string, run func(context.Context) (string, error)) (string, error) {
	key, ok := fileKey(path)
	if ok {
		c.mu.Lock()
		e, hit := c.m[path]
		c.mu.Unlock()
		if hit && e.size == key.size && e.mod.Equal(key.mod) {
			return e.version, nil
		}
	}
	v, err := run(ctx)
	if err != nil || !ok {
		return v, err
	}
	key.version = v
	c.mu.Lock()
	if c.m == nil {
		c.m = map[string]versionEntry{}
	}
	c.m[path] = key
	c.mu.Unlock()
	return v, nil
}
