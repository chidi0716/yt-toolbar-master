package release

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
)

// Lock 是 release/components.lock.json：固定的第三方工具版本、下載網址、SHA256，
// 以及官方公布檢查碼的網址（plan 4.9）。發佈流程依它產生 components.json。
type Lock struct {
	Schema int             `json:"schema"`
	Tools  map[string]Tool `json:"tools"`
}

// ParseLock 解析並驗證 lock 檔。
func ParseLock(data []byte) (*Lock, error) {
	var l Lock
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&l); err != nil {
		return nil, invalid("lock: %v", err)
	}
	if l.Schema != SchemaVersion {
		return nil, invalid("lock: unsupported schema %d", l.Schema)
	}
	if err := validateTools(l.Tools, AllowedURL, true); err != nil {
		return nil, err
	}
	return &l, nil
}

// uniqueFiles 回傳 lock 中所有不重複的檔案（同一個網址會用在多個平台，例如 yt-dlp_macos）。
func (l *Lock) uniqueFiles() []File {
	seen := map[string]bool{}
	var out []File
	for _, name := range ToolNames {
		t := l.Tools[name]
		for _, p := range Platforms {
			for _, f := range t.Platforms[p].Files {
				if seen[f.URL] {
					continue
				}
				seen[f.URL] = true
				out = append(out, f)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].URL < out[j].URL })
	return out
}

type Logf func(format string, a ...any)

// VerifyOnline 對 lock 中的每個檔案：下載官方的檢查碼檔案，確認與 lock 記錄的 SHA256 相同；
// download 為 true 時也下載檔案本身並計算 SHA256（發佈流程使用）。
func (l *Lock) VerifyOnline(ctx context.Context, f *Fetcher, download bool, tmpDir string, logf Logf) error {
	checksumFiles := map[string]string{}
	for _, file := range l.uniqueFiles() {
		u, _ := url.Parse(file.URL)
		name := path.Base(u.Path)
		text, ok := checksumFiles[file.Checksums]
		if !ok {
			b, err := f.Get(ctx, file.Checksums)
			if err != nil {
				return fmt.Errorf("checksum file for %s: %w", name, err)
			}
			text = string(b)
			checksumFiles[file.Checksums] = text
		}
		official, err := ParseChecksums(text, name)
		if err != nil {
			return fmt.Errorf("%s: %w (%s)", name, err, file.Checksums)
		}
		if official != file.SHA256 {
			return fmt.Errorf("%s: the lock file says %s but the official checksum is %s", name, file.SHA256, official)
		}
		logf("ok  %s matches the official checksum", file.URL)
		if !download {
			continue
		}
		dest := filepath.Join(tmpDir, fmt.Sprintf("lock-check-%s", HashBytes([]byte(file.URL))[:16]))
		sum, n, err := f.DownloadFile(ctx, file.URL, dest)
		os.Remove(dest)
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		if sum != file.SHA256 {
			return fmt.Errorf("%s: downloaded file has SHA256 %s, expected %s", name, sum, file.SHA256)
		}
		logf("ok  %s downloaded (%d bytes) and verified", name, n)
	}
	return nil
}

// BuildManifest 由 lock 與建置好的小幫手產生 components.json 的內容。
// helperDir 中必須有三種小幫手（HelperFileName），tag 是版本標籤（例如 v0.2.0）。
func BuildManifest(l *Lock, version, tag, helperDir string) (*Manifest, error) {
	if _, ok := ParseVersion(version); !ok {
		return nil, fmt.Errorf("version %q is not x.y.z", version)
	}
	if tag != "v"+version {
		return nil, fmt.Errorf("tag %q does not match version %q", tag, version)
	}
	m := &Manifest{Schema: SchemaVersion, Version: version, Helper: map[string]Asset{}, Tools: map[string]Tool{}}
	for _, p := range Platforms {
		name := HelperFileName(p)
		fh, err := os.Open(filepath.Join(helperDir, name))
		if err != nil {
			return nil, fmt.Errorf("helper %s: %w", name, err)
		}
		sum, _, err := HashReader(fh)
		fh.Close()
		if err != nil {
			return nil, err
		}
		m.Helper[p] = Asset{URL: ProjectDownloadURL(tag, name), SHA256: sum}
	}
	for name, t := range l.Tools {
		nt := Tool{Version: t.Version, Platforms: map[string]Platform{}}
		for p, pl := range t.Platforms {
			np := Platform{Version: pl.Version}
			for _, f := range pl.Files {
				f.Checksums = ""
				np.Files = append(np.Files, f)
			}
			nt.Platforms[p] = np
		}
		m.Tools[name] = nt
	}
	if err := m.Validate(AllowedURL); err != nil {
		return nil, err
	}
	return m, nil
}

// ReadAllLimited 讀取最多 limit 位元組。
func ReadAllLimited(r io.Reader, limit int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, ErrTooLarge
	}
	return b, nil
}
