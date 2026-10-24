package jobs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
)

// TestRetryAfterYtDlpUpdate 測試 008 FR-22：YTDLP_OUTDATED／VERIFICATION_REQUIRED 時在同一個工作內
// 更新 yt-dlp（發出 stage: updating-ytdlp），成功後重新下載一次；同一個工作只試一次。
func TestRetryAfterYtDlpUpdate(t *testing.T) {
	for _, scenario := range []string{"outdated-once", "bot-once"} {
		t.Run(scenario, func(t *testing.T) {
			h := newHarness(t)
			marker := filepath.Join(t.TempDir(), "updated")
			t.Setenv("FAKE_YTDLP_SCENARIO", scenario)
			t.Setenv("FAKE_YTDLP_MARKER", marker)
			var calls atomic.Int32
			h.updateYtDlp = func(ctx context.Context) (bool, error) {
				calls.Add(1)
				time.Sleep(300 * time.Millisecond) // 真正的 yt-dlp -U 需要幾秒；讓輪詢看得到這個階段
				// 這裡的「更新」就是讓假 yt-dlp 之後不再失敗。
				return true, os.WriteFile(marker, []byte("x"), 0o644)
			}
			id := h.download(nil)
			st := h.wait(id)
			if st.State != StateDone || calls.Load() != 1 {
				t.Fatalf("state %s, error %+v, updates %d", st.State, st.Error, calls.Load())
			}
			sawStage := false
			for _, ev := range h.eventsFor(id) {
				if ev.Event == "progress" && ev.Stage == StageUpdatingYtDlp {
					sawStage = true
				}
			}
			if !sawStage {
				t.Errorf("no progress event with stage %s: %+v", StageUpdatingYtDlp, h.eventsFor(id))
			}
			if got := h.files(); len(got) != 1 || got[0] != wantVideoName {
				t.Errorf("files: %v", got)
			}
		})
	}
}

func TestNoRetryWhenUpdateDoesNotHelp(t *testing.T) {
	h := newHarness(t)
	t.Setenv("FAKE_YTDLP_SCENARIO", "outdated")
	var calls atomic.Int32
	// 已是最新版本：不重試，回報原本的錯誤。
	h.updateYtDlp = func(ctx context.Context) (bool, error) { calls.Add(1); return false, nil }
	st := h.wait(h.download(nil))
	if st.State != StateFailed || st.Error.Code != errs.YtDlpOutdated || calls.Load() != 1 {
		t.Fatalf("up to date: %+v %+v calls %d", st, st.Error, calls.Load())
	}
	// 更新失敗：同樣回報原本的錯誤。
	h.updateYtDlp = func(ctx context.Context) (bool, error) { calls.Add(1); return false, errors.New("offline") }
	st = h.wait(h.download(nil))
	if st.State != StateFailed || st.Error.Code != errs.YtDlpOutdated || calls.Load() != 2 {
		t.Fatalf("update failed: %+v calls %d", st, calls.Load())
	}
	// 更新成功但仍然失敗：只試一次。
	h.updateYtDlp = func(ctx context.Context) (bool, error) { calls.Add(1); return true, nil }
	st = h.wait(h.download(nil))
	if st.State != StateFailed || st.Error.Code != errs.YtDlpOutdated || calls.Load() != 3 {
		t.Fatalf("still outdated: %+v calls %d", st, calls.Load())
	}
	// 其他錯誤不更新。
	t.Setenv("FAKE_YTDLP_SCENARIO", "network")
	st = h.wait(h.download(nil))
	if st.Error.Code != errs.Network || calls.Load() != 3 {
		t.Fatalf("network: %+v calls %d", st.Error, calls.Load())
	}
	if got := h.files(); len(got) != 0 {
		t.Errorf("files left: %v", got)
	}
}
