package platform

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// IsFile 回傳 p 是否是一般檔案（會跟隨符號連結）。
func IsFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.Mode().IsRegular()
}

// WriteFileAtomic 以「寫暫存檔再改名」的方式寫入 path，讀取端不會讀到寫一半的檔案。
// 暫存檔在同一個資料夾中。Windows 上目標檔案正被讀取時改名會暫時失敗，稍等再試。
func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, err = f.Write(data)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp, perm)
	}
	if err == nil {
		for i := 0; ; i++ {
			err = os.Rename(tmp, path)
			if err == nil || runtime.GOOS != "windows" || i >= 20 {
				break
			}
			time.Sleep(25 * time.Millisecond)
		}
	}
	if err != nil {
		os.Remove(tmp)
	}
	return err
}

// WriteJSONAtomic 以 WriteFileAtomic 寫入縮排的 JSON（結尾換行）。
func WriteJSONAtomic(path string, v any, perm os.FileMode) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(path, append(b, '\n'), perm)
}
