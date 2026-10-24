// Package app 把各套件組合成 commands.Backend：指令的實際執行者。
package app

import (
	"context"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/jobs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/protocol"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
	"github.com/chidi0716/yt-toolbar-master/host/internal/updater"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
	"github.com/chidi0716/yt-toolbar-master/host/internal/ytdlp"
)

// App 實作 commands.Backend。
type App struct {
	Version string
	Env     ytdlp.Env
	Manager *jobs.Manager
	Actions *platform.Actions
	// Layout 是安裝資料夾等位置；InstallDir 為空時使用目前使用者的位置。
	Layout platform.Layout
	// SelfPath 是目前執行中的小幫手（status 的 helper 元件）。
	SelfPath string
	// SpawnSelf 以脫離的方式啟動小幫手自己（--update、--uninstall），回傳 PID。
	SpawnSelf func(args ...string) (int, error)
	// Now 可在測試中替換。
	Now func() time.Time
	Log Logger

	updateMu sync.Mutex
	versions versionCache

	// infoSem 限制同時執行的 getInfo 數量。
	infoOnce sync.Once
	infoSem  chan struct{}
}

// Logger 是記錄檔介面。
type Logger interface {
	Printf(format string, a ...any)
}

func New(version string, m *jobs.Manager) *App {
	self, _ := os.Executable()
	return &App{
		Version: version, Env: ytdlp.SystemEnv(), Manager: m, Actions: platform.NewActions(),
		Layout: platform.CurrentLayout(), SelfPath: self,
		SpawnSelf: func(args ...string) (int, error) {
			exe, err := os.Executable()
			if err != nil {
				return 0, err
			}
			return jobs.SpawnDetached(exe, args...)
		},
	}
}

func (a *App) layout() platform.Layout {
	if a.Layout.InstallDir == "" {
		return platform.CurrentLayout()
	}
	return a.Layout
}

func (a *App) now() time.Time {
	if a.Now != nil {
		return a.Now()
	}
	return time.Now()
}

func (a *App) logf(format string, args ...any) {
	if a.Log != nil {
		a.Log.Printf(format, args...)
	}
}

// tools 每次重新尋找 yt-dlp 與 ffmpeg，讓使用者安裝後按「重新檢查」就能生效。
func (a *App) tools() *ytdlp.Tools { return ytdlp.Locate(a.Env) }

// PresetInfo 是檔名格式（給設定頁顯示）。
type PresetInfo struct {
	ID      string `json:"id"`
	Example string `json:"example"`
}

// StatusResult 是 status 指令的結果（plan 4.3、4.9）。
type StatusResult struct {
	HostVersion string `json:"hostVersion"`
	// Ready：yt-dlp 與 ffmpeg 都可以使用（可以下載）。
	Ready bool `json:"ready"`
	// Complete：另外 deno 也可以使用（yt-dlp 能取得 YouTube 的完整格式）。
	Complete    bool         `json:"complete"`
	Components  []Component  `json:"components"`
	DefaultDir  string       `json:"defaultDir"`
	NamePresets []PresetInfo `json:"namePresets"`
	Update      updater.View `json:"update"`
}

// Component 是 status 中的一個元件（008 FR-24），依序為 helper、yt-dlp、deno、ffmpeg、ffprobe。
// Source 為 "bundled"（安裝資料夾）、"homebrew"、"winget" 或 "path"；找不到時 found 為 false，
// 其他欄位為空字串。Error 是找到但無法執行時的錯誤代碼。
type Component struct {
	Name    string `json:"name"`
	Found   bool   `json:"found"`
	Version string `json:"version"`
	Path    string `json:"path"`
	Source  string `json:"source"`
	Error   string `json:"error"`
}

func (c *Component) usable() bool { return c.Found && c.Error == "" }

// Status 實作 status 指令。找不到工具不算錯誤，以 found=false 表示。
func (a *App) Status(ctx context.Context) (any, error) {
	t := a.tools()
	l := a.layout()
	res := &StatusResult{
		HostVersion: a.Version,
		DefaultDir:  platform.DefaultDownloadDir(),
		Update:      updater.ViewOf(l.InstallDir),
	}
	for _, p := range validate.NamePresets {
		res.NamePresets = append(res.NamePresets, PresetInfo{ID: p.ID, Example: p.Example})
	}
	helper := Component{Name: "helper", Version: a.Version, Path: a.SelfPath, Source: "path", Found: a.SelfPath != ""}
	if a.SelfPath != "" && platform.SameFile(a.SelfPath, l.HelperPath) {
		helper.Source = "bundled"
	}
	tools := []struct {
		name, path string
		version    func(context.Context) (string, error)
	}{
		{"yt-dlp", t.YtDlp, t.YtDlpVersion},
		{"deno", t.Deno, t.DenoVersion},
		{"ffmpeg", t.FFmpeg, t.FFmpegVersion},
		{"ffprobe", t.FFprobe, t.FFprobeVersion},
	}
	res.Components = make([]Component, 1+len(tools))
	res.Components[0] = helper
	a.versions.sync(l.InstallDir)
	var wg sync.WaitGroup
	for i, tool := range tools {
		c := &res.Components[i+1]
		c.Name = tool.name
		if tool.path == "" {
			continue
		}
		c.Found, c.Path, c.Source = true, tool.path, a.Env.Source(tool.path)
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, err := a.versions.version(ctx, tool.path, tool.version)
			c.Version = v
			if err != nil {
				c.Error = string(errs.From(err).Code)
			}
		}()
	}
	wg.Wait()
	ytDlp, deno, ffmpeg := res.Components[1], res.Components[2], res.Components[3]
	res.Ready = ytDlp.usable() && ffmpeg.usable()
	res.Complete = res.Ready && deno.usable()
	return res, nil
}

// maxInfoResult 是 getInfo 結果的大小上限，比 1MB 的訊息上限略小，保留外層欄位的空間。
const maxInfoResult = protocol.MaxOutgoing - 4096

// GetInfo 實作 getInfo 指令。
func (a *App) GetInfo(ctx context.Context, videoID string) (any, error) {
	a.infoOnce.Do(func() { a.infoSem = make(chan struct{}, 3) })
	select {
	case a.infoSem <- struct{}{}:
		defer func() { <-a.infoSem }()
	case <-ctx.Done():
		return nil, errs.New(errs.Unknown, "cancelled")
	}
	info, err := a.tools().GetInfo(ctx, videoID)
	if err != nil {
		return nil, err
	}
	return ytdlp.FitInfo(info, maxInfoResult), nil
}

// DownloadResult 是 download 與 cancel 指令的結果。
type DownloadResult struct {
	JobID string `json:"jobId"`
	State string `json:"state"`
}

// Download 實作 download 指令：先確認 yt-dlp 與 ffmpeg 可用，再建立工作並啟動執行程序。
func (a *App) Download(ctx context.Context, d *validate.Download) (any, error) {
	t := a.tools()
	if t.YtDlp == "" {
		return nil, errs.New(errs.YtDlpNotFound, "yt-dlp was not found")
	}
	if ytdlp.NeedsFFmpeg(d) && t.FFmpeg == "" {
		return nil, errs.New(errs.FFmpegNotFound, "ffmpeg was not found")
	}
	st, err := a.Manager.Start(d)
	if err != nil {
		return nil, err
	}
	a.maybeStartUpdate()
	return &DownloadResult{JobID: st.JobID, State: st.State}, nil
}

// maybeStartUpdate 在開始下載時檢查是否該自動更新（008 FR-20）：自動更新開啟、距上次檢查超過
// 24 小時、沒有正在執行的更新，就啟動分離的 ytm-host --update，不等待、不延遲這次下載。
// 開發版（版本不是 x.y.z）不自動更新。
func (a *App) maybeStartUpdate() {
	if _, ok := release.ParseVersion(a.Version); !ok || a.SpawnSelf == nil {
		return
	}
	dir := a.layout().InstallDir
	if !updater.ShouldCheck(updater.Load(dir), a.now()) || updater.Running(dir) {
		return
	}
	if _, err := a.SpawnSelf(UpdateFlag); err != nil {
		a.logf("could not start the update: %v", err)
	}
}

// 小幫手啟動自己時的參數。
const (
	UpdateFlag    = "--update"
	UninstallFlag = "--uninstall"
	// WaitPIDFlag：--uninstall 等這個 PID 的程序結束後才刪除。
	WaitPIDFlag = "--wait-pid"
)

// SetAutoUpdateResult 是 setAutoUpdate 的結果。
type SetAutoUpdateResult struct {
	Auto bool `json:"auto"`
}

// SetAutoUpdate 實作 setAutoUpdate：寫入狀態檔（008 FR-24）。
func (a *App) SetAutoUpdate(ctx context.Context, enabled bool) (any, error) {
	if err := updater.SetAuto(a.layout().InstallDir, enabled); err != nil {
		return nil, errs.New(errs.PermissionDenied, "could not save the setting: %v", err)
	}
	return &SetAutoUpdateResult{Auto: enabled}, nil
}

// CheckUpdatesResult 是 checkUpdates 的結果。
type CheckUpdatesResult struct {
	Started bool `json:"started"`
}

// CheckUpdates 實作 checkUpdates：立即啟動 --update（不受 24 小時限制）；
// 已經在執行時回傳 started: false。
func (a *App) CheckUpdates(ctx context.Context) (any, error) {
	if updater.Running(a.layout().InstallDir) {
		return &CheckUpdatesResult{Started: false}, nil
	}
	if a.SpawnSelf == nil {
		return nil, errs.New(errs.Unknown, "cannot start the update")
	}
	if _, err := a.SpawnSelf(UpdateFlag); err != nil {
		return nil, errs.New(errs.Unknown, "could not start the update: %v", err)
	}
	return &CheckUpdatesResult{Started: true}, nil
}

// UninstallResult 是 uninstall 的結果。
type UninstallResult struct {
	OK bool `json:"ok"`
}

// Uninstall 實作 uninstall（008 FR-30）：有進行中的下載時回傳 JOBS_RUNNING；否則啟動分離的
// ytm-host --uninstall --wait-pid <自己的 PID> 後回傳 {ok: true}。擴充功能收到回應後關閉連線，
// 這個程序隨之結束，移除程序才開始刪除。
func (a *App) Uninstall(ctx context.Context) (any, error) {
	if a.Manager != nil && a.Manager.Store != nil && a.Manager.Store.ActiveCount(a.now()) > 0 {
		return nil, errs.New(errs.JobsRunning, "downloads are in progress")
	}
	if a.SpawnSelf == nil {
		return nil, errs.New(errs.Unknown, "cannot start the uninstaller")
	}
	if _, err := a.SpawnSelf(UninstallFlag, WaitPIDFlag, strconv.Itoa(os.Getpid())); err != nil {
		return nil, errs.New(errs.Unknown, "could not start the uninstaller: %v", err)
	}
	return &UninstallResult{OK: true}, nil
}

// Cancel 實作 cancel 指令。
func (a *App) Cancel(ctx context.Context, jobID string) (any, error) {
	st, err := a.Manager.Cancel(ctx, jobID)
	if err != nil {
		return nil, err
	}
	return &DownloadResult{JobID: st.JobID, State: st.State}, nil
}

// JobsResult 是 jobs 指令的結果。
type JobsResult struct {
	Jobs []jobs.JobView `json:"jobs"`
}

// Jobs 實作 jobs 指令：進行中與最近結束的工作（plan 4.3）。
func (a *App) Jobs(ctx context.Context) (any, error) {
	return &JobsResult{Jobs: a.Manager.List()}, nil
}

// RevealResult 是 reveal 指令的結果。
type RevealResult struct {
	Path string `json:"path"`
}

// Reveal 實作 reveal 指令：在 Finder／檔案總管中選取已完成的檔案。
// 路徑來自橋接程式自己的工作紀錄，不接受擴充功能傳入路徑。
func (a *App) Reveal(ctx context.Context, jobID string) (any, error) {
	st, err := a.Manager.Get(jobID)
	if err != nil {
		return nil, err
	}
	if st.State != jobs.StateDone || st.Path == "" {
		return nil, errs.New(errs.JobNotFinished, "the download has not finished")
	}
	if err := a.Actions.Reveal(ctx, st.Path); err != nil {
		return nil, err
	}
	return &RevealResult{Path: st.Path}, nil
}

// PickFolder 實作 pickFolder 指令：開啟系統的選擇資料夾視窗（參數固定）。
func (a *App) PickFolder(ctx context.Context) (any, error) {
	return a.Actions.PickFolder(ctx)
}

// UpdateYtDlp 實作 updateYtDlp 指令。
func (a *App) UpdateYtDlp(ctx context.Context) (any, error) {
	if !a.updateMu.TryLock() {
		return nil, errs.New(errs.Busy, "an update is already running")
	}
	defer a.updateMu.Unlock()
	defer a.versions.clear()
	return a.tools().Update(ctx)
}
