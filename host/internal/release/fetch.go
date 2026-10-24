package release

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"
)

// 下載的上限。
const (
	// MaxSmallFile 是清單與檢查碼檔案的大小上限。
	MaxSmallFile = 1 << 20
	// MaxDownload 是單一工具檔案的大小上限（Windows 的 ffmpeg 壓縮檔約 190 MB）。
	MaxDownload = 600 << 20
	// DownloadTimeout 是單一檔案的時間上限。
	DownloadTimeout = 30 * time.Minute
)

// ErrNotAllowed 表示網址（或轉址目的地）不在允許的範圍內。
var ErrNotAllowed = errors.New("download location is not allowed")

// Fetcher 下載檔案，只連到 Allow 允許的網址（包括每一次轉址）。
type Fetcher struct {
	Client *http.Client
	Allow  URLCheck
	// UserAgent 只標明程式名稱與版本，不含任何識別資訊。
	UserAgent string
}

// NewFetcher 建立正式環境用的 Fetcher：只允許 AllowedURL，使用系統的 Proxy 設定。
func NewFetcher(version string) *Fetcher {
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   30 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
		IdleConnTimeout:       60 * time.Second,
		ForceAttemptHTTP2:     true,
	}
	return &Fetcher{Client: &http.Client{Transport: tr}, Allow: AllowedURL, UserAgent: "ytm-host/" + version}
}

// WithAllow 回傳只允許 allow 的網址的 Fetcher（共用同一個 HTTP client）。
func (f *Fetcher) WithAllow(allow URLCheck) *Fetcher {
	c := *f
	c.Allow = allow
	return &c
}

func (f *Fetcher) client() *http.Client {
	c := *f.Client
	allow := f.Allow
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		if !allow(req.URL) {
			return fmt.Errorf("%w: redirect to %s", ErrNotAllowed, req.URL.Host)
		}
		return nil
	}
	return &c
}

func (f *Fetcher) open(ctx context.Context, rawURL string) (*http.Response, error) {
	u, err := url.Parse(rawURL)
	if err != nil || !f.Allow(u) {
		return nil, fmt.Errorf("%w: %s", ErrNotAllowed, rawURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	if f.UserAgent != "" {
		req.Header.Set("User-Agent", f.UserAgent)
	}
	resp, err := f.client().Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, &HTTPError{URL: rawURL, Status: resp.StatusCode}
	}
	return resp, nil
}

// HTTPError 是伺服器回應的錯誤狀態碼。
type HTTPError struct {
	URL    string
	Status int
}

func (e *HTTPError) Error() string { return fmt.Sprintf("%s: HTTP %d", e.URL, e.Status) }

// ErrTooLarge 表示檔案超過大小上限。
var ErrTooLarge = errors.New("the file is larger than expected")

// Get 下載小檔案（清單、檢查碼），最多 MaxSmallFile 位元組。
func (f *Fetcher) Get(ctx context.Context, rawURL string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	resp, err := f.open(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, MaxSmallFile+1))
	if err != nil {
		return nil, err
	}
	if len(b) > MaxSmallFile {
		return nil, ErrTooLarge
	}
	return b, nil
}

// DownloadFile 把 rawURL 下載到 dest（建立新檔案），回傳 SHA256。超過 MaxDownload 時失敗。
// 失敗時刪除 dest。
func (f *Fetcher) DownloadFile(ctx context.Context, rawURL, dest string) (string, int64, error) {
	ctx, cancel := context.WithTimeout(ctx, DownloadTimeout)
	defer cancel()
	resp, err := f.open(ctx, rawURL)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.ContentLength > MaxDownload {
		return "", 0, ErrTooLarge
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", 0, err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, h), io.LimitReader(resp.Body, MaxDownload+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil && n > MaxDownload {
		err = ErrTooLarge
	}
	if err != nil {
		os.Remove(dest)
		return "", n, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}
