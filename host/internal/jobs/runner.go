package jobs

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
	"github.com/chidi0716/yt-toolbar-master/host/internal/ytdlp"
)

// Logger 是記錄檔介面。
type Logger interface {
	Printf(format string, a ...any)
}

type nopLogger struct{}

func (nopLogger) Printf(string, ...any) {}

// 執行程序的時間設定。
const (
	// MaxJobDuration 是單一下載的時間上限；超過就結束並回報 TIMEOUT。
	MaxJobDuration = 24 * time.Hour
	heartbeatEvery = 5 * time.Second
	progressEvery  = 250 * time.Millisecond
	cancelPoll     = 200 * time.Millisecond
	killGrace      = 3 * time.Second
)

// TmpDirName 回傳工作在下載資料夾中的暫存資料夾名稱。yt-dlp 的所有輸出（.part、.ytdl、
// 合併前的影像與聲音、縮圖、字幕）都先放在這裡，完成後只把結果搬出來，
// 取消或失敗時整個刪除（plan 4.6）。
func TmpDirName(jobID string) string { return ".ytm-tmp-" + jobID }

// Runner 在執行程序中執行一個工作。
type Runner struct {
	Store *Store
	Tools *ytdlp.Tools
	Log   Logger
	// Now 與 MaxDuration 可在測試中替換。
	Now         func() time.Time
	MaxDuration time.Duration
	// UpdateYtDlp 在下載遇到 YTDLP_OUTDATED 或 VERIFICATION_REQUIRED 時執行 yt-dlp -U
	// （008 FR-22），回傳是否安裝了新版本；nil 代表不自動更新（yt-dlp 不在安裝資料夾中）。
	UpdateYtDlp func(ctx context.Context) (bool, error)
}

// StageUpdatingYtDlp 是自動更新 yt-dlp 時的 stage（plan 4.9）。
const StageUpdatingYtDlp = "updating-ytdlp"

// retryAfterUpdate 回傳這個錯誤是否值得更新 yt-dlp 後重試。
func retryAfterUpdate(e *errs.Error) bool {
	return e != nil && (e.Code == errs.YtDlpOutdated || e.Code == errs.VerificationRequired)
}

// Run 執行工作直到結束，回傳最後的狀態。只在 --run-job 模式中呼叫。
func (r *Runner) Run(id string) (*Status, error) {
	if r.Log == nil {
		r.Log = nopLogger{}
	}
	if r.Now == nil {
		r.Now = time.Now
	}
	if r.MaxDuration == 0 {
		r.MaxDuration = MaxJobDuration
	}
	if err := validate.JobID(id); err != nil {
		return nil, err
	}
	unlock, err := r.Store.Lock(id)
	if err != nil {
		return nil, err
	}
	defer unlock()

	st, err := r.Store.ReadStatus(id)
	if err != nil {
		return nil, err
	}
	if Final(st.State) {
		return st, nil
	}
	st.RunnerPID = os.Getpid()

	finish := func(state string, e *errs.Error) (*Status, error) {
		now := r.Now()
		st.State, st.Error, st.UpdatedAt, st.FinishedAt = state, e, now, &now
		if state == StateDone {
			p := 100.0
			st.Percent = &p
		}
		st.Speed, st.ETA = nil, nil
		if e != nil {
			r.Log.Printf("job %s %s: %s %s", id, state, e.Code, e.Message)
		} else {
			r.Log.Printf("job %s %s", id, state)
		}
		return st, r.Store.WriteStatus(st)
	}

	spec, err := r.Store.ReadSpec(id)
	if err != nil {
		return finish(StateFailed, errs.New(errs.InvalidArgs, "could not read job: %v", err))
	}
	d := spec.Download
	// 狀態資料夾中的參數再驗證一次（FR-72）。
	if err := validate.Recheck(d); err != nil {
		return finish(StateFailed, errs.From(err))
	}
	if _, err := validate.Dir(d.Dir); err != nil {
		return finish(StateFailed, errs.From(err))
	}
	if r.Store.CancelRequested(id) {
		return finish(StateCancelled, nil)
	}
	if r.Tools.YtDlp == "" {
		return finish(StateFailed, errs.New(errs.YtDlpNotFound, "yt-dlp was not found"))
	}
	if ytdlp.NeedsFFmpeg(d) && r.Tools.FFmpeg == "" {
		return finish(StateFailed, errs.New(errs.FFmpegNotFound, "ffmpeg was not found"))
	}

	tmp := filepath.Join(d.Dir, TmpDirName(id))
	if err := os.MkdirAll(tmp, 0o700); err != nil {
		return finish(StateFailed, errs.New(errs.PermissionDenied, "could not create a temporary folder in the download folder"))
	}
	defer removeAllRetry(tmp)

	r.Log.Printf("job %s start: %s", id, d.Kind)
	path, e := r.download(id, st, d, tmp)
	if retryAfterUpdate(e) && r.UpdateYtDlp != nil && !r.Store.CancelRequested(id) {
		// 008 FR-22：同一個工作內更新 yt-dlp（不受 24 小時限制，只試一次），成功後重新下載一次。
		r.Log.Printf("job %s %s: updating yt-dlp", id, e.Code)
		st.Stage, st.State, st.Percent, st.Speed, st.ETA, st.UpdatedAt = StageUpdatingYtDlp, StateDownloading, nil, nil, nil, r.Now()
		r.Store.WriteStatus(st)
		updated, err := r.UpdateYtDlp(context.Background())
		st.Stage, st.UpdatedAt = "", r.Now()
		r.Store.WriteStatus(st)
		switch {
		case err != nil:
			r.Log.Printf("job %s yt-dlp update failed: %v", id, err)
		case !updated:
			r.Log.Printf("job %s yt-dlp is already up to date", id)
		case r.Store.CancelRequested(id):
			return finish(StateCancelled, nil)
		default:
			removeAllRetry(tmp)
			if err := os.MkdirAll(tmp, 0o700); err != nil {
				return finish(StateFailed, errs.New(errs.PermissionDenied, "could not create a temporary folder in the download folder"))
			}
			r.Log.Printf("job %s retrying after the yt-dlp update", id)
			path, e = r.download(id, st, d, tmp)
		}
	}
	if e != nil {
		if e.Code == "CANCELLED" {
			return finish(StateCancelled, nil)
		}
		return finish(StateFailed, e)
	}
	st.State, st.UpdatedAt = StateProcessing, r.Now()
	r.Store.WriteStatus(st)

	final, e := r.finalize(d, tmp, path)
	if e != nil {
		return finish(StateFailed, e)
	}
	st.Path, st.FileName = final, filepath.Base(final)
	return finish(StateDone, nil)
}

// cancelledErr 是內部用來表示「被取消」的值，不會回報給擴充功能。
var cancelledErr = &errs.Error{Code: "CANCELLED", Message: "cancelled"}

// download 執行 yt-dlp，回傳 yt-dlp 回報的最終檔案路徑（字幕為空字串）。
func (r *Runner) download(id string, st *Status, d *validate.Download, tmp string) (string, *errs.Error) {
	// 以 Background 建立指令，結束子程序樹由 procTree 負責（不用 CommandContext 只結束 yt-dlp）。
	cmd, err := r.Tools.Command(context.Background(), ytdlp.DownloadArgs(d, tmp, r.Tools.FFmpeg)...)
	if err != nil {
		return "", errs.From(err)
	}
	cmd.Dir = tmp
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", errs.From(err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", errs.From(err)
	}
	tree, err := startTree(cmd)
	if err != nil {
		return "", errs.New(errs.YtDlpNotFound, "could not start yt-dlp: %v", err)
	}
	defer tree.close()

	st.State, st.UpdatedAt = StateDownloading, r.Now()
	r.Store.WriteStatus(st)

	var (
		mu        sync.Mutex
		filePath  string
		tail      []string // 最後的輸出行，用來分類錯誤
		dirty     bool
		lastWrite time.Time
		tracker   = ytdlp.NewTracker(d.FormatID)
	)
	writeLocked := func(force bool) {
		if !force && (!dirty || time.Since(lastWrite) < progressEvery) {
			return
		}
		st.UpdatedAt = r.Now()
		r.Store.WriteStatus(st)
		dirty, lastWrite = false, time.Now()
	}
	handle := func(line string) {
		l := ytdlp.ParseLine(line)
		mu.Lock()
		defer mu.Unlock()
		if l.Kind == ytdlp.LineOther || l.Kind == ytdlp.LineError {
			if strings.TrimSpace(line) != "" {
				tail = append(tail, line)
				if len(tail) > 200 {
					tail = tail[len(tail)-200:]
				}
			}
		}
		switch l.Kind {
		case ytdlp.LineProgress:
			s := tracker.Update(l.Progress, l.FormatID)
			st.Percent, st.Speed, st.ETA = s.Percent, s.Speed, s.ETA
			st.Downloaded, st.Total, st.Part, st.Parts = s.Downloaded, s.Total, s.Part, s.Parts
			if st.State != StateProcessing {
				st.State = StateDownloading
			}
			dirty = true
			writeLocked(false)
		case ytdlp.LinePost:
			if l.PostName != "MoveFiles" && st.State != StateProcessing {
				st.State, st.Speed, st.ETA = StateProcessing, nil, nil
				dirty = true
				writeLocked(true)
			}
		case ytdlp.LineFile:
			filePath = l.Path
		}
	}
	var wg sync.WaitGroup
	scan := func(rd io.Reader) {
		defer wg.Done()
		sc := bufio.NewScanner(rd)
		sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for sc.Scan() {
			handle(sc.Text())
		}
		io.Copy(io.Discard, rd)
	}
	wg.Add(2)
	go scan(stdout)
	go scan(stderr)

	exited := make(chan struct{})
	var waitErr error
	go func() {
		wg.Wait() // 讀完輸出才能呼叫 Wait
		waitErr = cmd.Wait()
		close(exited)
	}()

	deadline := time.NewTimer(r.MaxDuration)
	defer deadline.Stop()
	poll := time.NewTicker(cancelPoll)
	defer poll.Stop()
	heartbeat := time.NewTicker(heartbeatEvery)
	defer heartbeat.Stop()

	var stopReason *errs.Error
loop:
	for {
		select {
		case <-exited:
			break loop
		case <-poll.C:
			if r.Store.CancelRequested(id) {
				stopReason = cancelledErr
				r.Log.Printf("job %s cancel requested", id)
				tree.terminate(exited, killGrace)
				<-exited
				break loop
			}
			mu.Lock()
			writeLocked(false)
			mu.Unlock()
		case <-heartbeat.C:
			mu.Lock()
			writeLocked(true)
			mu.Unlock()
		case <-deadline.C:
			stopReason = errs.New(errs.Timeout, "download did not finish in %s", r.MaxDuration)
			tree.terminate(exited, killGrace)
			<-exited
			break loop
		}
	}
	// yt-dlp 結束後仍留著的子程序（例如 ffmpeg）一併結束。
	tree.killRemaining()

	if stopReason != nil {
		return "", stopReason
	}
	mu.Lock()
	defer mu.Unlock()
	if waitErr != nil {
		var exitErr *exec.ExitError
		if !errors.As(waitErr, &exitErr) {
			return "", errs.New(errs.Unknown, "yt-dlp: %v", waitErr)
		}
		return "", ytdlp.Classify(tail)
	}
	return filePath, nil
}

// finalize 找出結果檔案（字幕需要轉成 TXT 時在這裡轉換），搬到下載資料夾並避免覆蓋既有檔案。
func (r *Runner) finalize(d *validate.Download, tmp, reported string) (string, *errs.Error) {
	var src string
	switch d.Kind {
	case validate.KindSubtitle:
		ext := ".vtt"
		if d.SubFormat == "srt" {
			ext = ".srt"
		}
		src = findFile(tmp, "."+d.SubLang+ext)
		if src == "" {
			return "", errs.New(errs.NoSubtitles, "no %s subtitles for %s", d.SubFormat, d.SubLang)
		}
		if d.SubFormat == "txt" {
			f, err := os.Open(src)
			if err != nil {
				return "", errs.From(err)
			}
			text, err := ytdlp.VTTToText(f)
			f.Close()
			if err != nil {
				return "", errs.From(err)
			}
			txt := strings.TrimSuffix(src, ".vtt") + ".txt"
			if err := os.WriteFile(txt, []byte(text), 0o644); err != nil {
				return "", writeError(err)
			}
			src = txt
		}
	default:
		if reported == "" {
			// --match-filters 略過直播與尚未開始的影片時，yt-dlp 不會輸出任何檔案。
			return "", errs.New(errs.LiveNotSupported, "yt-dlp skipped the video (live or upcoming)")
		}
		rel, err := filepath.Rel(tmp, reported)
		if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) || strings.ContainsAny(rel, `/\`) {
			return "", errs.New(errs.Unknown, "yt-dlp reported an unexpected output path")
		}
		src = reported
	}
	if st, err := os.Stat(src); err != nil || !st.Mode().IsRegular() {
		return "", errs.New(errs.Unknown, "output file is missing")
	}
	dest, err := moveUnique(src, d.Dir)
	if err != nil {
		return "", writeError(err)
	}
	return dest, nil
}

func writeError(err error) *errs.Error {
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "no space") || strings.Contains(msg, "not enough space"):
		return errs.New(errs.DiskFull, "%v", err)
	case errors.Is(err, os.ErrPermission):
		return errs.New(errs.PermissionDenied, "%v", err)
	}
	return errs.New(errs.Unknown, "%v", err)
}

// findFile 回傳 dir 中以 suffix 結尾的檔案（不分大小寫）。
func findFile(dir, suffix string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if e.Type().IsRegular() && strings.HasSuffix(strings.ToLower(e.Name()), strings.ToLower(suffix)) {
			return filepath.Join(dir, e.Name())
		}
	}
	return ""
}

// moveUnique 把 src 搬到 dir；同名檔案已存在時改名為「名稱 (2).副檔名」等。
func moveUnique(src, dir string) (string, error) {
	name := filepath.Base(src)
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; i < 1000; i++ {
		candidate := name
		if i > 1 {
			candidate = fmt.Sprintf("%s (%d)%s", stem, i, ext)
		}
		dest := filepath.Join(dir, candidate)
		// 以建立空檔的方式佔住名稱，避免兩個工作同時搬到同一個名稱。
		f, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		f.Close()
		if err := os.Rename(src, dest); err != nil {
			os.Remove(dest)
			return "", err
		}
		return dest, nil
	}
	return "", errors.New("too many files with the same name")
}

// removeAllRetry 刪除暫存資料夾。Windows 上剛結束的程序可能還鎖著檔案，稍等再試。
func removeAllRetry(dir string) {
	for i := 0; i < 20; i++ {
		if err := os.RemoveAll(dir); err == nil {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
}
