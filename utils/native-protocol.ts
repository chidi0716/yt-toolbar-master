// 與橋接程式（ytm-host）之間的原生訊息協定（plan 4.2、specs/notes/T11-T15-host.md）。純函式與型別。
// 橋接程式的回應與事件一律先經過這裡驗證，欄位型別不對時視為無效（不信任外部程式的輸出）。

export const HOST_NAME = 'com.chidi0716.yt_toolbar_master';

/** 橋接程式的錯誤代碼（筆記中的錯誤代碼表）；另加擴充功能端的 HOST_UNREACHABLE（找不到或無法啟動橋接程式）。 */
export const HOST_ERROR_CODES = [
  'INVALID_REQUEST',
  'UNKNOWN_COMMAND',
  'INVALID_ARGS',
  'RESPONSE_TOO_LARGE',
  'YTDLP_NOT_FOUND',
  'FFMPEG_NOT_FOUND',
  'DENO_NOT_FOUND',
  'UNSUPPORTED_PLATFORM',
  'YTDLP_OUTDATED',
  'LOGIN_REQUIRED',
  'VERIFICATION_REQUIRED',
  'VIDEO_UNAVAILABLE',
  'LIVE_NOT_SUPPORTED',
  'FORMAT_UNAVAILABLE',
  'NO_SUBTITLES',
  'NETWORK',
  'DISK_FULL',
  'PERMISSION_DENIED',
  'TIMEOUT',
  'UPDATE_FAILED',
  'JOB_NOT_FOUND',
  'JOB_NOT_FINISHED',
  'FILE_NOT_FOUND',
  'TOO_MANY_JOBS',
  'BUSY',
  'INTERRUPTED',
  // 008（plan 4.9）
  'JOBS_RUNNING',
  'MANIFEST_INVALID',
  'CHECKSUM_MISMATCH',
  'UNKNOWN',
  'HOST_UNREACHABLE',
] as const;
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

export function toErrorCode(value: unknown): HostErrorCode {
  return (HOST_ERROR_CODES as readonly unknown[]).includes(value) ? (value as HostErrorCode) : 'UNKNOWN';
}

export type HostCommand =
  | 'status'
  | 'getInfo'
  | 'download'
  | 'cancel'
  | 'jobs'
  | 'reveal'
  | 'pickFolder'
  | 'updateYtDlp'
  // 008（plan 4.9）
  | 'setAutoUpdate'
  | 'checkUpdates'
  | 'uninstall';

/** 下載途中的特殊階段（008 FR-22：遇到 YTDLP_OUTDATED 等錯誤時先更新 yt-dlp 再重試）。 */
export type JobStage = 'updating-ytdlp';
const STAGES: readonly string[] = ['updating-ytdlp'];
const toStage = (v: unknown): JobStage | null => (typeof v === 'string' && STAGES.includes(v) ? (v as JobStage) : null);

export type JobKind = 'video' | 'mp3' | 'subtitle';
export type JobState = 'queued' | 'downloading' | 'processing' | 'done' | 'failed' | 'cancelled';
export const FINAL_STATES: readonly JobState[] = ['done', 'failed', 'cancelled'];

export interface HostError {
  code: HostErrorCode;
  message: string;
}

export type HostMessage =
  | { kind: 'response'; id: string; ok: true; result: Record<string, unknown> }
  | { kind: 'response'; id: string | null; ok: false; error: HostError }
  | { kind: 'progress'; jobId: string; videoId: string; jobKind: JobKind; state: 'downloading' | 'processing'; percent: number | null; speed: number | null; eta: number | null; part: number | null; parts: number | null; stage?: JobStage | null }
  /** 只帶 jobId 與 stage 的進度事件（plan 4.9：{"event":"progress","jobId":…,"stage":"updating-ytdlp"}）。 */
  | { kind: 'stage'; jobId: string; stage: JobStage }
  | { kind: 'done'; jobId: string; videoId: string; jobKind: JobKind; path: string; fileName: string }
  | { kind: 'failed'; jobId: string; videoId: string; jobKind: JobKind; error: HostError };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const KINDS: readonly string[] = ['video', 'mp3', 'subtitle'];

function parseError(v: unknown): HostError {
  const e = isRecord(v) ? v : {};
  return { code: toErrorCode(e.code), message: (str(e.message) ?? '').slice(0, 500) };
}

/** 驗證橋接程式送來的一則訊息；看不懂時回傳 null（忽略）。 */
export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isRecord(raw)) return null;
  if ('event' in raw) {
    const jobId = str(raw.jobId);
    const stage = toStage(raw.stage);
    if (raw.event === 'progress' && stage && jobId && JOB_ID_PATTERN.test(jobId) && (raw.videoId === undefined || raw.kind === undefined)) {
      return { kind: 'stage', jobId, stage };
    }
    const videoId = str(raw.videoId);
    const jobKind = str(raw.kind);
    if (!jobId || !JOB_ID_PATTERN.test(jobId) || !videoId || !VIDEO_ID_PATTERN.test(videoId) || !jobKind || !KINDS.includes(jobKind)) return null;
    const base = { jobId, videoId, jobKind: jobKind as JobKind };
    switch (raw.event) {
      case 'progress': {
        const percent = num(raw.percent);
        return {
          kind: 'progress',
          ...base,
          state: raw.state === 'processing' ? 'processing' : 'downloading',
          percent: percent === null ? null : Math.min(100, Math.max(0, percent)),
          speed: num(raw.speed),
          eta: num(raw.eta),
          part: num(raw.part),
          parts: num(raw.parts),
          stage,
        };
      }
      case 'done': {
        const fileName = str(raw.fileName);
        const path = str(raw.path);
        return fileName && path ? { kind: 'done', ...base, path, fileName } : null;
      }
      case 'failed':
        return { kind: 'failed', ...base, error: parseError(raw.error) };
      default:
        return null;
    }
  }
  const id = raw.id === null ? null : str(raw.id);
  if (id === undefined || typeof raw.ok !== 'boolean') return null;
  if (raw.ok) {
    if (id === null || !isRecord(raw.result)) return null;
    return { kind: 'response', id, ok: true, result: raw.result };
  }
  return { kind: 'response', id, ok: false, error: parseError(raw.error) };
}

// ---------------------------------------------------------------------------
// 結果的型別與整理（只取擴充功能用到的欄位）
// ---------------------------------------------------------------------------

/** status 的結果（plan 4.9，階段 11 起的格式）：只取擴充功能會讀的欄位。 */
export interface HostStatusResult {
  hostVersion: string;
  /** yt-dlp 與 ffmpeg 都可以使用（可以下載）。 */
  ready: boolean;
  /** 另外 deno 也可以使用（T15a）。 */
  complete: boolean;
  /** 各元件的狀態、版本、位置與來源（008 FR-24），依 COMPONENT_NAMES 的順序。 */
  components: HostComponentInfo[];
  defaultDir: string;
  namePresets: Array<{ id: string; example: string }>;
  /** 自動更新的狀態（008 FR-24、FR-25）；沒有回報時為 null。 */
  update: HostUpdateInfo | null;
}

export const COMPONENT_NAMES = ['helper', 'yt-dlp', 'deno', 'ffmpeg', 'ffprobe'] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];
export const COMPONENT_SOURCES = ['bundled', 'homebrew', 'winget', 'path'] as const;
export type ComponentSource = (typeof COMPONENT_SOURCES)[number];

export interface HostComponentInfo {
  name: ComponentName;
  found: boolean;
  version: string | null;
  path: string | null;
  /** bundled：小幫手安裝的；homebrew、winget：套件管理工具；path：系統上原本就有的。不明時為 null。 */
  source: ComponentSource | null;
  /** 找到了但無法執行時的錯誤代碼；其他情況為 null。 */
  error: string | null;
}

export interface HostUpdateInfo {
  /** 「自動更新」開關（預設開啟）。 */
  auto: boolean;
  /** 最近一次檢查的時間（毫秒）；從未檢查時為 null。 */
  lastCheck: number | null;
  lastResult: 'ok' | 'updated' | 'failed' | null;
  consecutiveFailures: number;
  /** 正在檢查或更新。 */
  running: boolean;
}

/** 時間：接受 ISO 8601 字串、毫秒或秒（plan 4.9 沒有規定格式）。 */
export function parseTime(v: unknown): number | null {
  if (typeof v === 'string' && v) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  return null;
}

function parseComponents(v: unknown): HostComponentInfo[] {
  const out: HostComponentInfo[] = [];
  for (const c of Array.isArray(v) ? v : []) {
    if (!isRecord(c) || !(COMPONENT_NAMES as readonly unknown[]).includes(c.name)) continue;
    if (out.some((o) => o.name === c.name)) continue;
    out.push({
      name: c.name as ComponentName,
      found: c.found === true,
      version: str(c.version)?.slice(0, 64) || null,
      path: str(c.path)?.slice(0, 1024) || null,
      source: (COMPONENT_SOURCES as readonly unknown[]).includes(c.source) ? (c.source as ComponentSource) : null,
      error: str(c.error)?.slice(0, 64) || null,
    });
  }
  return COMPONENT_NAMES.flatMap((n) => out.filter((o) => o.name === n));
}

function parseUpdateInfo(v: unknown): HostUpdateInfo | null {
  if (!isRecord(v)) return null;
  const failures = num(v.consecutiveFailures);
  return {
    auto: v.auto !== false,
    lastCheck: parseTime(v.lastCheck),
    lastResult: v.lastResult === 'ok' || v.lastResult === 'updated' || v.lastResult === 'failed' ? v.lastResult : null,
    consecutiveFailures: failures !== null && failures > 0 ? Math.floor(failures) : 0,
    running: v.running === true,
  };
}

export function parseStatus(result: Record<string, unknown>): HostStatusResult {
  const presets = Array.isArray(result.namePresets) ? result.namePresets : [];
  const ready = result.ready === true;
  return {
    hostVersion: str(result.hostVersion) ?? '',
    ready,
    complete: ready && result.complete === true,
    components: parseComponents(result.components),
    defaultDir: str(result.defaultDir) ?? '',
    namePresets: presets
      .filter(isRecord)
      .map((p) => ({ id: str(p.id) ?? '', example: str(p.example) ?? '' }))
      .filter((p) => /^[a-z-]{1,32}$/.test(p.id)),
    update: parseUpdateInfo(result.update),
  };
}

export interface HostFormat {
  id: string;
  ext: string;
  vcodec: string;
  acodec: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  tbr: number | null;
  abr: number | null;
  filesize: number | null;
  filesizeApprox: number | null;
  protocol: string;
  dynamicRange: string;
  note: string;
}

export interface HostInfo {
  title: string;
  duration: number | null;
  liveStatus: string;
  isLive: boolean;
  formats: HostFormat[];
}

export function parseInfo(result: Record<string, unknown>): HostInfo {
  const formats = (Array.isArray(result.formats) ? result.formats : []).filter(isRecord).map(
    (f): HostFormat => ({
      id: str(f.id) ?? '',
      ext: str(f.ext) ?? '',
      vcodec: str(f.vcodec) ?? '',
      acodec: str(f.acodec) ?? '',
      width: num(f.width),
      height: num(f.height),
      fps: num(f.fps),
      tbr: num(f.tbr),
      abr: num(f.abr),
      filesize: num(f.filesize),
      filesizeApprox: num(f.filesizeApprox),
      protocol: str(f.protocol) ?? '',
      dynamicRange: str(f.dynamicRange) ?? '',
      note: str(f.note) ?? '',
    }),
  );
  return {
    title: str(result.title) ?? '',
    duration: num(result.duration),
    liveStatus: str(result.liveStatus) ?? '',
    isLive: result.isLive === true,
    formats: formats.filter((f) => f.id),
  };
}

export interface HostJob {
  jobId: string;
  videoId: string;
  kind: JobKind;
  state: JobState;
  percent: number | null;
  speed: number | null;
  eta: number | null;
  fileName: string | null;
  error: HostError | null;
  missed: boolean;
}

const STATES: readonly string[] = ['queued', 'downloading', 'processing', 'done', 'failed', 'cancelled'];

export function parseJobs(result: Record<string, unknown>): HostJob[] {
  const list = Array.isArray(result.jobs) ? result.jobs : [];
  const out: HostJob[] = [];
  for (const j of list) {
    if (!isRecord(j)) continue;
    const jobId = str(j.jobId);
    const videoId = str(j.videoId);
    const kind = str(j.kind);
    const state = str(j.state);
    if (!jobId || !JOB_ID_PATTERN.test(jobId) || !videoId || !VIDEO_ID_PATTERN.test(videoId) || !kind || !KINDS.includes(kind) || !state || !STATES.includes(state)) continue;
    out.push({
      jobId,
      videoId,
      kind: kind as JobKind,
      state: state as JobState,
      percent: num(j.percent),
      speed: num(j.speed),
      eta: num(j.eta),
      fileName: str(j.fileName),
      error: isRecord(j.error) ? parseError(j.error) : null,
      missed: j.missed === true,
    });
  }
  return out;
}

export interface UpdateResult {
  ran: boolean;
  updated: boolean;
  command: string | null;
  version: string | null;
}

export function parseUpdate(result: Record<string, unknown>): UpdateResult {
  return {
    ran: result.ran === true,
    updated: result.updated === true,
    command: str(result.command),
    version: str(result.version),
  };
}
