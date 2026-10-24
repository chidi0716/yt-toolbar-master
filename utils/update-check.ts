// 擴充功能的新版本提醒（008 FR-26 至 FR-29b，plan 3.9）：版本比較、是否該查詢、是否該提醒，以及查詢本身。
//
// 全專案只有這個模組可以出現 GitHub API 的網址（constitution 第 2 點的唯一例外；T47 以測試檢查）。
// 查詢只取最新正式版本的版本號、標題與網址，不帶任何自訂標頭、cookie 或 referrer，不送出任何識別資訊。

/** 本專案最新正式版本（不含預先發行版本）。 */
export const LATEST_RELEASE_API = 'https://api.github.com/repos/chidi0716/yt-toolbar-master/releases/latest';
/** 「前往下載」只會開啟這個前綴的網址（GitHub 的版本頁面）。 */
export const RELEASE_PAGE_PREFIX = 'https://github.com/chidi0716/yt-toolbar-master/releases/';
/** 查詢間隔：每 24 小時最多一次（FR-27）。 */
export const CHECK_INTERVAL_MS = 24 * 60 * 60_000;
/** 查詢逾時。 */
export const FETCH_TIMEOUT_MS = 15_000;
/** 圖示上的標記文字（FR-29a）。 */
export const BADGE_TEXT = 'NEW';

const MAX_TITLE_CHARS = 120;
const VERSION_PATTERN = /^[vV]?(\d{1,6})(?:\.(\d{1,6})){0,3}$/;

export interface LatestRelease {
  /** 去掉開頭 v 的版本號，例如 0.2.0。 */
  version: string;
  /** 版本標題（一行）。 */
  title: string;
  /** 該版本的 GitHub 頁面（已檢查前綴）。 */
  url: string;
}

/** local:updateCheck（plan 3.9）。lastResult 是本實作另外記錄的最近一次結果（設定頁顯示用）。 */
export interface UpdateCheckState {
  lastCheckedAt: number | null;
  latest: LatestRelease | null;
  lastResult: 'ok' | 'failed' | null;
}

/** local:updateReminder（plan 3.9）。 */
export interface UpdateReminderState {
  skippedVersion: string | null;
  disabled: boolean;
  lastCardShownAt: { version: string; at: number } | null;
  handledVersion: string | null;
}

export const EMPTY_CHECK: UpdateCheckState = { lastCheckedAt: null, latest: null, lastResult: null };
export const EMPTY_REMINDER: UpdateReminderState = { skippedVersion: null, disabled: false, lastCardShownAt: null, handledVersion: null };

// ---------------------------------------------------------------------------
// 版本
// ---------------------------------------------------------------------------

/** 版本號的數字部分；格式不對（例如含預先發行標記）時回傳 null。 */
export function parseVersion(value: unknown): number[] | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!VERSION_PATTERN.test(v)) return null;
  return v.replace(/^[vV]/, '').split('.').map(Number);
}

/** 正規化的版本號（去掉 v）；格式不對時回傳 null。 */
export function normalizeVersion(value: unknown): string | null {
  const parts = parseVersion(value);
  return parts ? parts.join('.') : null;
}

/** 比較版本：a > b 為正、相等為 0、a < b 為負；任一方格式不對時回傳 null。缺少的部分視為 0（0.2 = 0.2.0）。 */
export function compareVersions(a: unknown, b: unknown): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** a 是否比 b 新；任一方格式不對時為 false。 */
export const isNewer = (a: unknown, b: unknown): boolean => (compareVersions(a, b) ?? 0) > 0;

// ---------------------------------------------------------------------------
// 查詢結果
// ---------------------------------------------------------------------------

/** 是否為本專案 GitHub 版本頁面的網址（「前往下載」只開啟這種網址）。 */
export function isReleaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300 || !value.startsWith(RELEASE_PAGE_PREFIX)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.href === value &&
    url.pathname.startsWith('/chidi0716/yt-toolbar-master/releases/') &&
    !url.pathname.split('/').includes('..')
  );
}

/** 一行的標題：去掉控制字元與多餘空白，過長時截斷。 */
function oneLine(value: string): string {
  const text = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_TITLE_CHARS ? `${text.slice(0, MAX_TITLE_CHARS - 1)}…` : text;
}

/** 整理 GitHub API 的回應：只取 tag_name、name、html_url；任何一項不合格時回傳 null（丟棄）。 */
export function parseRelease(json: unknown): LatestRelease | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  const version = normalizeVersion(r.tag_name);
  if (!version || !isReleaseUrl(r.html_url)) return null;
  const title = typeof r.name === 'string' ? oneLine(r.name) : '';
  return { version, title: title || `v${version}`, url: r.html_url };
}

/** 讀取 storage 中的值（可能是舊格式或被竄改）並補上預設值。 */
export function normalizeCheckState(value: unknown): UpdateCheckState {
  if (!value || typeof value !== 'object') return { ...EMPTY_CHECK };
  const v = value as Record<string, unknown>;
  const latest = v.latest && typeof v.latest === 'object' ? (v.latest as Record<string, unknown>) : null;
  const version = latest ? normalizeVersion(latest.version) : null;
  return {
    lastCheckedAt: typeof v.lastCheckedAt === 'number' && Number.isFinite(v.lastCheckedAt) ? v.lastCheckedAt : null,
    latest:
      latest && version && isReleaseUrl(latest.url)
        ? { version, title: typeof latest.title === 'string' ? oneLine(latest.title) || `v${version}` : `v${version}`, url: latest.url }
        : null,
    lastResult: v.lastResult === 'ok' || v.lastResult === 'failed' ? v.lastResult : null,
  };
}

export function normalizeReminderState(value: unknown): UpdateReminderState {
  if (!value || typeof value !== 'object') return { ...EMPTY_REMINDER };
  const v = value as Record<string, unknown>;
  const shown = v.lastCardShownAt && typeof v.lastCardShownAt === 'object' ? (v.lastCardShownAt as Record<string, unknown>) : null;
  const shownVersion = shown ? normalizeVersion(shown.version) : null;
  return {
    skippedVersion: normalizeVersion(v.skippedVersion),
    disabled: v.disabled === true,
    lastCardShownAt: shown && shownVersion && typeof shown.at === 'number' && Number.isFinite(shown.at) ? { version: shownVersion, at: shown.at } : null,
    handledVersion: normalizeVersion(v.handledVersion),
  };
}

// ---------------------------------------------------------------------------
// 是否查詢、是否提醒
// ---------------------------------------------------------------------------

/**
 * 只有無法自動更新的安裝方式才查詢與提醒（FR-26）：Chrome 載入未封裝、Firefox／Zen 臨時附加元件，
 * 兩者的 management.getSelf().installType 都是 development。
 */
export const isReminderEligible = (installType: unknown): boolean => installType === 'development';

/** 是否該查詢（FR-27）：可以提醒、沒有選「不再提醒」、距上次查詢 24 小時以上（時鐘倒退時也重新查詢）。 */
export function shouldCheck(input: { eligible: boolean; reminder: UpdateReminderState; check: UpdateCheckState; now: number }): boolean {
  const { eligible, reminder, check, now } = input;
  if (!eligible || reminder.disabled) return false;
  const last = check.lastCheckedAt;
  return last === null || now - last >= CHECK_INTERVAL_MS || now < last;
}

/** 本機日期（每天最多以卡片形式出現一次，FR-28）。 */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export interface ReminderView {
  currentVersion: string;
  /** 是否為需要提醒的安裝方式（FR-26）。 */
  eligible: boolean;
  latest: LatestRelease | null;
  lastCheckedAt: number | null;
  lastResult: 'ok' | 'failed' | null;
  /** 使用者選擇了「不再提醒」。 */
  disabled: boolean;
  /** 有尚未處理的新版本：顯示小圓點、圖示的 NEW 標記，「更多」選單頂端顯示提醒。 */
  pending: boolean;
  /** 今天還沒有以卡片形式出現過（同一版本每天最多一次）。 */
  showCard: boolean;
}

/** 依目前狀態決定要不要提醒、要不要以卡片形式出現（FR-28、FR-29、FR-29a）。 */
export function reminderView(input: {
  currentVersion: string;
  eligible: boolean;
  check: UpdateCheckState;
  reminder: UpdateReminderState;
  now: number;
}): ReminderView {
  const { currentVersion, eligible, check, reminder, now } = input;
  const latest = check.latest;
  const pending =
    eligible &&
    !reminder.disabled &&
    !!latest &&
    isNewer(latest.version, currentVersion) &&
    (reminder.skippedVersion === null || isNewer(latest.version, reminder.skippedVersion)) &&
    (reminder.handledVersion === null || isNewer(latest.version, reminder.handledVersion));
  const shownToday =
    !!latest &&
    reminder.lastCardShownAt !== null &&
    compareVersions(reminder.lastCardShownAt.version, latest.version) === 0 &&
    localDayKey(reminder.lastCardShownAt.at) === localDayKey(now) &&
    reminder.lastCardShownAt.at <= now;
  return {
    currentVersion,
    eligible,
    latest,
    lastCheckedAt: check.lastCheckedAt,
    lastResult: check.lastResult,
    disabled: reminder.disabled,
    pending,
    showCard: pending && !shownToday,
  };
}

export type ReminderAction = 'open' | 'skip' | 'disable' | 'enable' | 'cardShown';
export const REMINDER_ACTIONS: readonly ReminderAction[] = ['open', 'skip', 'disable', 'enable', 'cardShown'];

/** 套用使用者的操作（FR-29）：前往下載＝處理完這個版本、跳過這個版本、不再提醒、重新開啟、卡片出現過。 */
export function applyReminderAction(state: UpdateReminderState, action: ReminderAction, version: string | null, now: number): UpdateReminderState {
  switch (action) {
    case 'open':
      return version ? { ...state, handledVersion: version } : state;
    case 'skip':
      return version ? { ...state, skippedVersion: version } : state;
    case 'disable':
      return { ...state, disabled: true };
    case 'enable':
      return { ...state, disabled: false };
    case 'cardShown':
      return version ? { ...state, lastCardShownAt: { version, at: now } } : state;
  }
}

// ---------------------------------------------------------------------------
// 查詢（背景腳本）
// ---------------------------------------------------------------------------

/**
 * 查詢最新正式版本。不帶任何自訂標頭、cookie 或 referrer；GitHub API 允許跨來源讀取，不需要主機權限（plan 3.9）。
 * 失敗（網路、逾時、格式不對）時回傳 null，由呼叫端安靜略過。
 */
export async function fetchLatestRelease(fetchFn: typeof fetch = fetch): Promise<LatestRelease | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(LATEST_RELEASE_API, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) {
      console.info(`[yt-toolbar-master] update check: HTTP ${res.status}`);
      return null;
    }
    const release = parseRelease(await res.json());
    if (!release) console.info('[yt-toolbar-master] update check: unexpected response');
    return release;
  } catch (err) {
    console.info('[yt-toolbar-master] update check failed', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
