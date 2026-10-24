// 下載檔名（002 FR-8、FR-51，plan 3.1）。純函式。
// 檔名預設為「影片標題 [影片ID].副檔名」，移除作業系統不允許的字元。
import { pad2, splitTime } from './time';

/** 標題部分的長度上限（以字元計）；整個檔名還要加上影片 ID、時間與副檔名。 */
export const MAX_TITLE_LENGTH = 150;

/** Windows 保留的裝置名稱（不分大小寫，含副檔名時也不行）。 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * 移除檔名中作業系統不允許的字元：路徑分隔字元與 Windows 不允許的 `<>:"/\|?*`、控制字元；
 * 連續空白合併為一個，去掉前後的空白與點（Windows 不允許結尾是點或空白，開頭的點會變成隱藏檔）。
 * 結果為空時回傳 `fallback`。
 */
export function sanitizeFilename(name: string, fallback = 'video'): string {
  let out = name
    .normalize('NFC')
    // 控制字元（含換行、tab）改成空白
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[<>:"/\\|?*]/g, ' ')
    // Unicode 的方向控制字元會讓檔名在檔案總管中顯示錯亂
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const chars = Array.from(out);
  if (chars.length > MAX_TITLE_LENGTH) out = chars.slice(0, MAX_TITLE_LENGTH).join('').replace(/[\s.]+$/, '');
  if (!out) return fallback;
  return WINDOWS_RESERVED.test(out) ? `_${out}` : out;
}

/** 「影片標題 [影片ID]」；標題為空時只用影片 ID。 */
export function baseFilename(title: string, videoId: string): string {
  const safeId = sanitizeFilename(videoId, 'video');
  const safeTitle = sanitizeFilename(title, '');
  return safeTitle ? `${safeTitle} [${safeId}]` : `[${safeId}]`;
}

/** 檔名中的時間點：不到一小時為 `01m02s`，一小時以上為 `01h02m03s`（002 FR-8、FR-51）。 */
export function timeTag(seconds: number): string {
  const { h, m, s } = splitTime(seconds);
  return h > 0 ? `${pad2(h)}h${pad2(m)}m${pad2(s)}s` : `${pad2(m)}m${pad2(s)}s`;
}

/** 截圖：「影片標題 [影片ID] 01m02s.png」（002 FR-51）。 */
export function screenshotFilename(title: string, videoId: string, seconds: number): string {
  return `${baseFilename(title, videoId)} ${timeTag(seconds)}.png`;
}

/** 縮圖：「影片標題 [影片ID].jpg」（002 FR-8；副檔名依 YouTube 提供的格式）。 */
export function thumbnailFilename(title: string, videoId: string, extension: 'jpg' | 'webp'): string {
  return `${baseFilename(title, videoId)}.${extension}`;
}

export type CaptionFormat = 'srt' | 'vtt' | 'txt';
export const CAPTION_FORMATS: readonly CaptionFormat[] = ['srt', 'vtt', 'txt'];

/** 字幕：「影片標題 [影片ID].語言代碼.srt」（002 FR-8，加上語言代碼以區分不同語言）。 */
export function captionFilename(title: string, videoId: string, languageCode: string, format: CaptionFormat): string {
  const lang = languageCode.replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);
  return `${baseFilename(title, videoId)}${lang ? `.${lang}` : ''}.${format}`;
}
