// 內容腳本 → 背景腳本的訊息型別（plan 3.1）。背景腳本只處理通過驗證的訊息。
// 下載相關的訊息（階段 4a）只帶影片 ID、尺寸代號、字幕網址等經過驗證的值；檔名與縮圖網址由背景腳本組出。
import { isMp3Bitrate, type DownloadRequest, type JobRecord } from '@/features/downloads/jobs';
import { CAPTION_FORMATS, type CaptionFormat } from './filename';
import type { HostErrorCode } from './native-protocol';
import { normalizeVersion, REMINDER_ACTIONS, type ReminderAction } from './update-check';
import { CAPTION_LANGUAGE_PATTERN, isThumbnailKey, validateCaptionUrl, type ThumbnailKey } from './youtube/dom';
import { isRecord, isValidJobId } from './validate';
import { isValidVideoId } from './youtube/page';

/** 標題的長度上限（字元）；過長的部分在檔名中也會被截斷。 */
export const MAX_TITLE_CHARS = 500;
/** 截圖 PNG 的 data URL 長度上限（約 48 MB 的圖片）。 */
export const MAX_SCREENSHOT_DATA_URL = 64 * 1024 * 1024;
export const SCREENSHOT_DATA_URL_PREFIX = 'data:image/png;base64,';

export type ContentMessage =
  /** 開啟擴充功能的設定頁（001 FR-17：說明面板中的連結）。 */
  | { type: 'openOptions' }
  /** 檢查縮圖各尺寸是否存在（002 FR-30）。 */
  | { type: 'getThumbnails'; videoId: string }
  /** 下載某個尺寸的縮圖（002 FR-31）。 */
  | { type: 'downloadThumbnail'; videoId: string; title: string; key: ThumbnailKey }
  /** 儲存截圖（002 FR-50、FR-51）：內容腳本畫好的 PNG。 */
  | { type: 'saveScreenshot'; videoId: string; title: string; seconds: number; dataUrl: string }
  /** 直接下載字幕（002 FR-44）。 */
  | { type: 'downloadCaption'; videoId: string; title: string; languageCode: string; url: string; format: CaptionFormat }
  // ---- 經由橋接程式（階段 4）----
  /** 橋接程式與 yt-dlp、ffmpeg、deno 的狀態（002 FR-2）；refresh 為 true 時不使用暫存。 */
  | { type: 'hostStatus'; refresh: boolean }
  /** 影片資訊與格式清單（同一部影片共用，002 NFR-2）。 */
  | { type: 'getInfo'; videoId: string }
  /** 開始下載（下載資料夾、檔名格式、嵌入資訊由背景腳本依設定補上）。 */
  | { type: 'startDownload'; request: DownloadRequest }
  /**
   * 一鍵下載（009 FR-4、FR-5）：背景腳本取得影片資訊、依預設值選格式後開始下載；同一部影片的同一種下載進行中時
   * 不重複下載，回傳進行中的工作。title 是頁面上的標題（影片資訊沒有標題時使用）。
   */
  | { type: 'quickDownload'; videoId: string; kind: 'video' | 'mp3'; title: string }
  /** 準備中的一鍵下載按了「改用其他畫質」：還沒送出下載時不送出（009 FR-4）。 */
  | { type: 'cancelQuick'; videoId: string; kind: 'video' | 'mp3' }
  | { type: 'cancelJob'; jobId: string }
  /** 在 Finder／檔案總管中顯示完成的檔案（002 FR-5）。 */
  | { type: 'revealJob'; jobId: string }
  /** 目前的下載工作；送出的分頁之後會收到 jobsChanged。 */
  | { type: 'getJobs' }
  /** 設定頁：選擇下載資料夾（002 FR-60）。 */
  | { type: 'pickFolder' }
  /** 更新 yt-dlp（002 FR-6a、FR-60）。 */
  | { type: 'updateYtDlp' }
  /** 設定頁：小幫手的「自動更新」開關（008 FR-24）。 */
  | { type: 'hostSetAutoUpdate'; enabled: boolean }
  /** 設定頁：立即檢查更新（008 FR-24）。 */
  | { type: 'hostCheckUpdates' }
  /** 設定頁：移除下載功能（008 FR-30）。 */
  | { type: 'hostUninstall' }
  /** 作業系統（runtime.getPlatformInfo，內容腳本不能直接呼叫；安裝說明用，plan 3.10）。 */
  | { type: 'platformInfo' }
  // ---- 新版本提醒（008 FR-26 至 FR-29b）----
  /** 影片頁載入完成：到了該查詢的時間就查詢，回傳提醒的狀態。 */
  | { type: 'updateCheck' }
  /** 提醒的狀態（不查詢；設定頁與其他分頁處理提醒後使用）。 */
  | { type: 'updateStatus' }
  /** 卡片、「更多」選單或設定頁的操作。 */
  | { type: 'updateAction'; action: ReminderAction; version: string | null };

/** 背景腳本 → 內容腳本：下載工作改變（002 FR-3、FR-4）。 */
export type BackgroundMessage = { type: 'jobsChanged'; jobs: JobRecord[] };

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'jobsChanged' && Array.isArray((value as { jobs?: unknown }).jobs);
}

export type DownloadError = 'INVALID' | 'NOT_FOUND' | 'FETCH_FAILED' | 'EMPTY' | 'DOWNLOAD_FAILED';

export interface ThumbnailInfo {
  key: ThumbnailKey;
  width: number;
  height: number;
  url: string;
}

export type MessageResponse<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: DownloadError | HostErrorCode };

const isTitle = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TITLE_CHARS;
/** yt-dlp 的格式 ID（與橋接程式的驗證規則相同：每段開頭必須是英數字）。 */
export const FORMAT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,9}(\+[A-Za-z0-9][A-Za-z0-9_-]{0,9})?$/;
/** 字幕語言（橋接程式的 subLang：開頭必須是英數字，不接受 all）。 */
export const SUB_LANG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/;

function isSection(v: unknown): boolean {
  if (v === null) return true;
  if (!isRecord(v)) return false;
  const { start, end } = v;
  return Number.isInteger(start) && Number.isInteger(end) && (start as number) >= 0 && (end as number) > (start as number) && Object.keys(v).length === 2;
}

/** 驗證下載請求；不合法時回傳 false（不帶到橋接程式）。 */
export function isDownloadRequest(v: unknown): v is DownloadRequest {
  if (!isRecord(v) || !isValidVideoId(v.videoId) || !isTitle(v.title) || typeof v.label !== 'string' || v.label.length > 100) return false;
  switch (v.kind) {
    case 'video':
      return typeof v.formatId === 'string' && FORMAT_ID_PATTERN.test(v.formatId) && (v.container === 'mp4' || v.container === 'webm') && isSection(v.section);
    case 'mp3':
      return isMp3Bitrate(v.bitrate) && isSection(v.section);
    case 'subtitle':
      return (
        typeof v.subLang === 'string' &&
        SUB_LANG_PATTERN.test(v.subLang) &&
        v.subLang.toLowerCase() !== 'all' &&
        (CAPTION_FORMATS as readonly unknown[]).includes(v.subFormat) &&
        typeof v.subAuto === 'boolean'
      );
    default:
      return false;
  }
}

export function isContentMessage(value: unknown): value is ContentMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  switch (m.type) {
    case 'openOptions':
      return true;
    case 'getThumbnails':
      return isValidVideoId(m.videoId);
    case 'downloadThumbnail':
      return isValidVideoId(m.videoId) && isTitle(m.title) && isThumbnailKey(m.key);
    case 'saveScreenshot':
      return (
        isValidVideoId(m.videoId) &&
        isTitle(m.title) &&
        typeof m.seconds === 'number' &&
        Number.isFinite(m.seconds) &&
        m.seconds >= 0 &&
        typeof m.dataUrl === 'string' &&
        m.dataUrl.startsWith(SCREENSHOT_DATA_URL_PREFIX) &&
        m.dataUrl.length <= MAX_SCREENSHOT_DATA_URL &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(m.dataUrl.slice(SCREENSHOT_DATA_URL_PREFIX.length, SCREENSHOT_DATA_URL_PREFIX.length + 4096))
      );
    case 'downloadCaption':
      return (
        isValidVideoId(m.videoId) &&
        isTitle(m.title) &&
        typeof m.languageCode === 'string' &&
        CAPTION_LANGUAGE_PATTERN.test(m.languageCode) &&
        validateCaptionUrl(m.url) !== null &&
        (CAPTION_FORMATS as readonly unknown[]).includes(m.format)
      );
    case 'hostStatus':
      return typeof m.refresh === 'boolean';
    case 'getInfo':
      return isValidVideoId(m.videoId);
    case 'startDownload':
      return isDownloadRequest(m.request);
    case 'quickDownload':
      return isValidVideoId(m.videoId) && (m.kind === 'video' || m.kind === 'mp3') && isTitle(m.title);
    case 'cancelQuick':
      return isValidVideoId(m.videoId) && (m.kind === 'video' || m.kind === 'mp3');
    case 'cancelJob':
    case 'revealJob':
      return isValidJobId(m.jobId);
    case 'getJobs':
    case 'pickFolder':
    case 'updateYtDlp':
    case 'updateCheck':
    case 'updateStatus':
    case 'platformInfo':
    case 'hostCheckUpdates':
    case 'hostUninstall':
      return true;
    case 'hostSetAutoUpdate':
      return typeof m.enabled === 'boolean';
    case 'updateAction':
      return (
        (REMINDER_ACTIONS as readonly unknown[]).includes(m.action) &&
        (m.version === null || (typeof m.version === 'string' && normalizeVersion(m.version) === m.version))
      );
    default:
      return false;
  }
}

/** 送訊息給背景腳本（內容腳本、設定頁）；背景腳本沒有回覆或出錯時視為失敗。 */
export async function sendToBackground<T extends Record<string, unknown> = Record<string, never>>(message: ContentMessage): Promise<MessageResponse<T>> {
  try {
    const res = (await browser.runtime.sendMessage(message)) as MessageResponse<T> | undefined;
    return res && typeof res === 'object' && 'ok' in res ? res : { ok: false, error: 'DOWNLOAD_FAILED' };
  } catch (err) {
    console.info('[yt-toolbar-master] background message failed', err);
    return { ok: false, error: 'DOWNLOAD_FAILED' };
  }
}

/** 開啟設定頁（001 FR-17、002 FR-6a）。 */
export const openSettings = () => void sendToBackground({ type: 'openOptions' });
