package protocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
)

func TestMain(m *testing.M) { testenv.Main(m) }

func frame(body string) []byte {
	b := make([]byte, 4+len(body))
	binary.NativeEndian.PutUint32(b, uint32(len(body)))
	copy(b[4:], body)
	return b
}

func TestReadMessage(t *testing.T) {
	var in bytes.Buffer
	in.Write(frame(`{"id":"a","cmd":"status"}`))
	in.Write(frame(`{"id":"b","cmd":"jobs"}`))
	for _, want := range []string{`{"id":"a","cmd":"status"}`, `{"id":"b","cmd":"jobs"}`} {
		got, err := ReadMessage(&in)
		if err != nil || string(got) != want {
			t.Fatalf("ReadMessage = %q, %v; want %q", got, err, want)
		}
	}
	if _, err := ReadMessage(&in); !errors.Is(err, io.EOF) {
		t.Fatalf("want EOF, got %v", err)
	}
}

func TestReadMessageTruncated(t *testing.T) {
	// 長度欄位只有 2 個位元組、內容不足，都視為連線結束。
	for _, in := range [][]byte{{1, 0}, frame(`{"id":"a"}`)[:8]} {
		if _, err := ReadMessage(bytes.NewReader(in)); !errors.Is(err, io.EOF) {
			t.Errorf("truncated %v: want EOF, got %v", in, err)
		}
	}
}

func TestReadMessageTooLarge(t *testing.T) {
	big := strings.Repeat("x", MaxIncoming+1)
	var in bytes.Buffer
	in.Write(frame(big))
	in.Write(frame(`{"id":"next","cmd":"status"}`))
	if _, err := ReadMessage(&in); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
	// 過大的訊息被丟棄後，下一則仍能正常讀取。
	got, err := ReadMessage(&in)
	if err != nil || string(got) != `{"id":"next","cmd":"status"}` {
		t.Fatalf("after discard: %q, %v", got, err)
	}
}

func TestReadMessageCorruptLength(t *testing.T) {
	hdr := make([]byte, 4)
	binary.NativeEndian.PutUint32(hdr, 0xFFFFFFF0)
	if _, err := ReadMessage(bytes.NewReader(hdr)); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("want ErrCorrupt, got %v", err)
	}
}

func TestEncodeMessage(t *testing.T) {
	b, err := EncodeMessage(OKResponse("x1", map[string]string{"path": "a<b>&c 中文"}))
	if err != nil {
		t.Fatal(err)
	}
	n := binary.NativeEndian.Uint32(b[:4])
	if int(n) != len(b)-4 {
		t.Fatalf("length %d != body %d", n, len(b)-4)
	}
	want := `{"id":"x1","ok":true,"result":{"path":"a<b>&c 中文"}}`
	if string(b[4:]) != want {
		t.Fatalf("body = %s; want %s", b[4:], want)
	}
}

func TestEncodeMessageLimit(t *testing.T) {
	_, err := EncodeMessage(OKResponse("x", strings.Repeat("a", MaxOutgoing)))
	if e := errs.From(err); e == nil || e.Code != errs.ResponseTooLarge {
		t.Fatalf("want RESPONSE_TOO_LARGE, got %v", err)
	}
}

func TestWriterReplacesOversizedResponse(t *testing.T) {
	var out bytes.Buffer
	w := NewWriter(&out)
	if err := w.Send(OKResponse("big", strings.Repeat("a", MaxOutgoing))); err != nil {
		t.Fatal(err)
	}
	msg, err := ReadMessage(&out)
	if err != nil {
		t.Fatal(err)
	}
	var resp struct {
		ID    string
		OK    bool
		Error errs.Error
	}
	if err := json.Unmarshal(msg, &resp); err != nil {
		t.Fatal(err)
	}
	if resp.ID != "big" || resp.OK || resp.Error.Code != errs.ResponseTooLarge {
		t.Fatalf("got %+v", resp)
	}
}

type failWriter struct{}

func (failWriter) Write([]byte) (int, error) { return 0, errors.New("broken pipe") }

func TestWriterClosed(t *testing.T) {
	w := NewWriter(failWriter{})
	if err := w.Send(OKResponse("a", nil)); !errors.Is(err, ErrClosed) {
		t.Fatalf("want ErrClosed, got %v", err)
	}
	if !w.Closed() {
		t.Fatal("writer should be closed after a failed write")
	}
	var out bytes.Buffer
	w2 := NewWriter(&out)
	w2.Close()
	if err := w2.Send(OKResponse("a", nil)); !errors.Is(err, ErrClosed) || out.Len() != 0 {
		t.Fatalf("closed writer wrote %d bytes, err %v", out.Len(), err)
	}
}

func TestParseRequest(t *testing.T) {
	ok := []struct {
		in, cmd, args string
	}{
		{`{"id":"6f1c2a9e-7d0b-4f5e-9a51-1b2c3d4e5f60","cmd":"status"}`, "status", `{}`},
		{`{"id":"a","cmd":"status","args":null}`, "status", `{}`},
		{`{"id":"a","cmd":"getInfo","args":{"videoId":"dQw4w9WgXcQ"}}`, "getInfo", `{"videoId":"dQw4w9WgXcQ"}`},
	}
	for _, c := range ok {
		req, _, err := ParseRequest([]byte(c.in))
		if err != nil {
			t.Errorf("%s: %v", c.in, err)
			continue
		}
		if req.Cmd != c.cmd || string(req.Args) != c.args {
			t.Errorf("%s: got cmd %q args %s", c.in, req.Cmd, req.Args)
		}
	}

	bad := []struct {
		in     string
		wantID string
	}{
		{`not json`, ""},
		{`[]`, ""},
		{`{"cmd":"status"}`, ""},
		{`{"id":"","cmd":"status"}`, ""},
		{`{"id":123,"cmd":"status"}`, ""},
		{`{"id":"a b","cmd":"status"}`, ""},
		{`{"id":"` + strings.Repeat("a", 65) + `","cmd":"status"}`, ""},
		{`{"id":"../x","cmd":"status"}`, ""},
		{`{"id":"a"}`, "a"},
		{`{"id":"a","cmd":""}`, "a"},
		{`{"id":"a","cmd":"status","args":[]}`, "a"},
		{`{"id":"a","cmd":"status","args":"--exec rm"}`, "a"},
		{`{"id":"a","cmd":"status","extra":1}`, ""},
		{`{"id":"a","cmd":"status"} {"id":"b"}`, ""},
	}
	for _, c := range bad {
		_, id, err := ParseRequest([]byte(c.in))
		if e := errs.From(err); e == nil || e.Code != errs.InvalidRequest {
			t.Errorf("%s: want INVALID_REQUEST, got %v", c.in, err)
		}
		if id != c.wantID {
			t.Errorf("%s: id %q, want %q", c.in, id, c.wantID)
		}
	}
}

func TestErrorResponseNullID(t *testing.T) {
	b, err := EncodeMessage(ErrorResponse("", errs.New(errs.InvalidRequest, "bad")))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"id":null,"ok":false,"error":{"code":"INVALID_REQUEST","message":"bad"}}`
	if string(b[4:]) != want {
		t.Fatalf("got %s", b[4:])
	}
}
