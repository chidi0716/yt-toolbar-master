// 經由橋接程式的下載工作（002 FR-3 至 FR-7、FR-6a、FR-6b，plan 3.8）：工作紀錄、事件套用、錯誤訊息對應、
// 進度文字。純函式，背景腳本與內容腳本共用。
import { formatNumber, type MessageKey } from '@/utils/i18n';
import type { HostEvent } from '@/utils/native';
import { FINAL_STATES, type HostErrorCode, type HostJob, type JobKind, type JobStage, type JobState } from '@/utils/native-protocol';

/** 內容腳本送給背景腳本的下載請求（下載資料夾、檔名格式、嵌入資訊由背景腳本依設定補上）。 */
export type DownloadRequest =
  | { kind: 'video'; videoId: string; title: string; label: string; formatId: string; container: 'mp4' | 'webm'; section: { start: number; end: number } | null }
  | { kind: 'mp3'; videoId: string; title: string; label: string; bitrate: Mp3Bitrate; section: { start: number; end: number } | null }
  | { kind: 'subtitle'; videoId: string; title: string; label: string; subLang: string; subFormat: 'srt' | 'vtt' | 'txt'; subAuto: boolean };

export const MP3_BITRATES = [64, 128, 192, 256, 320] as const;
export type Mp3Bitrate = (typeof MP3_BITRATES)[number];

export interface JobRecord {
  jobId: string;
  videoId: string;
  kind: JobKind;
  /** 面板與通知中顯示的說明（例如「1080p MP4」「MP3 192 kbps」「英文 SRT」）。 */
  label: string;
  title: string;
  state: JobState;
  /** 0–100；沒有百分比時為 null（FR-6b：不確定進度）。 */
  percent: number | null;
  /** 位元組／秒。 */
  speed: number | null;
  /** 秒。 */
  eta: number | null;
  fileName: string | null;
  error: HostErrorCode | null;
  /** 正在自動更新 yt-dlp 後重試（008 FR-22）；舊的紀錄沒有這個欄位。 */
  stage?: JobStage | null;
  /** 重試用的原始請求（瀏覽器重新啟動後從橋接程式補回的工作沒有）。 */
  request: DownloadRequest | null;
  /** 一鍵下載與右鍵下載時選到的格式的大小（009 FR-4：面板顯示「約 320 MB」）；其他下載沒有。 */
  estimate?: { size: number | null; approx: boolean } | null;
  createdAt: number;
  updatedAt: number;
}

export const isFinal = (state: JobState) => FINAL_STATES.includes(state);
export const isActive = (job: JobRecord) => !isFinal(job.state);

/** 已結束的工作保留的數量與時間（面板只列出目前影片的工作）。 */
export const MAX_FINISHED_JOBS = 50;
export const FINISHED_TTL_MS = 24 * 60 * 60_000;

/** 新的工作（download 指令回應 jobId 之後）。 */
export function newJob(jobId: string, request: DownloadRequest, now: number, estimate: JobRecord['estimate'] = null): JobRecord {
  return {
    estimate,
    jobId,
    videoId: request.videoId,
    kind: request.kind,
    label: request.label,
    title: request.title,
    state: 'queued',
    percent: null,
    speed: null,
    eta: null,
    fileName: null,
    error: null,
    request,
    createdAt: now,
    updatedAt: now,
  };
}

/** 把橋接程式的事件套用到工作清單。未知的工作（例如瀏覽器重新啟動前開始的）也會加入。 */
export function applyEvent(jobs: readonly JobRecord[], event: HostEvent, now: number): JobRecord[] {
  const index = jobs.findIndex((j) => j.jobId === event.jobId);
  if (event.kind === 'stage') {
    // 只更新已知、進行中的工作：顯示「正在更新 yt-dlp…」與不確定的進度。
    const job = index >= 0 ? jobs[index]! : null;
    if (!job || isFinal(job.state)) return [...jobs];
    const out = [...jobs];
    out[index] = { ...job, state: 'downloading', stage: event.stage, percent: null, speed: null, eta: null, updatedAt: now };
    return out;
  }
  const base: JobRecord =
    index >= 0
      ? jobs[index]!
      : {
          jobId: event.jobId,
          videoId: event.videoId,
          kind: event.jobKind,
          label: '',
          title: '',
          state: 'queued',
          percent: null,
          speed: null,
          eta: null,
          fileName: null,
          error: null,
          request: null,
          createdAt: now,
          updatedAt: now,
        };
  // 已結束的工作不再被延遲送達的進度事件改回進行中。
  if (isFinal(base.state) && event.kind === 'progress') return [...jobs];
  let next: JobRecord;
  switch (event.kind) {
    case 'progress':
      next = { ...base, state: event.state, percent: event.percent, speed: event.speed, eta: event.eta, stage: event.stage ?? null, updatedAt: now };
      break;
    case 'done':
      next = { ...base, state: 'done', percent: 100, speed: null, eta: null, fileName: event.fileName, error: null, stage: null, updatedAt: now };
      break;
    case 'failed':
      next = { ...base, state: 'failed', speed: null, eta: null, error: event.error.code, stage: null, updatedAt: now };
      break;
  }
  const out = [...jobs];
  if (index >= 0) out[index] = next;
  else out.unshift(next);
  return out;
}

/** 重新連線後以橋接程式的 jobs 結果更新清單（狀態以橋接程式為準）。 */
export function mergeHostJobs(jobs: readonly JobRecord[], host: readonly HostJob[], now: number): JobRecord[] {
  const out = [...jobs];
  for (const h of host) {
    const index = out.findIndex((j) => j.jobId === h.jobId);
    const prev = index >= 0 ? out[index]! : null;
    if (!prev && isFinal(h.state) && !h.missed) continue; // 以前的工作，不需要列出
    const next: JobRecord = {
      ...(prev ?? newJob(h.jobId, { kind: 'subtitle', videoId: h.videoId, title: '', label: '', subLang: 'en', subFormat: 'srt', subAuto: false }, now)),
      kind: h.kind,
      videoId: h.videoId,
      request: prev?.request ?? null,
      state: h.state,
      percent: h.state === 'done' ? 100 : h.percent,
      speed: isFinal(h.state) ? null : h.speed,
      eta: isFinal(h.state) ? null : h.eta,
      fileName: h.fileName ?? prev?.fileName ?? null,
      error: h.error?.code ?? null,
      updatedAt: now,
    };
    if (index >= 0) out[index] = next;
    else out.unshift(next);
  }
  return out;
}

/** 進行中的工作不存在於橋接程式（例如橋接程式的紀錄被刪除）時，標記為中斷。 */
export function markMissing(jobs: readonly JobRecord[], host: readonly HostJob[], now: number): JobRecord[] {
  const known = new Set(host.map((h) => h.jobId));
  return jobs.map((j) => (isActive(j) && !known.has(j.jobId) ? { ...j, state: 'failed', error: 'INTERRUPTED', speed: null, eta: null, updatedAt: now } : j));
}

/**
 * 其他影片進行中的下載（009 FR-23：右鍵下載的工作也出現在每個 YouTube 分頁的下載面板中，可以取消）。
 * 這部影片的下載由各面板自己的清單列出。
 */
export function otherActiveJobs(jobs: readonly JobRecord[], videoId: string): JobRecord[] {
  return jobs.filter((j) => j.videoId !== videoId && isActive(j));
}

/** 只保留進行中的工作與最近結束的工作。 */
export function pruneJobs(jobs: readonly JobRecord[], now: number): JobRecord[] {
  let finished = 0;
  return jobs.filter((j) => {
    if (isActive(j)) return true;
    if (now - j.updatedAt > FINISHED_TTL_MS) return false;
    return ++finished <= MAX_FINISHED_JOBS;
  });
}

// ---------------------------------------------------------------------------
// 錯誤訊息（002 FR-6a）
// ---------------------------------------------------------------------------

export type ErrorAction = 'install' | 'update' | 'settings' | null;

export interface ErrorInfo {
  message: MessageKey;
  /** 附加的操作：顯示安裝說明、更新 yt-dlp、開啟設定頁。 */
  action: ErrorAction;
  /** 是否提供「重試」。 */
  retry: boolean;
}

export function errorInfo(code: HostErrorCode | null): ErrorInfo {
  switch (code) {
    case 'HOST_UNREACHABLE':
    case 'YTDLP_NOT_FOUND':
    case 'FFMPEG_NOT_FOUND':
      return { message: 'errMissingTools', action: 'install', retry: true };
    case 'YTDLP_OUTDATED':
    case 'VERIFICATION_REQUIRED':
      return { message: 'errOutdated', action: 'update', retry: true };
    case 'LOGIN_REQUIRED':
      return { message: 'errLoginRequired', action: null, retry: false };
    case 'VIDEO_UNAVAILABLE':
      return { message: 'errVideoUnavailable', action: null, retry: false };
    case 'LIVE_NOT_SUPPORTED':
      return { message: 'liveUnavailable', action: null, retry: false };
    case 'FORMAT_UNAVAILABLE':
      return { message: 'errFormatUnavailable', action: null, retry: true };
    case 'NO_SUBTITLES':
      return { message: 'errNoSubtitles', action: null, retry: false };
    case 'NETWORK':
    case 'TIMEOUT':
      return { message: 'errNetwork', action: null, retry: true };
    case 'DISK_FULL':
    case 'PERMISSION_DENIED':
      return { message: 'errCannotWrite', action: 'settings', retry: true };
    case 'TOO_MANY_JOBS':
      return { message: 'errTooManyJobs', action: null, retry: true };
    case 'JOBS_RUNNING':
      return { message: 'errJobsRunning', action: null, retry: true };
    case 'MANIFEST_INVALID':
    case 'CHECKSUM_MISMATCH':
      return { message: 'errVerifyFailed', action: null, retry: true };
    default:
      return { message: 'errDownloadFailed', action: null, retry: true };
  }
}

// ---------------------------------------------------------------------------
// 進度文字（002 FR-3）
// ---------------------------------------------------------------------------

/** 速度：例如「1.2 MB/s」。 */
export function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !(bytesPerSecond > 0)) return '';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = bytesPerSecond;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${formatNumber(u === 0 ? Math.round(v) : v, u === 0 ? 0 : 1)} ${units[u]}`;
}

/** 剩餘時間：例如「01:23」「1:02:03」。 */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 工具列按鈕的進度環（FR-3）：這部影片該類下載中最慢的一個；沒有百分比時為不確定（FR-6b）。 */
export function buttonProgress(jobs: readonly JobRecord[], videoId: string, kind: JobKind): number | 'indeterminate' | null {
  const active = jobs.filter((j) => j.videoId === videoId && j.kind === kind && isActive(j));
  if (active.length === 0) return null;
  const known = active.map((j) => j.percent).filter((p): p is number => p !== null && active.length > 0);
  if (known.length < active.length || active.some((j) => j.state === 'processing' && j.percent === null)) return 'indeterminate';
  return Math.min(...known);
}
