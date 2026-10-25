//go:build darwin

package platform

import (
	"io/fs"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// ClearQuarantine 遞迴移除 root（檔案或資料夾）的 com.apple.quarantine（008 FR-15b）。
// 由瀏覽器啟動的小幫手寫入的檔案會被標記為「由瀏覽器下載」，Gatekeeper 會拒絕執行。
// 符號連結本身處理，不跟隨；個別項目失敗時略過。
func ClearQuarantine(root string) {
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err == nil {
			unix.Lremovexattr(p, "com.apple.quarantine")
		}
		return nil
	})
}
