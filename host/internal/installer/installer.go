// Package installer 實作 ytm-host --install、--uninstall（plan 4.9、008 FR-11 至 FR-15、FR-30）：
// 從本專案 GitHub 取得並檢查發佈清單、下載 yt-dlp、deno、ffmpeg 並核對 SHA256、解壓、放進安裝資料夾，
// 以及為 Chrome 與 Firefox 註冊小幫手。
package installer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
)

type Installer struct {
	Layout platform.Layout
	// Platform 是清單中的平台鍵（darwin-arm64、darwin-amd64、windows-amd64）。
	Platform string
	// Version 是這個小幫手的版本。
	Version string
	// SelfPath 是目前執行中的小幫手（os.Executable）。
	SelfPath string
	Fetcher  *release.Fetcher
	// ManifestAllow 檢查下載清單的網址（含每一次轉址）；預設 release.AllowedManifestURL，
	// 只允許本專案 GitHub 的 Release（008 SR-2）。測試可以替換成本機伺服器。
	ManifestAllow release.URLCheck
	// ManifestBase 是沒有指定 --manifest 時下載清單的位置（預設 release.LatestBase）。
	ManifestBase string
	// FindSystem 尋找安裝資料夾以外的工具（例如 Homebrew 的 ffmpeg）；找不到時回傳空字串。
	FindSystem func(tool string) string
	Out        io.Writer
}

// totalSteps 是 008 FR-11 的步驟數（下載小幫手、yt-dlp、deno、ffmpeg、註冊）。
const totalSteps = 5

func (in *Installer) step(n int, zh, en string) {
	fmt.Fprintf(in.Out, "\n[%d/%d] %s / %s\n", n, totalSteps, zh, en)
}

func (in *Installer) say(zh, en string) {
	fmt.Fprintf(in.Out, "      %s / %s\n", zh, en)
}

func (in *Installer) source(u string) {
	fmt.Fprintf(in.Out, "      來源 / Source: %s\n", u)
}

// PlatformKey 回傳 goos／goarch 對應的清單平台鍵；不支援時回傳空字串。
func PlatformKey(goos, goarch string) string {
	key := goos + "-" + goarch
	for _, p := range release.Platforms {
		if p == key {
			return key
		}
	}
	return ""
}

// LoadManifest 解析並嚴格檢查清單（格式、允許的網址、SHA256 格式）。manifest 為 nil 時
// 以 HTTPS 從本專案 GitHub 的 ManifestBase 下載（只接受本專案的 Release 與 GitHub 的轉址）。
// manifest 不為 nil 時是 --install --manifest 的檔案（引導腳本剛從同一個 Release 下載）。
func (in *Installer) LoadManifest(ctx context.Context, manifest []byte) (*release.Manifest, error) {
	if manifest == nil {
		base := in.ManifestBase
		if base == "" {
			base = release.LatestBase
		}
		allow := in.ManifestAllow
		if allow == nil {
			allow = release.AllowedManifestURL
		}
		in.source(base + release.ManifestName)
		var err error
		if manifest, err = in.Fetcher.WithAllow(allow).Get(ctx, base+release.ManifestName); err != nil {
			if errors.Is(err, release.ErrNotAllowed) {
				return nil, errs.New(errs.ManifestInvalid, "%v", err)
			}
			return nil, classify(err)
		}
	}
	m, err := release.ParseManifest(manifest, in.Fetcher.Allow)
	if err != nil {
		return nil, errs.New(errs.ManifestInvalid, "%v", err)
	}
	return m, nil
}

// Install 依 008 FR-11 安裝全部元件。manifest 為 nil 時從本專案 GitHub 下載最新的清單。
// 可以重複執行：已是最新的部分略過，其餘修復或更新（FR-13）。
func (in *Installer) Install(ctx context.Context, manifest []byte) error {
	if in.Platform == "" {
		return errs.New(errs.UnsupportedPlatform, "this computer is not supported")
	}
	fmt.Fprintf(in.Out, "安裝下載功能（%s）/ Installing the download helper (%s)\n", in.Platform, in.Platform)
	fmt.Fprintf(in.Out, "安裝位置 / Install folder: %s\n", in.Layout.InstallDir)
	m, err := in.LoadManifest(ctx, manifest)
	if err != nil {
		return err
	}
	in.say("發佈清單格式正確（版本 "+m.Version+"），每個檔案都會核對 SHA256", "Release list checked (version "+m.Version+"); every file is verified against its SHA256")
	if err := os.MkdirAll(in.Layout.BinDir, 0o755); err != nil {
		return classify(err)
	}
	CleanupOld(in.Layout.InstallDir, in.Layout.BinDir)
	state := LoadState(in.Layout.InstallDir)

	in.step(1, "小幫手（讓瀏覽器能使用下列工具）", "Helper (lets the browser use the tools below)")
	if _, err := in.InstallHelper(ctx, m); err != nil {
		return err
	}

	in.step(2, "yt-dlp（下載影片的開源工具）", "yt-dlp (open-source video downloader)")
	if err := in.installTool(ctx, m, release.ToolYtDlp, state); err != nil {
		return err
	}
	in.step(3, "deno（yt-dlp 需要的 JavaScript 執行環境）", "deno (JavaScript runtime that yt-dlp needs)")
	if err := in.installTool(ctx, m, release.ToolDeno, state); err != nil {
		return err
	}
	in.step(4, "ffmpeg 與 ffprobe（合併影音、轉 MP3）", "ffmpeg and ffprobe (merge video and audio, convert to MP3)")
	if err := in.installTool(ctx, m, release.ToolFFmpeg, state); err != nil {
		return err
	}

	in.step(5, "為 Chrome 與 Firefox（含 Zen）註冊小幫手", "Registering the helper for Chrome and Firefox (including Zen)")
	if err := in.register(); err != nil {
		return err
	}
	fmt.Fprintln(in.Out, "\n完成！回到瀏覽器即可下載 / Done! Go back to your browser to download.")
	return nil
}

func (in *Installer) register() error {
	done, err := Register(in.Layout)
	for _, p := range done {
		fmt.Fprintf(in.Out, "      %s\n", p)
	}
	if err != nil {
		return classify(err)
	}
	return nil
}

// InstallHelper 確認安裝資料夾中的小幫手與清單相同；不同時放入新版本：
// 目前執行的小幫手就是清單中的版本時直接複製自己，否則從清單的網址下載並核對 SHA256。
// 回傳是否有替換。
func (in *Installer) InstallHelper(ctx context.Context, m *release.Manifest) (bool, error) {
	want := m.Helper[in.Platform]
	if hashFile(in.Layout.HelperPath) == want.SHA256 {
		in.say("已是最新版本（"+m.Version+"），略過", "Already up to date ("+m.Version+"), skipped")
		return false, nil
	}
	if err := os.MkdirAll(in.Layout.InstallDir, 0o755); err != nil {
		return false, classify(err)
	}
	st, err := NewStaging(in.Layout.InstallDir)
	if err != nil {
		return false, classify(err)
	}
	defer st.Close()
	var src string
	if in.SelfPath != "" && hashFile(in.SelfPath) == want.SHA256 {
		in.say("使用剛才下載並核對過的小幫手", "Using the helper that was just downloaded and verified")
		src = filepath.Join(st.Dir, "helper")
		if err := copyFile(in.SelfPath, src, 0o755); err != nil {
			return false, classify(err)
		}
	} else {
		in.source(want.URL)
		if src, err = st.Fetch(ctx, in.Fetcher, want.URL, want.SHA256); err != nil {
			return false, err
		}
	}
	if err := os.Chmod(src, 0o755); err != nil {
		return false, classify(err)
	}
	clearQuarantine(in.Layout.GOOS, src)
	if err := ReplaceFile(src, in.Layout.HelperPath, in.Layout.GOOS); err != nil {
		return false, classify(err)
	}
	in.say("已安裝 "+m.Version+"（SHA256 相符）", "Installed "+m.Version+" (SHA256 verified)")
	return true, nil
}

// bundledPaths 回傳工具在安裝資料夾中的執行檔路徑。
func (in *Installer) bundledPaths(tool string) []string {
	var out []string
	for _, b := range release.Binaries(tool, in.Platform) {
		out = append(out, filepath.Join(in.Layout.BinDir, b))
	}
	return out
}

func allExist(paths []string) bool {
	for _, p := range paths {
		if st, err := os.Stat(p); err != nil || !st.Mode().IsRegular() {
			return false
		}
	}
	return true
}

func (in *Installer) installTool(ctx context.Context, m *release.Manifest, tool string, state *State) error {
	t := m.Tools[tool]
	version := t.VersionFor(in.Platform)
	bundled := in.bundledPaths(tool)
	have := allExist(bundled)
	switch {
	case tool == release.ToolYtDlp && have:
		// 已安裝的 yt-dlp 不覆蓋，之後由 yt-dlp -U 自己更新（plan 4.9）。
		in.say("已安裝，略過（之後由 yt-dlp 自己更新）", "Already installed, skipped (yt-dlp updates itself)")
		return nil
	case have && state.Tools[tool] == version:
		in.say("已是最新版本（"+version+"），略過", "Already up to date ("+version+"), skipped")
		return nil
	case tool == release.ToolFFmpeg && !have && in.FindSystem != nil:
		ff, fp := in.FindSystem("ffmpeg"), in.FindSystem("ffprobe")
		if ff != "" && fp != "" {
			in.say("這台電腦已經有 ffmpeg，沿用不另外下載", "ffmpeg is already on this computer; using it")
			fmt.Fprintf(in.Out, "      %s\n      %s\n", ff, fp)
			return nil
		}
	}
	_, err := InstallFiles(ctx, in.Fetcher, t.Platforms[in.Platform].Files, in.Layout.BinDir, in.Layout.GOOS, func(u string) {
		in.source(u)
		in.say("下載中…", "Downloading…")
	})
	if err != nil {
		return err
	}
	state.Tools[tool] = version
	if err := state.Save(in.Layout.InstallDir); err != nil {
		return classify(err)
	}
	in.say("已安裝 "+version+"（SHA256 相符）", "Installed "+version+" (SHA256 verified)")
	return nil
}

// InstallOffline 是手動安裝（--install --offline，008 FR-16）：只把自己放進安裝資料夾並註冊，
// 不下載任何工具，沿用系統上已有的 yt-dlp、ffmpeg、deno。
func (in *Installer) InstallOffline() error {
	fmt.Fprintf(in.Out, "手動安裝小幫手 / Installing the helper (manual install)\n")
	fmt.Fprintf(in.Out, "安裝位置 / Install folder: %s\n", in.Layout.InstallDir)
	if err := os.MkdirAll(in.Layout.InstallDir, 0o755); err != nil {
		return classify(err)
	}
	CleanupOld(in.Layout.InstallDir, in.Layout.BinDir)
	if in.SelfPath == "" {
		return errs.New(errs.Unknown, "could not find the running helper")
	}
	if !platform.SameFile(in.SelfPath, in.Layout.HelperPath) && hashFile(in.SelfPath) != hashFile(in.Layout.HelperPath) {
		st, err := NewStaging(in.Layout.InstallDir)
		if err != nil {
			return classify(err)
		}
		defer st.Close()
		src := filepath.Join(st.Dir, "helper")
		if err := copyFile(in.SelfPath, src, 0o755); err != nil {
			return classify(err)
		}
		clearQuarantine(in.Layout.GOOS, src)
		if err := ReplaceFile(src, in.Layout.HelperPath, in.Layout.GOOS); err != nil {
			return classify(err)
		}
	}
	fmt.Fprintf(in.Out, "小幫手 / Helper: %s (%s)\n", in.Layout.HelperPath, in.Version)
	fmt.Fprintln(in.Out, "註冊 / Registering:")
	if err := in.register(); err != nil {
		return err
	}
	var missing []string
	for _, tool := range []string{"yt-dlp", "ffmpeg", "ffprobe", "deno"} {
		p := ""
		if in.FindSystem != nil {
			p = in.FindSystem(tool)
		}
		if p == "" {
			for _, b := range []string{tool, tool + ".exe"} {
				if allExist([]string{filepath.Join(in.Layout.BinDir, b)}) {
					p = filepath.Join(in.Layout.BinDir, b)
				}
			}
		}
		if p == "" {
			fmt.Fprintf(in.Out, "找不到 / Missing: %s\n", tool)
			missing = append(missing, tool)
		} else {
			fmt.Fprintf(in.Out, "找到 / Found %s: %s\n", tool, p)
		}
	}
	if len(missing) > 0 {
		fmt.Fprintln(in.Out, "\n下載功能需要 yt-dlp、ffmpeg 與 deno。可以改用 README 的一行指令自動安裝，或自行安裝：")
		fmt.Fprintln(in.Out, "Downloads need yt-dlp, ffmpeg and deno. Use the one-line install command in the README, or install them yourself:")
		switch in.Layout.GOOS {
		case "darwin":
			fmt.Fprintln(in.Out, "\n    brew install yt-dlp ffmpeg deno")
		case "windows":
			fmt.Fprintln(in.Out, "\n    winget install yt-dlp.yt-dlp Gyan.FFmpeg DenoLand.Deno")
		}
	}
	fmt.Fprintln(in.Out, "\n完成。若瀏覽器開著，請重新啟動後在下載面板按「重新檢查」。")
	fmt.Fprintln(in.Out, "Done. Restart Chrome or Firefox if it was open, then click \"Check again\" in the extension's download panel.")
	return nil
}

// classify 把系統錯誤轉成固定的錯誤代碼。已經是 *errs.Error 的保持不變。
func classify(err error) error {
	if err == nil {
		return nil
	}
	var e *errs.Error
	if errors.As(err, &e) {
		return e
	}
	var he *release.HTTPError
	var ne net.Error
	var ue *url.Error
	switch {
	case errors.Is(err, release.ErrNotAllowed):
		// 轉址到允許範圍以外的網址：拒絕下載（plan 4.9 網路連線範圍）。
		return errs.New(errs.Network, "%v", err)
	case errors.Is(err, release.ErrTooLarge):
		return errs.New(errs.ChecksumMismatch, "%v", err)
	case errors.As(err, &he), errors.As(err, &ne), errors.As(err, &ue), errors.Is(err, io.ErrUnexpectedEOF):
		return errs.New(errs.Network, "%v", err)
	case errors.Is(err, syscall.ENOSPC) || strings.Contains(strings.ToLower(err.Error()), "not enough space"):
		return errs.New(errs.DiskFull, "%v", err)
	case errors.Is(err, os.ErrPermission):
		return errs.New(errs.PermissionDenied, "%v", err)
	}
	return errs.New(errs.Unknown, "%v", err)
}

// Explain 回傳給使用者看的中英文說明與解決方式（008 FR-14）。
func Explain(err error) (zh, en string) {
	switch errs.From(err).Code {
	case errs.ManifestInvalid:
		return "發佈清單格式不正確或不是來自本專案的 GitHub，沒有安裝任何東西。持續發生時請回報問題。",
			"The release list is invalid or not from this project's GitHub; nothing was installed. If this keeps happening, report an issue."
	case errs.ChecksumMismatch:
		return "下載的檔案與發佈清單中的 SHA-256 不符，已刪除該檔案。",
			"A downloaded file did not match the SHA-256 in the release list and was deleted."
	case errs.Network:
		return "無法連到下載來源。請確認網路連線，以及網路允許連到 GitHub。",
			"Could not reach the download site. Check your internet connection and that your network allows GitHub."
	case errs.DiskFull:
		return "磁碟空間不足，請先清出約 400 MB 的空間。", "Not enough disk space. Free up about 400 MB first."
	case errs.PermissionDenied:
		return "無法寫入使用者資料夾中的安裝位置。請不要用 sudo 或系統管理員身分執行。",
			"Could not write to the install folder in your user folder. Do not run this with sudo or as administrator."
	case errs.UnsupportedPlatform:
		return "這台電腦的系統或晶片不在支援範圍（支援 macOS Apple Silicon／Intel 與 Windows 10/11 x64）。",
			"This computer is not supported (supported: macOS on Apple Silicon or Intel, Windows 10/11 x64)."
	}
	return "安裝時發生錯誤。", "Something went wrong during installation."
}

// PrintFailure 印出失敗原因與「再執行一次」的說明。
func PrintFailure(w io.Writer, err error) {
	zh, en := Explain(err)
	fmt.Fprintf(w, "\n失敗 / Failed: %s\n                %s\n", zh, en)
	fmt.Fprintf(w, "原因 / Details: %s\n", errs.From(err).Error())
	fmt.Fprintln(w, "再執行一次同一個指令即可從這裡繼續。/ Run the same command again to continue from here.")
}
