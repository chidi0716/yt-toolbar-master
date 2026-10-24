package installer

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
)

// Uninstall 移除下載功能（008 FR-30）：原生訊息設定檔、登錄機碼、安裝資料夾（小幫手、yt-dlp、
// deno、ffmpeg、狀態與記錄檔），以及 macOS 的記錄檔資料夾。已下載的影片不受影響。
// Windows 上剛結束的程序可能還鎖著檔案，刪除失敗時在 retryFor 內重試。
func Uninstall(l platform.Layout, out io.Writer, retryFor time.Duration) error {
	if filepath.Base(l.InstallDir) != platform.AppDirName {
		return fmt.Errorf("refusing to remove an unexpected folder: %s", l.InstallDir)
	}
	removed, regErr := Unregister(l)
	for _, p := range removed {
		fmt.Fprintf(out, "已移除 / Removed: %s\n", p)
	}
	dirs := []string{l.InstallDir}
	if !strings.HasPrefix(l.LogDir, l.InstallDir) && filepath.Base(l.LogDir) == platform.AppDirName {
		dirs = append(dirs, l.LogDir)
	}
	var dirErr error
	for _, d := range dirs {
		if _, err := os.Lstat(d); errors.Is(err, os.ErrNotExist) {
			continue
		}
		deadline := time.Now().Add(retryFor)
		for {
			dirErr = os.RemoveAll(d)
			if dirErr == nil || time.Now().After(deadline) {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
		if dirErr != nil {
			break
		}
		fmt.Fprintf(out, "已移除 / Removed: %s\n", d)
	}
	if regErr != nil {
		return regErr
	}
	if dirErr != nil {
		return dirErr
	}
	fmt.Fprintln(out, "完成。下載功能已移除，已下載的檔案沒有被刪除。/ Done. The download helper was removed; downloaded files were not touched.")
	return nil
}
