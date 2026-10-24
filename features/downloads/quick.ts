// 一鍵下載與右鍵下載的共用邏輯（009，plan 3.11）。純函式，背景腳本與內容腳本共用。
import { pickDefaultFormat } from '@/utils/default-format';
import { formatSize } from '@/utils/format-list';
import { t } from '@/utils/i18n';
import type { HostErrorCode, HostInfo } from '@/utils/native-protocol';
import { toDefaultVideoContainer, toDefaultVideoHeight, type DefaultVideoContainer, type DefaultVideoHeight } from '@/utils/settings';
import { isActive, MP3_BITRATES, type DownloadRequest, type JobRecord, type Mp3Bitrate } from './jobs';

/** 可以一鍵下載的種類（字幕不支援）。 */
export type QuickKind = 'video' | 'mp3';
export const QUICK_KINDS: readonly QuickKind[] = ['video', 'mp3'];

/** 一鍵下載與右鍵下載使用的預設值（009 FR-2、FR-3）。 */
export interface QuickDefaults {
  height: DefaultVideoHeight;
  container: DefaultVideoContainer;
  bitrate: Mp3Bitrate;
}

export const DEFAULT_QUICK_DEFAULTS: QuickDefaults = { height: 1080, container: 'mp4', bitrate: 192 };

const toBitrate = (v: unknown): Mp3Bitrate => ((MP3_BITRATES as readonly unknown[]).includes(v) ? (v as Mp3Bitrate) : 192);

/** 從設定讀到的值整理成預設值（不合法的值改用預設）。 */
export function toQuickDefaults(height: unknown, container: unknown, bitrate: unknown): QuickDefaults {
  return { height: toDefaultVideoHeight(height), container: toDefaultVideoContainer(container), bitrate: toBitrate(bitrate) };
}

// ---------------------------------------------------------------------------
// 文字（工具列提示、右鍵選單、面板）
// ---------------------------------------------------------------------------

/** 預設畫質與格式的簡短說明，例如「1080p MP4」「最高畫質 不限格式」。 */
export function videoSpecLabel(height: DefaultVideoHeight, container: DefaultVideoContainer): string {
  const h = height === 'best' ? t('quickHeightBest') : `${height}p`;
  return t(container === 'mp4' ? 'quickSpecMp4' : 'quickSpecAny', h);
}

/** MP3 的說明，例如「MP3 192 kbps」（與一般下載的標籤相同）。 */
export const mp3SpecLabel = (bitrate: Mp3Bitrate) => `MP3 ${bitrate} kbps`;

/** 工具列「影片」「MP3」按鈕的提示文字（009 FR-7），例如「一鍵下載：1080p MP4」。 */
export function quickTooltip(kind: QuickKind, d: QuickDefaults): string {
  return t('quickTooltip', kind === 'video' ? videoSpecLabel(d.height, d.container) : mp3SpecLabel(d.bitrate));
}

/** 面板中這次下載的說明（009 FR-4），例如「1080p60 MP4，約 320 MB」。 */
export function quickSummary(job: Pick<JobRecord, 'label' | 'estimate'>): string {
  const estimate = job.estimate;
  if (!estimate || estimate.size === null) return job.label;
  return t('quickSummary', [job.label, formatSize(estimate.size, estimate.approx, t('sizeApprox'))]);
}

/** 右鍵選單的文字（009 FR-20、FR-26）：父選單是擴充功能名稱，子項目帶目前的預設值。 */
export function contextMenuTitles(d: QuickDefaults): { parent: string; video: string; mp3: string } {
  return { parent: t('extName'), video: t('menuDownloadVideo', videoSpecLabel(d.height, d.container)), mp3: t('menuDownloadMp3', String(d.bitrate)) };
}

/** 右鍵下載的「開始下載」通知（009 FR-23）：同一部影片、同一種只有一則，取得標題後以同一個 ID 更新。 */
export const startNotificationId = (videoId: string, kind: QuickKind) => `ytm-start:${videoId}:${kind}`;

/** 需要先安裝小幫手的錯誤（009 FR-24）。 */
export const needsHelper = (code: HostErrorCode) => code === 'HOST_UNREACHABLE' || code === 'YTDLP_NOT_FOUND' || code === 'FFMPEG_NOT_FOUND';

// ---------------------------------------------------------------------------
// 選格式（009 FR-2、FR-3、FR-6）
// ---------------------------------------------------------------------------

export type QuickPlan =
  | { ok: true; request: DownloadRequest; estimate: { size: number | null; approx: boolean } | null }
  | { ok: false; error: HostErrorCode };

const isLiveInfo = (info: HostInfo) => info.isLive || info.liveStatus === 'is_live' || info.liveStatus === 'is_upcoming';

/**
 * 依影片資訊與預設值組出下載請求。直播中、首播尚未開始的影片不自動開始（FR-6）；
 * 沒有可下載的影片格式時回傳 FORMAT_UNAVAILABLE。需要登入等情況在 getInfo 就會以錯誤代碼失敗。
 */
export function planQuickDownload(videoId: string, info: HostInfo, kind: QuickKind, d: QuickDefaults, fallbackTitle = ''): QuickPlan {
  if (isLiveInfo(info)) return { ok: false, error: 'LIVE_NOT_SUPPORTED' };
  const title = (info.title || fallbackTitle).slice(0, 500);
  if (kind === 'mp3') {
    return { ok: true, request: { kind: 'mp3', videoId, title, label: mp3SpecLabel(d.bitrate), bitrate: d.bitrate, section: null }, estimate: null };
  }
  const row = pickDefaultFormat(info.formats, { height: d.height, container: d.container });
  if (!row) return { ok: false, error: 'FORMAT_UNAVAILABLE' };
  return {
    ok: true,
    request: {
      kind: 'video',
      videoId,
      title,
      label: `${row.resolution}${row.hdr ? ' HDR' : ''} ${row.container.toUpperCase()}`,
      formatId: row.formatId,
      container: row.container,
      section: null,
    },
    estimate: { size: row.size, approx: row.approx },
  };
}

// ---------------------------------------------------------------------------
// 重複下載（009 FR-5）
// ---------------------------------------------------------------------------

/**
 * 這部影片、這一類最近一次的下載：進行中或已完成時回傳該工作（面板顯示它，不重複下載）；
 * 沒有、或最近一次是失敗或取消時回傳 null（開始新的下載）。工作清單新的在前。
 */
export function existingQuickJob(jobs: readonly JobRecord[], videoId: string, kind: QuickKind): JobRecord | null {
  const active = jobs.find((j) => j.videoId === videoId && j.kind === kind && isActive(j));
  if (active) return active;
  const latest = jobs.find((j) => j.videoId === videoId && j.kind === kind && j.state !== 'cancelled');
  return latest?.state === 'done' ? latest : null;
}

/** 背景腳本的重複判斷（plan 3.11）：同影片＋同種類、狀態為進行中。 */
export const activeJobFor = (jobs: readonly JobRecord[], videoId: string, kind: QuickKind) =>
  jobs.find((j) => j.videoId === videoId && j.kind === kind && isActive(j)) ?? null;

// ---------------------------------------------------------------------------
// 面板一開始顯示什麼（009 FR-4、FR-8、FR-10、FR-11）
// ---------------------------------------------------------------------------

/** quick：直接開始；confirm：顯示「開始下載（1080p MP4）」按鈕；full：完整選項（目前的行為）。 */
export type DownloadMode = 'quick' | 'confirm' | 'full';

/**
 * - 一鍵下載關閉：完整選項（FR-8；安裝完成後也是，FR-11）。
 * - 一鍵下載開啟、使用者剛為這部影片點了按鈕、小幫手一開始就能用：直接開始（FR-4）。
 * - 一鍵下載開啟、但這次打開時顯示過安裝引導（不記住、不自動開始，FR-10、FR-11），或釘選的面板換了影片：
 *   顯示「開始下載」按鈕，按下後才開始。
 */
export function initialDownloadMode(o: { quickEnabled: boolean; clickedForThisVideo: boolean; helperJustInstalled: boolean }): DownloadMode {
  if (!o.quickEnabled) return 'full';
  return o.clickedForThisVideo && !o.helperJustInstalled ? 'quick' : 'confirm';
}
