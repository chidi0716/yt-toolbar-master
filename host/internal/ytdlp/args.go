package ytdlp

import (
	"fmt"
	"strconv"

	"github.com/chidi0716/yt-toolbar-master/host/internal/validate"
)

// 橋接程式輸出中用來辨識的前綴。yt-dlp 的 %(...)j 會把非 ASCII 字元跳脫成 \uXXXX，
// 因此即使在 Windows 的主控台編碼下，路徑也能完整傳回。
const (
	ProgressPrefix = "YTE-PROGRESS "
	PostPrefix     = "YTE-POST "
	FilePrefix     = "YTE-FILE "
)

// 進度範本：只取需要的欄位，並附上目前下載的格式 ID（影像＋聲音分兩段下載）。
const (
	progressTemplate = `download:` + ProgressPrefix +
		`{"p":%(progress.{status,downloaded_bytes,total_bytes,total_bytes_estimate,speed,eta,fragment_index,fragment_count})j,"f":%(info.format_id)j}`
	postTemplate  = `postprocess:` + PostPrefix + `{"pp":%(progress.postprocessor)j,"s":%(progress.status)j}`
	printTemplate = `after_move:` + FilePrefix + `%(filepath)j`
	// liveFilter 讓 yt-dlp 略過直播中與尚未開始的影片（FR-1），避免無止盡地錄製直播。
	liveFilter = `!is_live & live_status!=?is_live & live_status!=?is_upcoming`
)

// WatchURL 由影片 ID 組出 YouTube 網址（FR-71）。videoID 必須已經通過驗證。
func WatchURL(videoID string) string {
	return "https://www.youtube.com/watch?v=" + videoID
}

// InfoArgs 是 getInfo 使用的參數（plan 4.3）。
func InfoArgs(videoID string) []string {
	return []string{
		"--ignore-config", "--no-playlist", "--no-colors",
		"-J", "--ignore-no-formats-error",
		"--", WatchURL(videoID),
	}
}

// ClipLabel 把秒數轉成檔名用的時間標記，例如 90 → 01m30s、3723 → 01h02m03s（FR-8、Q37：小時補零）。
func ClipLabel(sec int64) string {
	h, m, s := sec/3600, (sec/60)%60, sec%60
	if h > 0 {
		return fmt.Sprintf("%02dh%02dm%02ds", h, m, s)
	}
	return fmt.Sprintf("%02dm%02ds", m, s)
}

// OutputTemplate 回傳 -o 的範本：檔名格式＋（裁切時）時間範圍＋副檔名。
// 範本只由內建的檔名格式與驗證過的整數組成。
func OutputTemplate(d *validate.Download) string {
	p, ok := validate.LookupNamePreset(d.NamePreset)
	if !ok {
		p, _ = validate.LookupNamePreset(validate.DefaultNamePreset)
	}
	t := p.Template
	if d.Section != nil && d.Kind != validate.KindSubtitle {
		t += " " + ClipLabel(d.Section.Start) + "-" + ClipLabel(d.Section.End)
	}
	return t + ".%(ext)s"
}

// DownloadArgs 組出下載用的完整參數（不含執行檔本身）。
// tmpDir 是這個工作專用的暫存資料夾，yt-dlp 的所有輸出都先寫在這裡，
// 完成後再由橋接程式搬到下載資料夾；ffmpeg 為空字串時不加 --ffmpeg-location。
func DownloadArgs(d *validate.Download, tmpDir, ffmpeg string) []string {
	a := []string{
		"--ignore-config", "--no-playlist", "--newline", "--no-colors", "--progress",
		"--progress-template", progressTemplate,
		"--progress-template", postTemplate,
		"--print", printTemplate,
		"--windows-filenames",
		"--match-filters", liveFilter,
		"-P", tmpDir,
		"-o", OutputTemplate(d),
	}
	if ffmpeg != "" {
		a = append(a, "--ffmpeg-location", ffmpeg)
	}
	section := func() {
		if d.Section != nil {
			a = append(a,
				"--download-sections", fmt.Sprintf("*%d-%d", d.Section.Start, d.Section.End),
				"--force-keyframes-at-cuts")
		}
	}
	// 嵌入資訊（004 第 2 節）。裁切時章節的時間無法保證正確，依 004 FR-13 不嵌入章節；
	// --embed-metadata 預設也會嵌入章節，所以要明確加上 --no-embed-chapters。
	embed := func(thumbnail bool) {
		if !d.Embed {
			return
		}
		if thumbnail {
			a = append(a, "--embed-thumbnail")
		}
		a = append(a, "--embed-metadata")
		if d.Section == nil {
			a = append(a, "--embed-chapters")
		} else {
			a = append(a, "--no-embed-chapters")
		}
	}
	switch d.Kind {
	case validate.KindVideo:
		a = append(a, "-f", d.FormatID, "--merge-output-format", d.Container)
		section()
		embed(d.Container != "webm") // WEBM 不支援嵌入封面（004 FR-12）
	case validate.KindMP3:
		a = append(a, "-f", "bestaudio/best", "-x", "--audio-format", "mp3",
			"--audio-quality", strconv.Itoa(d.Bitrate)+"K")
		section()
		embed(true)
	case validate.KindSubtitle:
		a = append(a, "--skip-download")
		if d.SubAuto {
			a = append(a, "--write-auto-subs")
		} else {
			a = append(a, "--write-subs")
		}
		a = append(a, "--sub-langs", d.SubLang, "--sub-format", "vtt")
		if d.SubFormat == "srt" {
			a = append(a, "--convert-subs", "srt")
		}
	}
	return append(a, "--", WatchURL(d.VideoID))
}

// NeedsFFmpeg 回傳這個下載是否需要 ffmpeg。
func NeedsFFmpeg(d *validate.Download) bool {
	switch d.Kind {
	case validate.KindVideo, validate.KindMP3:
		return true
	case validate.KindSubtitle:
		return d.SubFormat == "srt"
	}
	return false
}
