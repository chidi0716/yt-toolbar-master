// Package commands 是指令分派（plan 4.3）：只接受固定的指令（002 FR-70），
// 每個指令先依 validate 套件檢查參數，通過後才交給 Backend 執行。
package commands

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"sync"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/protocol"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
)

// Backend 是各指令的實際執行者。傳進來的參數都已經通過驗證。
type Backend interface {
	Status(ctx context.Context) (any, error)
	GetInfo(ctx context.Context, videoID string) (any, error)
	Download(ctx context.Context, d *validate.Download) (any, error)
	Cancel(ctx context.Context, jobID string) (any, error)
	Jobs(ctx context.Context) (any, error)
	Reveal(ctx context.Context, jobID string) (any, error)
	PickFolder(ctx context.Context) (any, error)
	UpdateYtDlp(ctx context.Context) (any, error)
	// 008（plan 4.9）
	SetAutoUpdate(ctx context.Context, enabled bool) (any, error)
	CheckUpdates(ctx context.Context) (any, error)
	Uninstall(ctx context.Context) (any, error)
}

// Logger 記錄指令名稱與錯誤代碼（plan 4.7，不記錄參數內容）。
type Logger interface {
	Printf(format string, a ...any)
}

type handler func(ctx context.Context, b Backend, args json.RawMessage) (any, error)

type videoIDArgs struct {
	VideoID *string `json:"videoId"`
}

type enabledArgs struct {
	Enabled *bool `json:"enabled"`
}

type jobIDArgs struct {
	JobID *string `json:"jobId"`
}

func decodeArgs(raw json.RawMessage, v any) error {
	dec := json.NewDecoder(bytesReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errs.New(errs.InvalidArgs, "args: %v", err)
	}
	if dec.More() {
		return errs.New(errs.InvalidArgs, "args: trailing data")
	}
	return nil
}

func jobIDFrom(raw json.RawMessage) (string, error) {
	var a jobIDArgs
	if err := decodeArgs(raw, &a); err != nil {
		return "", err
	}
	if a.JobID == nil {
		return "", errs.New(errs.InvalidArgs, "jobId: is required")
	}
	if err := validate.JobID(*a.JobID); err != nil {
		return "", err
	}
	return *a.JobID, nil
}

// noArgs 是不接受參數的指令。
func noArgs(f func(Backend, context.Context) (any, error)) handler {
	return func(ctx context.Context, b Backend, args json.RawMessage) (any, error) {
		if err := validate.NoArgs(args); err != nil {
			return nil, err
		}
		return f(b, ctx)
	}
}

// handlers 是全部的指令；不在這裡的指令一律回 UNKNOWN_COMMAND。
var handlers = map[string]handler{
	"status": noArgs(Backend.Status),
	"getInfo": func(ctx context.Context, b Backend, args json.RawMessage) (any, error) {
		var a videoIDArgs
		if err := decodeArgs(args, &a); err != nil {
			return nil, err
		}
		if a.VideoID == nil {
			return nil, errs.New(errs.InvalidArgs, "videoId: is required")
		}
		if err := validate.VideoID(*a.VideoID); err != nil {
			return nil, err
		}
		return b.GetInfo(ctx, *a.VideoID)
	},
	"download": func(ctx context.Context, b Backend, args json.RawMessage) (any, error) {
		d, err := validate.DownloadArgs(args)
		if err != nil {
			return nil, err
		}
		dir, err := validate.Dir(d.Dir)
		if err != nil {
			return nil, err
		}
		d.Dir = dir
		return b.Download(ctx, d)
	},
	"cancel": func(ctx context.Context, b Backend, args json.RawMessage) (any, error) {
		id, err := jobIDFrom(args)
		if err != nil {
			return nil, err
		}
		return b.Cancel(ctx, id)
	},
	"jobs": noArgs(Backend.Jobs),
	"reveal": func(ctx context.Context, b Backend, args json.RawMessage) (any, error) {
		id, err := jobIDFrom(args)
		if err != nil {
			return nil, err
		}
		return b.Reveal(ctx, id)
	},
	"pickFolder":  noArgs(Backend.PickFolder),
	"updateYtDlp": noArgs(Backend.UpdateYtDlp),
	"setAutoUpdate": func(ctx context.Context, b Backend, args json.RawMessage) (any, error) {
		var a enabledArgs
		if err := decodeArgs(args, &a); err != nil {
			return nil, err
		}
		if a.Enabled == nil {
			return nil, errs.New(errs.InvalidArgs, "enabled: is required")
		}
		return b.SetAutoUpdate(ctx, *a.Enabled)
	},
	"checkUpdates": noArgs(Backend.CheckUpdates),
	"uninstall":    noArgs(Backend.Uninstall),
}

// Names 回傳全部指令名稱（排序過）。
func Names() []string {
	names := make([]string, 0, len(handlers))
	for n := range handlers {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// Dispatcher 把一則原始訊息轉成回應。
type Dispatcher struct {
	Backend Backend
	Log     Logger
}

// Handle 處理一則原始訊息並回傳要送出的回應（一定不是 nil）。
func (d *Dispatcher) Handle(ctx context.Context, msg []byte) *protocol.Response {
	req, id, err := protocol.ParseRequest(msg)
	if err != nil {
		d.logf("request rejected: %s", errs.From(err).Code)
		return protocol.ErrorResponse(id, err)
	}
	h, ok := handlers[req.Cmd]
	if !ok {
		d.logf("unknown command rejected")
		return protocol.ErrorResponse(id, errs.New(errs.UnknownCommand, "unknown command"))
	}
	result, err := h(ctx, d.Backend, req.Args)
	if err != nil {
		e := errs.From(err)
		d.logf("%s: %s %s", req.Cmd, e.Code, e.Message)
		return protocol.ErrorResponse(id, e)
	}
	d.logf("%s: ok", req.Cmd)
	return protocol.OKResponse(id, result)
}

func (d *Dispatcher) logf(format string, a ...any) {
	if d.Log != nil {
		d.Log.Printf(format, a...)
	}
}

// MaxConcurrent 是同時處理的請求數上限。
const MaxConcurrent = 8

// Serve 從 r 讀取請求、並行處理，回應寫到 w，直到 r 結束（瀏覽器關閉連線）。
// r 結束後會取消仍在處理中的請求（例如開著的選擇資料夾視窗），等它們結束後才回傳。
// 下載工作不受影響，由 jobs 套件自行管理。
func Serve(ctx context.Context, r io.Reader, w *protocol.Writer, d *Dispatcher) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	sem := make(chan struct{}, MaxConcurrent)
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		msg, err := protocol.ReadMessage(r)
		if errors.Is(err, protocol.ErrTooLarge) {
			d.logf("request rejected: too large")
			_ = w.Send(protocol.ErrorResponse("", errs.New(errs.InvalidRequest, "message too large")))
			continue
		}
		if err != nil {
			cancel()
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			_ = w.Send(d.Handle(ctx, msg))
		}()
	}
}
