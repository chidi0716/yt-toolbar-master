package ytdlp

import (
	"strings"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
)

// rule 把 yt-dlp 錯誤訊息中的關鍵字（不分大小寫）對應到錯誤代碼。依順序比對，先符合者優先。
type rule struct {
	code     errs.Code
	keywords []string
}

var rules = []rule{
	{errs.FFmpegNotFound, []string{
		"ffmpeg not found", "ffprobe not found", "ffprobe and ffmpeg not found",
		"ffmpeg is not installed", "ffmpeg could not be found",
	}},
	{errs.DiskFull, []string{
		"no space left on device", "not enough space on the disk", "errno 28", "disk quota exceeded",
		"there is not enough space",
	}},
	{errs.PermissionDenied, []string{"permission denied", "errno 13", "access is denied"}},
	// 「確認你不是機器人」的訊息也會提到 --cookies，所以要排在 LOGIN_REQUIRED 前面。
	{errs.VerificationRequired, []string{"not a bot", "confirm you’re not a robot", "confirm you're not a robot"}},
	{errs.LoginRequired, []string{
		"sign in to confirm your age", "age-restricted", "inappropriate for some users",
		"private video", "this video is private", "members-only", "members only",
		"join this channel", "available to this channel's members", "login required",
		"requires authentication", "use --cookies", "account cookies",
	}},
	{errs.LiveNotSupported, []string{
		"this live event will begin", "premieres in", "premiere will begin", "live event will begin",
		"is_upcoming", "live stream recording is not available", "does not pass filter",
	}},
	{errs.VideoUnavailable, []string{
		"video unavailable", "this video has been removed", "video is unavailable",
		"not available in your country", "not made this video available in your country",
		"this video is no longer available", "account associated with this video has been terminated",
		"removed by the uploader", "copyright claim", "this video is not available",
	}},
	{errs.FormatUnavailable, []string{"requested format is not available", "requested format not available"}},
	{errs.NoSubtitles, []string{
		"there are no subtitles", "no subtitles for the requested languages", "has no subtitles",
		"subtitles are not available", "no closed captions",
	}},
	{errs.Network, []string{
		"unable to download webpage", "unable to download api page", "urlopen error", "timed out",
		"connection reset", "connection refused", "connection aborted", "remote end closed connection",
		"temporary failure in name resolution", "name or service not known", "nodename nor servname",
		"getaddrinfo failed", "network is unreachable", "failed to resolve", "no route to host",
		"incomplete read", "ssl: ", "http error 5", "transporterror", "unable to connect",
	}},
	{errs.YtDlpOutdated, []string{
		"no such option", "unable to extract", "nsig extraction failed", "signature extraction failed",
		"please report this issue", "confirm you are on the latest version", "http error 403",
		"only images are available", "update yt-dlp", "outdated",
		"error: unrecognized arguments",
	}},
}

// Classify 依 yt-dlp 的錯誤訊息決定錯誤代碼。lines 是 stderr（與 stdout）中的文字，
// 優先使用 ERROR: 開頭的行；沒有時看全部的行。
func Classify(lines []string) *errs.Error {
	var errLines []string
	for _, l := range lines {
		if strings.HasPrefix(strings.TrimSpace(l), "ERROR:") {
			errLines = append(errLines, l)
		}
	}
	candidates := errLines
	if len(candidates) == 0 {
		candidates = lines
	}
	message := ""
	if len(errLines) > 0 {
		message = CleanErrorMessage(errLines[0])
	}
	text := strings.ToLower(strings.Join(candidates, "\n"))
	for _, r := range rules {
		for _, k := range r.keywords {
			if strings.Contains(text, k) {
				if message == "" {
					message = k
				}
				return &errs.Error{Code: r.code, Message: message}
			}
		}
	}
	if message == "" {
		message = "yt-dlp failed"
		for i := len(lines) - 1; i >= 0; i-- {
			if s := strings.TrimSpace(lines[i]); s != "" {
				message = CleanErrorMessage(s)
				break
			}
		}
	}
	return &errs.Error{Code: errs.Unknown, Message: message}
}
