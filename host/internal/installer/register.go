package installer

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
)

// nativeManifest 是原生訊息設定檔（內容與 install/manifests/ 的範本相同，測試會比對）。
type nativeManifest struct {
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	Path              string   `json:"path"`
	Type              string   `json:"type"`
	AllowedOrigins    []string `json:"allowed_origins,omitempty"`
	AllowedExtensions []string `json:"allowed_extensions,omitempty"`
}

const manifestDescription = "YT Toolbar Master download helper (runs yt-dlp and ffmpeg on this computer)"

// ManifestContent 回傳某個瀏覽器的原生訊息設定檔內容。
func ManifestContent(browser, helperPath string) ([]byte, error) {
	m := nativeManifest{Name: platform.NativeHostName, Description: manifestDescription, Path: helperPath, Type: "stdio"}
	if browser == "chrome" {
		m.AllowedOrigins = []string{platform.ChromeOrigin}
	} else {
		m.AllowedExtensions = []string{platform.FirefoxID}
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

// Register 為 Chrome 與 Firefox（含 Zen）註冊小幫手：寫入原生訊息設定檔，
// Windows 另外在 HKCU 建立登錄機碼（plan 4.8）。回傳寫入的位置。
func Register(l platform.Layout) ([]string, error) {
	var done []string
	for _, loc := range l.Manifests {
		content, err := ManifestContent(loc.Browser, l.HelperPath)
		if err != nil {
			return done, err
		}
		if err := os.MkdirAll(filepath.Dir(loc.Path), 0o755); err != nil {
			return done, err
		}
		if err := platform.WriteFileAtomic(loc.Path, content, 0o644); err != nil {
			return done, err
		}
		done = append(done, loc.Path)
		if loc.RegistryKey != "" && l.GOOS == "windows" {
			if err := platform.SetRegistryDefault(loc.RegistryKey, loc.Path); err != nil {
				return done, err
			}
			done = append(done, `HKCU\`+loc.RegistryKey)
		}
	}
	return done, nil
}

// Unregister 刪除原生訊息設定檔與登錄機碼。不存在的項目略過。
func Unregister(l platform.Layout) ([]string, error) {
	var removed []string
	var firstErr error
	for _, loc := range l.Manifests {
		if loc.RegistryKey != "" && l.GOOS == "windows" {
			if v, _ := platform.RegistryDefault(loc.RegistryKey); v != "" {
				removed = append(removed, `HKCU\`+loc.RegistryKey)
			}
			if err := platform.DeleteRegistryKey(loc.RegistryKey); err != nil && firstErr == nil {
				firstErr = err
			}
		}
		if err := os.Remove(loc.Path); err == nil {
			removed = append(removed, loc.Path)
		} else if !os.IsNotExist(err) && firstErr == nil {
			firstErr = err
		}
	}
	return removed, firstErr
}
