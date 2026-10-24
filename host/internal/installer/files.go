package installer

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
)

// maxExtracted 是從壓縮檔取出的單一檔案大小上限（Windows 的 ffmpeg.exe 約 190 MB）。
const maxExtracted = 1 << 30

func randomSuffix() string {
	var b [6]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// Staging 是下載用的暫存資料夾：<dir>/.download-<隨機>（plan 4.9）。
// 放在目的資料夾之中，最後的改名才會在同一個磁碟區內、是原子操作。
type Staging struct {
	Dir string
}

// NewStaging 在 parent 中建立暫存資料夾。
func NewStaging(parent string) (*Staging, error) {
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return nil, err
	}
	dir := filepath.Join(parent, ".download-"+randomSuffix())
	if err := os.Mkdir(dir, 0o700); err != nil {
		return nil, err
	}
	return &Staging{Dir: dir}, nil
}

// Close 刪除暫存資料夾。
func (s *Staging) Close() { os.RemoveAll(s.Dir) }

// Fetch 下載 url 到暫存資料夾並核對 SHA256；不符時刪除檔案並回傳 CHECKSUM_MISMATCH。
func (s *Staging) Fetch(ctx context.Context, f *release.Fetcher, url, sha256 string) (string, error) {
	dest := filepath.Join(s.Dir, "dl-"+randomSuffix())
	sum, _, err := f.DownloadFile(ctx, url, dest)
	if err != nil {
		return "", classify(err)
	}
	if sum != sha256 {
		os.Remove(dest)
		return "", errs.New(errs.ChecksumMismatch, "%s: SHA256 is %s, expected %s", url, sum, sha256)
	}
	return dest, nil
}

// safeZipPath 回傳壓縮檔中的路徑是否安全（不是絕對路徑、不含 ..、不含磁碟代號）。
// 不安全的項目一律略過，不會被取出（防止路徑穿越）。
func safeZipPath(name string) bool {
	n := strings.ReplaceAll(name, `\`, "/")
	if n == "" || strings.HasPrefix(n, "/") || strings.Contains(n, ":") {
		return false
	}
	for _, part := range strings.Split(n, "/") {
		if part == ".." {
			return false
		}
	}
	return true
}

// ExtractZip 從 zipPath 中取出 names 列出的檔案到 outDir（只比對檔名，不分大小寫；
// 寫入的檔名一律是 names 中的名稱，不使用壓縮檔中的路徑）。找不到任何一個檔案時回傳錯誤。
func ExtractZip(zipPath, outDir string, names []string) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return errs.New(errs.ChecksumMismatch, "not a valid zip file: %v", err)
	}
	defer zr.Close()
	found := map[string]bool{}
	for _, zf := range zr.File {
		if !safeZipPath(zf.Name) || !zf.Mode().IsRegular() {
			continue
		}
		base := path.Base(strings.ReplaceAll(zf.Name, `\`, "/"))
		for _, want := range names {
			if found[want] || !strings.EqualFold(base, want) {
				continue
			}
			if zf.UncompressedSize64 > maxExtracted {
				return errs.New(errs.Unknown, "%s in the archive is too large", want)
			}
			if err := extractOne(zf, filepath.Join(outDir, want)); err != nil {
				return err
			}
			found[want] = true
		}
	}
	for _, want := range names {
		if !found[want] {
			return errs.New(errs.Unknown, "the archive does not contain %s", want)
		}
	}
	return nil
}

func extractOne(zf *zip.File, dest string) error {
	rc, err := zf.Open()
	if err != nil {
		return errs.New(errs.ChecksumMismatch, "could not read %s from the archive: %v", zf.Name, err)
	}
	defer rc.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
	if err != nil {
		return classify(err)
	}
	n, err := io.Copy(out, io.LimitReader(rc, maxExtracted+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil && n > maxExtracted {
		err = errs.New(errs.Unknown, "%s in the archive is too large", zf.Name)
	}
	if err != nil {
		os.Remove(dest)
		return classify(err)
	}
	return nil
}

// InstallFiles 下載 files、核對 SHA256、解壓，全部成功後才把執行檔放進 binDir
// （先放在暫存資料夾，最後逐一改名）。回傳安裝的執行檔路徑。任何一步失敗時 binDir 不變。
func InstallFiles(ctx context.Context, f *release.Fetcher, files []release.File, binDir, goos string, report func(url string)) ([]string, error) {
	st, err := NewStaging(binDir)
	if err != nil {
		return nil, classify(err)
	}
	defer st.Close()
	out := filepath.Join(st.Dir, "out")
	if err := os.Mkdir(out, 0o755); err != nil {
		return nil, classify(err)
	}
	var produced []string
	for _, file := range files {
		if report != nil {
			report(file.URL)
		}
		p, err := st.Fetch(ctx, f, file.URL, file.SHA256)
		if err != nil {
			return nil, err
		}
		switch file.Archive {
		case "":
			if err := os.Rename(p, filepath.Join(out, file.Name)); err != nil {
				return nil, classify(err)
			}
		case "zip":
			if err := ExtractZip(p, out, file.Extract); err != nil {
				return nil, err
			}
			os.Remove(p)
		default:
			return nil, errs.New(errs.Unknown, "unsupported archive %q", file.Archive)
		}
		produced = append(produced, file.Produces()...)
	}
	var installed []string
	for _, name := range produced {
		src := filepath.Join(out, name)
		if err := os.Chmod(src, 0o755); err != nil {
			return nil, classify(err)
		}
		clearQuarantine(goos, src)
		dest := filepath.Join(binDir, name)
		if err := ReplaceFile(src, dest, goos); err != nil {
			return nil, classify(err)
		}
		installed = append(installed, dest)
	}
	return installed, nil
}

// ReplaceFile 以 src 取代 dest。Windows 無法覆蓋執行中的檔案，但可以改名，
// 所以先把 dest 改名為 dest.old（plan 4.9），再放入新檔；.old 由 CleanupOld 在之後刪除。
func ReplaceFile(src, dest, goos string) error {
	if goos != "windows" {
		return os.Rename(src, dest)
	}
	old := ""
	if _, err := os.Lstat(dest); err == nil {
		old = dest + ".old"
		os.Remove(old)
		if err := os.Rename(dest, old); err != nil {
			// 舊的 .old 還在執行時無法刪除：改用另一個名稱。
			old = fmt.Sprintf("%s.old-%s", dest, randomSuffix())
			if err := os.Rename(dest, old); err != nil {
				return err
			}
		}
	}
	if err := os.Rename(src, dest); err != nil {
		if old != "" {
			os.Rename(old, dest)
		}
		return err
	}
	return nil
}

// CleanupOld 刪除 dir 中替換時留下的 *.old、*.old-* 與中斷的 .download-* 暫存資料夾。
// 仍在執行中的檔案（Windows）會刪除失敗，留到下次。
func CleanupOld(dirs ...string) {
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			n := e.Name()
			switch {
			case strings.HasSuffix(n, ".old") || strings.Contains(n, ".old-"):
				os.Remove(filepath.Join(dir, n))
			case strings.HasPrefix(n, ".download-") && e.IsDir():
				if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > time.Hour {
					os.RemoveAll(filepath.Join(dir, n))
				}
			}
		}
	}
}

// clearQuarantine 移除 macOS 的隔離屬性（plan 4.9）。失敗不影響安裝（小幫手以 Go 下載的檔案沒有這個屬性）。
func clearQuarantine(goos, p string) {
	if goos != "darwin" {
		return
	}
	if _, err := os.Stat("/usr/bin/xattr"); err != nil {
		return
	}
	exec.Command("/usr/bin/xattr", "-d", "com.apple.quarantine", p).Run()
}

// copyFile 把 src 複製到 dest（建立新檔案）。
func copyFile(src, dest string, perm os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, perm)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(dest)
	}
	return err
}

// hashFile 回傳檔案的 SHA256；檔案不存在時回傳空字串。
func hashFile(p string) string {
	f, err := os.Open(p)
	if err != nil {
		return ""
	}
	defer f.Close()
	sum, _, err := release.HashReader(f)
	if err != nil {
		return ""
	}
	return sum
}
