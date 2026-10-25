package installer

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
)

// maxExtracted 是從壓縮檔取出的單一檔案大小上限（Windows 的 ffmpeg.exe 約 190 MB）。
const maxExtracted = 1 << 30

// 整個解壓（ExtractTree）的上限：yt-dlp_macos.zip 有 162 個項目，解壓後約 129 MB。
const (
	maxTreeEntries = 5000
	maxTreeBytes   = 1 << 30
	maxLinkTarget  = 1024
)

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

// close 刪除暫存資料夾。
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
			if _, err := extractFile(zf, filepath.Join(outDir, want), 0o755, maxExtracted); err != nil {
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

// extractFile 把 zf 寫到 dest（建立新檔案），最多 limit 位元組，回傳寫入的大小。
func extractFile(zf *zip.File, dest string, perm os.FileMode, limit int64) (int64, error) {
	rc, err := zf.Open()
	if err != nil {
		return 0, errs.New(errs.ChecksumMismatch, "could not read %s from the archive: %v", zf.Name, err)
	}
	defer rc.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, perm)
	if err != nil {
		return 0, classify(err)
	}
	n, err := io.Copy(out, io.LimitReader(rc, limit+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil && n > limit {
		err = errs.New(errs.Unknown, "%s in the archive is too large", zf.Name)
	}
	if err != nil {
		os.Remove(dest)
		return n, classify(err)
	}
	return n, nil
}

// unsafeChars 不得出現在 ExtractTree 的路徑與符號連結目標中。
const unsafeChars = "\\:\x00"

// treePath 回傳壓縮檔中的項目在解壓資料夾中的相對路徑（以 / 分隔，去掉資料夾結尾的 /）。
// 絕對路徑、..、多餘的 . 或 /、反斜線與磁碟代號一律視為不安全。
func treePath(name string) (string, bool) {
	n := strings.TrimSuffix(name, "/")
	if n == "" || strings.ContainsAny(n, unsafeChars) || strings.HasPrefix(n, "/") || path.Clean(n) != n ||
		n == "." || n == ".." || strings.HasPrefix(n, "../") {
		return "", false
	}
	return n, true
}

// ExtractTree 把 zipPath 整個解壓到 dest（必須還不存在），保留資料夾結構、執行權限與符號連結
// （008 FR-15a：yt-dlp_macos.zip 的 _internal/ 與其中的 Python.framework）。
// 有任何不安全的項目（路徑穿越、指向 dest 以外或位於另一個符號連結之下的符號連結、不支援的檔案類型）
// 時整個解壓失敗，由呼叫端刪除 dest。
func ExtractTree(zipPath, dest string) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return errs.New(errs.ChecksumMismatch, "not a valid zip file: %v", err)
	}
	defer zr.Close()
	if len(zr.File) > maxTreeEntries {
		return errs.New(errs.Unknown, "the archive has too many entries")
	}
	if err := os.Mkdir(dest, 0o755); err != nil {
		return classify(err)
	}
	// 先建立資料夾與檔案，最後才建立符號連結，寫入檔案時路徑中不會有符號連結。
	var links []*zip.File
	remaining := int64(maxTreeBytes)
	for _, zf := range zr.File {
		rel, ok := treePath(zf.Name)
		if !ok {
			return errs.New(errs.Unknown, "unsafe path in the archive: %q", zf.Name)
		}
		target := filepath.Join(dest, filepath.FromSlash(rel))
		mode := zf.Mode()
		switch {
		case mode&os.ModeSymlink != 0:
			links = append(links, zf)
		case mode.IsDir():
			if err := os.MkdirAll(target, 0o755); err != nil {
				return classify(err)
			}
		case mode.IsRegular():
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return classify(err)
			}
			perm := os.FileMode(0o644)
			if mode&0o111 != 0 {
				perm = 0o755
			}
			n, err := extractFile(zf, target, perm, min(remaining, maxExtracted))
			if err != nil {
				return err
			}
			remaining -= n
		default:
			return errs.New(errs.Unknown, "unsupported entry in the archive: %q", zf.Name)
		}
	}
	for _, zf := range links {
		if err := extractLink(zf, dest); err != nil {
			return err
		}
	}
	return nil
}

// extractLink 建立符號連結。目標必須是相對路徑且解析後仍在 dest 之中；
// 連結所在的每一層都必須是實際的資料夾（不能經過另一個符號連結）。
func extractLink(zf *zip.File, dest string) error {
	rel, _ := treePath(zf.Name)
	rc, err := zf.Open()
	if err != nil {
		return errs.New(errs.ChecksumMismatch, "could not read %s from the archive: %v", zf.Name, err)
	}
	b, err := io.ReadAll(io.LimitReader(rc, maxLinkTarget+1))
	rc.Close()
	if err != nil {
		return errs.New(errs.ChecksumMismatch, "could not read %s from the archive: %v", zf.Name, err)
	}
	link := string(b)
	resolved := path.Join(path.Dir(rel), link)
	if len(b) > maxLinkTarget || link == "" || strings.HasPrefix(link, "/") || strings.ContainsAny(link, unsafeChars) ||
		resolved == ".." || strings.HasPrefix(resolved, "../") {
		return errs.New(errs.Unknown, "symbolic link %q points outside the folder", zf.Name)
	}
	dir := dest
	if parent := path.Dir(rel); parent != "." {
		for _, part := range strings.Split(parent, "/") {
			dir = filepath.Join(dir, part)
			if st, err := os.Lstat(dir); err != nil || !st.IsDir() {
				return errs.New(errs.Unknown, "symbolic link %q is not inside a real folder", zf.Name)
			}
		}
	}
	if err := os.Symlink(link, filepath.Join(dest, filepath.FromSlash(rel))); err != nil {
		return classify(err)
	}
	return nil
}

// InstallFiles 下載 files、核對 SHA256、解壓，全部成功後才把執行檔放進 binDir
// （先放在暫存資料夾，最後逐一改名）。回傳安裝的執行檔路徑。任何一步失敗時 binDir 不變。
func InstallFiles(ctx context.Context, f *release.Fetcher, files []release.File, binDir, goos string) ([]string, error) {
	p, err := prepareFiles(ctx, f, files, binDir, goos, "", nil)
	if err != nil {
		return nil, err
	}
	defer p.close()
	return p.commit()
}

// stagedFiles 是已下載、核對、解壓並設定執行權限，放在 binDir 中暫存資料夾的執行檔。
type stagedFiles struct {
	st           *Staging
	out          string
	names        []string
	binDir, goos string
	// unpacked 不為空字串時，壓縮檔整個解壓成資料夾 names[0]，其中的執行檔為 unpacked
	// （release.UnpackedExe：macOS 的 yt-dlp）。
	unpacked string
}

// prepareFiles 是 InstallFiles 放進 binDir 之前的步驟；binDir 不變。每個檔案下載、核對、解壓後
// 呼叫 fileReady（可為 nil）。用完後必須呼叫 close。
func prepareFiles(ctx context.Context, f *release.Fetcher, files []release.File, binDir, goos, unpacked string, fileReady func()) (*stagedFiles, error) {
	st, err := NewStaging(binDir)
	if err != nil {
		return nil, classify(err)
	}
	p := &stagedFiles{st: st, out: filepath.Join(st.Dir, "out"), binDir: binDir, goos: goos, unpacked: unpacked}
	if err := p.prepare(ctx, f, files, fileReady); err != nil {
		st.Close()
		return nil, err
	}
	return p, nil
}

func (p *stagedFiles) prepare(ctx context.Context, f *release.Fetcher, files []release.File, fileReady func()) error {
	if err := os.Mkdir(p.out, 0o755); err != nil {
		return classify(err)
	}
	for _, file := range files {
		dl, err := p.st.Fetch(ctx, f, file.URL, file.SHA256)
		if err != nil {
			return err
		}
		switch {
		case file.Archive == "":
			if err := os.Rename(dl, filepath.Join(p.out, file.Name)); err != nil {
				return classify(err)
			}
		case file.Archive == "zip" && p.unpacked != "":
			if err := ExtractTree(dl, filepath.Join(p.out, file.Extract[0])); err != nil {
				return err
			}
			os.Remove(dl)
		case file.Archive == "zip":
			if err := ExtractZip(dl, p.out, file.Extract); err != nil {
				return err
			}
			os.Remove(dl)
		default:
			return errs.New(errs.Unknown, "unsupported archive %q", file.Archive)
		}
		p.names = append(p.names, file.Produces()...)
		if fileReady != nil {
			fileReady()
		}
	}
	for _, name := range p.names {
		src := filepath.Join(p.out, name)
		exe := src
		if p.unpacked != "" {
			exe = filepath.Join(src, p.unpacked)
			if st, err := os.Lstat(exe); err != nil || !st.Mode().IsRegular() {
				return errs.New(errs.Unknown, "the archive does not contain %s", p.unpacked)
			}
		}
		if err := os.Chmod(exe, 0o755); err != nil {
			return classify(err)
		}
		clearQuarantine(p.goos, src)
	}
	return nil
}

// commit 把執行檔（或整個資料夾）逐一改名放進 binDir，回傳安裝的路徑。
func (p *stagedFiles) commit() ([]string, error) {
	var installed []string
	for _, name := range p.names {
		src, dest := filepath.Join(p.out, name), filepath.Join(p.binDir, name)
		var err error
		if p.unpacked != "" {
			err = ReplaceDir(src, dest)
		} else {
			err = ReplaceFile(src, dest, p.goos)
		}
		if err != nil {
			return nil, classify(err)
		}
		installed = append(installed, dest)
	}
	return installed, nil
}

// close 刪除暫存資料夾。
func (p *stagedFiles) close() { p.st.Close() }

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

// ReplaceDir 以資料夾 src 取代 dest。dest 可以是舊的資料夾，或從舊版升級時的單一執行檔
// （v0.1.0 的 bin/yt-dlp）：先把 dest 改名為 dest.old-<隨機>，放入 src 後刪除舊的；
// 失敗時改回原本的名稱。刪除失敗時留給 CleanupOld。
func ReplaceDir(src, dest string) error {
	old := ""
	if _, err := os.Lstat(dest); err == nil {
		old = fmt.Sprintf("%s.old-%s", dest, randomSuffix())
		if err := os.Rename(dest, old); err != nil {
			return err
		}
	}
	if err := os.Rename(src, dest); err != nil {
		if old != "" {
			os.Rename(old, dest)
		}
		return err
	}
	if old != "" {
		os.RemoveAll(old)
	}
	return nil
}

// CleanupOld 刪除 dir 中替換時留下的 *.old、*.old-*（檔案或資料夾）與中斷的 .download-* 暫存資料夾。
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
				os.RemoveAll(filepath.Join(dir, n))
			case strings.HasPrefix(n, ".download-") && e.IsDir():
				if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > time.Hour {
					os.RemoveAll(filepath.Join(dir, n))
				}
			}
		}
	}
}

// removeQuarantine 遞迴移除隔離屬性；測試可以替換成記錄呼叫的函式。
var removeQuarantine = platform.ClearQuarantine

// clearQuarantine 在 macOS 上遞迴移除 p（檔案或資料夾）的隔離屬性（008 FR-15b）：
// 由瀏覽器啟動的小幫手（自動更新）寫入的檔案會帶有這個屬性。失敗不影響安裝。
func clearQuarantine(goos, p string) {
	if goos == "darwin" {
		removeQuarantine(p)
	}
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
