package commands

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/protocol"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
)

func TestMain(m *testing.M) { testenv.Main(m) }

// recorder 記錄 Backend 收到的呼叫，用來確認非法參數不會傳到 Backend。
type recorder struct {
	mu    sync.Mutex
	calls []string
}

func (r *recorder) add(s string) (any, error) {
	r.mu.Lock()
	r.calls = append(r.calls, s)
	r.mu.Unlock()
	return map[string]string{"called": s}, nil
}

func (r *recorder) Status(context.Context) (any, error) { return r.add("status") }
func (r *recorder) GetInfo(_ context.Context, id string) (any, error) {
	return r.add("getInfo " + id)
}
func (r *recorder) Download(_ context.Context, d *validate.Download) (any, error) {
	return r.add("download " + d.Kind + " " + d.Dir)
}
func (r *recorder) Cancel(_ context.Context, id string) (any, error) { return r.add("cancel " + id) }
func (r *recorder) Jobs(context.Context) (any, error)                { return r.add("jobs") }
func (r *recorder) Reveal(_ context.Context, id string) (any, error) { return r.add("reveal " + id) }
func (r *recorder) PickFolder(context.Context) (any, error)          { return r.add("pickFolder") }
func (r *recorder) UpdateYtDlp(context.Context) (any, error)         { return r.add("updateYtDlp") }
func (r *recorder) SetAutoUpdate(_ context.Context, enabled bool) (any, error) {
	return r.add(fmt.Sprintf("setAutoUpdate %v", enabled))
}
func (r *recorder) CheckUpdates(context.Context) (any, error) { return r.add("checkUpdates") }
func (r *recorder) Uninstall(context.Context) (any, error)    { return r.add("uninstall") }

func TestNames(t *testing.T) {
	want := "cancel checkUpdates download getInfo jobs pickFolder reveal setAutoUpdate status uninstall updateYtDlp"
	if got := strings.Join(Names(), " "); got != want {
		t.Fatalf("commands = %s", got)
	}
}

func TestHandle(t *testing.T) {
	dir := t.TempDir()
	dirJSON, _ := json.Marshal(dir)
	ok := []struct{ msg, call string }{
		{`{"id":"1","cmd":"status"}`, "status"},
		{`{"id":"2","cmd":"status","args":{}}`, "status"},
		{`{"id":"3","cmd":"getInfo","args":{"videoId":"dQw4w9WgXcQ"}}`, "getInfo dQw4w9WgXcQ"},
		{`{"id":"4","cmd":"download","args":{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":` + string(dirJSON) + `}}`, "download mp3 " + dir},
		{`{"id":"5","cmd":"cancel","args":{"jobId":"0123456789abcdef"}}`, "cancel 0123456789abcdef"},
		{`{"id":"6","cmd":"jobs"}`, "jobs"},
		{`{"id":"7","cmd":"reveal","args":{"jobId":"0123456789abcdef"}}`, "reveal 0123456789abcdef"},
		{`{"id":"8","cmd":"pickFolder"}`, "pickFolder"},
		{`{"id":"9","cmd":"updateYtDlp"}`, "updateYtDlp"},
		{`{"id":"10","cmd":"setAutoUpdate","args":{"enabled":false}}`, "setAutoUpdate false"},
		{`{"id":"11","cmd":"setAutoUpdate","args":{"enabled":true}}`, "setAutoUpdate true"},
		{`{"id":"12","cmd":"checkUpdates"}`, "checkUpdates"},
		{`{"id":"13","cmd":"uninstall","args":{}}`, "uninstall"},
	}
	for _, c := range ok {
		rec := &recorder{}
		d := &Dispatcher{Backend: rec}
		resp := d.Handle(context.Background(), []byte(c.msg))
		if !resp.OK || len(rec.calls) != 1 || rec.calls[0] != c.call {
			t.Errorf("%s: resp %+v calls %v", c.msg, resp, rec.calls)
		}
	}

	bad := []struct {
		msg  string
		id   string
		code errs.Code
	}{
		{`garbage`, "", errs.InvalidRequest},
		{`{"cmd":"status"}`, "", errs.InvalidRequest},
		{`{"id":"x","cmd":"exec","args":{"cmd":"rm -rf /"}}`, "x", errs.UnknownCommand},
		{`{"id":"x","cmd":"Status"}`, "x", errs.UnknownCommand},
		{`{"id":"x","cmd":"getSubtitles"}`, "x", errs.UnknownCommand},
		{`{"id":"x","cmd":"__proto__"}`, "x", errs.UnknownCommand},
		{`{"id":"x","cmd":"status","args":{"verbose":true}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"jobs","args":{"all":true}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"pickFolder","args":{"initial":"/etc"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"updateYtDlp","args":{"channel":"nightly"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"getInfo"}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"setAutoUpdate"}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"setAutoUpdate","args":{}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"setAutoUpdate","args":{"enabled":"false"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"setAutoUpdate","args":{"enabled":1}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"setAutoUpdate","args":{"enabled":null}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"setAutoUpdate","args":{"enabled":true,"interval":1}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"checkUpdates","args":{"url":"https://example.com/components.json"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"uninstall","args":{"dir":"/"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"install"}`, "x", errs.UnknownCommand},
		{`{"id":"x","cmd":"update"}`, "x", errs.UnknownCommand},
		{`{"id":"x","cmd":"getInfo","args":{"videoId":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"getInfo","args":{"videoId":"dQw4w9WgXcQ","url":"https://example.com"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"getInfo","args":{"videoId":"--exec=ls"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"cancel","args":{}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"cancel","args":{"jobId":"../../x"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"reveal","args":{"jobId":"0123456789abcdef","path":"/etc/passwd"}}`, "x", errs.InvalidArgs},
		{`{"id":"x","cmd":"download","args":{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"/definitely/not/here"}}`, "x", errs.PermissionDenied},
		{`{"id":"x","cmd":"download","args":{"videoId":"dQw4w9WgXcQ","kind":"mp3","bitrate":192,"dir":"../.."}}`, "x", errs.InvalidArgs},
	}
	for _, c := range bad {
		rec := &recorder{}
		d := &Dispatcher{Backend: rec}
		resp := d.Handle(context.Background(), []byte(c.msg))
		gotID := ""
		if resp.ID != nil {
			gotID = *resp.ID
		}
		if resp.OK || resp.Error == nil || resp.Error.Code != c.code || gotID != c.id {
			t.Errorf("%s: got %+v (error %+v), want %s", c.msg, resp, resp.Error, c.code)
		}
		if len(rec.calls) != 0 {
			t.Errorf("%s: backend was called: %v", c.msg, rec.calls)
		}
	}
}

type errBackend struct{ recorder }

func (*errBackend) Status(context.Context) (any, error) {
	return nil, errs.New(errs.YtDlpNotFound, "yt-dlp not found")
}
func (*errBackend) Jobs(context.Context) (any, error) { return nil, fmt.Errorf("plain error") }

func TestHandleBackendErrors(t *testing.T) {
	d := &Dispatcher{Backend: &errBackend{}}
	resp := d.Handle(context.Background(), []byte(`{"id":"a","cmd":"status"}`))
	if resp.OK || resp.Error.Code != errs.YtDlpNotFound || *resp.ID != "a" {
		t.Fatalf("%+v", resp)
	}
	resp = d.Handle(context.Background(), []byte(`{"id":"b","cmd":"jobs"}`))
	if resp.OK || resp.Error.Code != errs.Unknown {
		t.Fatalf("%+v", resp)
	}
}

func frame(body string) []byte {
	b := make([]byte, 4+len(body))
	binary.NativeEndian.PutUint32(b, uint32(len(body)))
	copy(b[4:], body)
	return b
}

func TestServe(t *testing.T) {
	var in bytes.Buffer
	in.Write(frame(`{"id":"a","cmd":"status"}`))
	in.Write(frame(strings.Repeat(" ", protocol.MaxIncoming+10)))
	in.Write(frame(`{"id":"b","cmd":"nope"}`))
	in.Write(frame(`{"id":"c","cmd":"jobs"}`))
	var out bytes.Buffer
	w := protocol.NewWriter(&out)
	rec := &recorder{}
	if err := Serve(context.Background(), &in, w, &Dispatcher{Backend: rec}); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	nullErrors := 0
	for {
		msg, err := protocol.ReadMessage(&out)
		if err != nil {
			break
		}
		var r struct {
			ID    *string
			OK    bool
			Error *errs.Error
		}
		if err := json.Unmarshal(msg, &r); err != nil {
			t.Fatal(err)
		}
		if r.ID == nil {
			nullErrors++
			if r.Error.Code != errs.InvalidRequest {
				t.Errorf("oversized: %+v", r.Error)
			}
			continue
		}
		got[*r.ID] = r.OK
	}
	if !got["a"] || got["b"] || !got["c"] || len(got) != 3 || nullErrors != 1 {
		t.Fatalf("responses %v, null-id errors %d", got, nullErrors)
	}
}
