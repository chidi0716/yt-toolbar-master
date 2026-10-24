// Package protocol 實作瀏覽器原生訊息（Native Messaging）的讀寫（plan 4.2）。
//
// 每則訊息是「4 位元組長度（本機位元組順序）＋ UTF-8 JSON」。
// 依 Chrome 與 MDN 文件：
//   - 橋接程式送給瀏覽器的單一訊息上限為 1 MB；
//   - 瀏覽器送給橋接程式的單一訊息上限為 64 MiB（Chrome）／4 GiB（Firefox）。
//
// 本專案的請求都很小，因此讀取端另外設定較小的上限（MaxIncoming），
// 超過時把內容讀掉丟棄、回報 INVALID_REQUEST，避免佔用大量記憶體。
package protocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sync"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
)

const (
	// MaxOutgoing 是送往瀏覽器的單一訊息上限（Chrome 規定 1 MB）。
	MaxOutgoing = 1024 * 1024
	// MaxIncoming 是橋接程式願意處理的單一請求大小。
	MaxIncoming = 64 * 1024
	// maxDiscard 是超過 MaxIncoming 時仍願意讀掉丟棄的大小（Chrome 的上限）；
	// 更大的長度代表資料流已經錯亂，直接結束連線。
	maxDiscard = 64 * 1024 * 1024
)

// ErrTooLarge 表示收到的訊息超過 MaxIncoming，內容已被丟棄，可以繼續讀下一則。
var ErrTooLarge = errors.New("protocol: incoming message too large")

// ErrCorrupt 表示長度欄位不合理，資料流無法再使用。
var ErrCorrupt = errors.New("protocol: corrupt message length")

// ReadMessage 讀取一則訊息。資料流結束時回傳 io.EOF。
func ReadMessage(r io.Reader) ([]byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		if errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, io.EOF
		}
		return nil, err
	}
	n := binary.NativeEndian.Uint32(hdr[:])
	if n > MaxIncoming {
		if n > maxDiscard {
			return nil, ErrCorrupt
		}
		if _, err := io.CopyN(io.Discard, r, int64(n)); err != nil {
			return nil, io.EOF
		}
		return nil, ErrTooLarge
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, io.EOF
	}
	return buf, nil
}

// EncodeMessage 把值編成一則訊息（含長度）；超過 MaxOutgoing 時回傳錯誤。
func EncodeMessage(v any) ([]byte, error) {
	var body bytes.Buffer
	enc := json.NewEncoder(&body)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	b := bytes.TrimRight(body.Bytes(), "\n")
	if len(b) > MaxOutgoing {
		return nil, errs.New(errs.ResponseTooLarge, "message is %d bytes, limit is %d", len(b), MaxOutgoing)
	}
	out := make([]byte, 4+len(b))
	binary.NativeEndian.PutUint32(out, uint32(len(b)))
	copy(out[4:], b)
	return out, nil
}

// Request 是擴充功能送來的請求：{"id": "...", "cmd": "...", "args": {...}}。
type Request struct {
	ID   string
	Cmd  string
	Args json.RawMessage
}

// Response 是對請求的回應。
type Response struct {
	ID     *string     `json:"id"`
	OK     bool        `json:"ok"`
	Result any         `json:"result,omitempty"`
	Error  *errs.Error `json:"error,omitempty"`
}

// requestIDRe 限制請求 ID 的格式（UUID 或類似的短字串）。
var requestIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// ParseRequest 解析並檢查請求的外層結構；不認得的欄位一律拒絕。
// 回傳的錯誤一律是 INVALID_REQUEST；若 id 本身合法，第二個回傳值是該 id，
// 讓呼叫端可以在錯誤回應中帶回 id。
func ParseRequest(b []byte) (*Request, string, error) {
	var raw struct {
		ID   *string         `json:"id"`
		Cmd  *string         `json:"cmd"`
		Args json.RawMessage `json:"args"`
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&raw); err != nil {
		return nil, "", errs.New(errs.InvalidRequest, "malformed request: %v", err)
	}
	if dec.More() {
		return nil, "", errs.New(errs.InvalidRequest, "trailing data after request")
	}
	if raw.ID == nil || !requestIDRe.MatchString(*raw.ID) {
		return nil, "", errs.New(errs.InvalidRequest, "missing or invalid id")
	}
	id := *raw.ID
	if raw.Cmd == nil || *raw.Cmd == "" {
		return nil, id, errs.New(errs.InvalidRequest, "missing cmd")
	}
	args := raw.Args
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage("{}")
	}
	if args[0] != '{' {
		return nil, id, errs.New(errs.InvalidRequest, "args must be an object")
	}
	return &Request{ID: id, Cmd: *raw.Cmd, Args: args}, id, nil
}

// OKResponse 建立成功回應。
func OKResponse(id string, result any) *Response {
	if result == nil {
		result = struct{}{}
	}
	return &Response{ID: &id, OK: true, Result: result}
}

// ErrorResponse 建立錯誤回應；id 為空字串時回應中的 id 為 null。
func ErrorResponse(id string, err error) *Response {
	r := &Response{OK: false, Error: errs.From(err)}
	if id != "" {
		r.ID = &id
	}
	return r
}

// Writer 把訊息寫到瀏覽器（stdout）。多個 goroutine 可以同時呼叫。
// 寫入失敗（瀏覽器已關閉連線）後，之後的寫入都直接回傳錯誤。
type Writer struct {
	mu     sync.Mutex
	w      io.Writer
	closed bool
}

func NewWriter(w io.Writer) *Writer { return &Writer{w: w} }

// ErrClosed 表示連線已經關閉。
var ErrClosed = errors.New("protocol: connection closed")

// Send 編碼並寫出一則訊息。訊息超過上限時改送對應的錯誤回應（若是回應）。
func (w *Writer) Send(v any) error {
	b, err := EncodeMessage(v)
	if err != nil {
		resp, isResp := v.(*Response)
		if !isResp {
			return err
		}
		id := ""
		if resp.ID != nil {
			id = *resp.ID
		}
		if b, err = EncodeMessage(ErrorResponse(id, err)); err != nil {
			return err
		}
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return ErrClosed
	}
	if _, err := w.w.Write(b); err != nil {
		w.closed = true
		return fmt.Errorf("%w: %v", ErrClosed, err)
	}
	return nil
}

// Close 標記連線已關閉（例如 stdin 結束後），之後的 Send 都回傳 ErrClosed。
func (w *Writer) Close() {
	w.mu.Lock()
	w.closed = true
	w.mu.Unlock()
}

// Closed 回傳連線是否已關閉。
func (w *Writer) Closed() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.closed
}
