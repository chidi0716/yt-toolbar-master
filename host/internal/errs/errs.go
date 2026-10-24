// Package errs 定義橋接程式回給擴充功能的固定錯誤代碼（plan 4.2）。
//
// 擴充功能依代碼顯示易懂的訊息（002 FR-6），所以代碼一經發布就不改名；
// Message 只是給記錄檔與除錯用的英文說明，擴充功能不應直接顯示。
package errs

import (
	"errors"
	"fmt"
)

// Code 是固定的錯誤代碼。
type Code string

const (
	// 協定與參數
	InvalidRequest   Code = "INVALID_REQUEST"    // 訊息不是合法的請求（JSON 錯誤、缺少 id 或 cmd、多餘欄位、過大）
	UnknownCommand   Code = "UNKNOWN_COMMAND"    // 指令不在白名單（FR-70）
	InvalidArgs      Code = "INVALID_ARGS"       // 參數沒有通過驗證（FR-71 至 FR-73）
	ResponseTooLarge Code = "RESPONSE_TOO_LARGE" // 回應超過 1MB（Chrome 的上限）

	// 執行環境
	YtDlpNotFound       Code = "YTDLP_NOT_FOUND"
	FFmpegNotFound      Code = "FFMPEG_NOT_FOUND"
	DenoNotFound        Code = "DENO_NOT_FOUND"       // 只在 status 中回報，不阻擋 getInfo 與 download（Q39）
	UnsupportedPlatform Code = "UNSUPPORTED_PLATFORM" // 此作業系統不支援的指令（例如 Linux 上的 pickFolder）

	// yt-dlp 回報的錯誤（依 stderr 分類，見 ytdlp.Classify）
	YtDlpOutdated        Code = "YTDLP_OUTDATED"        // 解析失敗、HTTP 403 等要更新 yt-dlp 的錯誤
	LoginRequired        Code = "LOGIN_REQUIRED"        // 私人、會員限定、年齡限制
	VerificationRequired Code = "VERIFICATION_REQUIRED" // YouTube 要求確認不是機器人
	VideoUnavailable     Code = "VIDEO_UNAVAILABLE"     // 影片不存在、已移除、地區限制
	LiveNotSupported     Code = "LIVE_NOT_SUPPORTED"    // 直播中或尚未開始（FR-1）
	FormatUnavailable    Code = "FORMAT_UNAVAILABLE"    // 指定的格式不存在
	NoSubtitles          Code = "NO_SUBTITLES"          // 指定語言沒有字幕
	Network              Code = "NETWORK"
	DiskFull             Code = "DISK_FULL"
	PermissionDenied     Code = "PERMISSION_DENIED" // 下載資料夾無法寫入
	Timeout              Code = "TIMEOUT"           // yt-dlp 在時限內沒有完成（getInfo、status 等）
	UpdateFailed         Code = "UPDATE_FAILED"     // yt-dlp -U 失敗

	// 工作管理
	JobNotFound    Code = "JOB_NOT_FOUND"
	JobNotFinished Code = "JOB_NOT_FINISHED" // reveal 一個還沒完成的工作
	FileNotFound   Code = "FILE_NOT_FOUND"   // reveal 時檔案已被移動或刪除
	TooManyJobs    Code = "TOO_MANY_JOBS"
	Busy           Code = "BUSY"        // 例如已經有一個選擇資料夾視窗開著
	Interrupted    Code = "INTERRUPTED" // 執行下載的程序意外結束

	// 安裝與自動更新（plan 4.9）
	JobsRunning      Code = "JOBS_RUNNING"      // 有進行中的下載，不能移除下載功能
	ManifestInvalid  Code = "MANIFEST_INVALID"  // components.json 格式不正確，或不是從本專案 GitHub 取得（008 SR-2）
	ChecksumMismatch Code = "CHECKSUM_MISMATCH" // 下載的檔案與清單中的 SHA256 不符

	Unknown Code = "UNKNOWN"
)

// All 列出全部代碼，供測試與文件對照。
var All = []Code{
	InvalidRequest, UnknownCommand, InvalidArgs, ResponseTooLarge,
	YtDlpNotFound, FFmpegNotFound, DenoNotFound, UnsupportedPlatform,
	YtDlpOutdated, LoginRequired, VerificationRequired, VideoUnavailable, LiveNotSupported,
	FormatUnavailable, NoSubtitles, Network, DiskFull, PermissionDenied, Timeout, UpdateFailed,
	JobNotFound, JobNotFinished, FileNotFound, TooManyJobs, Busy, Interrupted,
	JobsRunning, ManifestInvalid, ChecksumMismatch,
	Unknown,
}

// Error 是帶有固定代碼的錯誤。
type Error struct {
	Code    Code   `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string { return string(e.Code) + ": " + e.Message }

// New 建立帶代碼的錯誤。
func New(code Code, format string, a ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, a...)}
}

// From 把任意錯誤轉成 *Error；不是 *Error 的一律視為 UNKNOWN。
func From(err error) *Error {
	if err == nil {
		return nil
	}
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return &Error{Code: Unknown, Message: err.Error()}
}
