// 橋接程式的連線狀態（002 FR-2，tasks T16、T22）：由背景腳本以 status 指令查詢。
// 必要元件為橋接程式、yt-dlp、ffmpeg、deno；ready（yt-dlp 與 ffmpeg 可用）時可以下載，只缺 deno 時顯示建議安裝的提示。
import { t, type MessageKey } from '@/utils/i18n';
import type { ComponentName, ComponentSource, HostComponentInfo, HostStatusResult } from '@/utils/native-protocol';

/** 面板與設定頁列出的元件（ffprobe 與 ffmpeg 一起安裝，不另外列出）。 */
export const HOST_COMPONENTS = ['helper', 'yt-dlp', 'ffmpeg', 'deno'] as const satisfies readonly ComponentName[];
export type HostComponent = (typeof HOST_COMPONENTS)[number];

export const COMPONENT_LABELS: Record<HostComponent, MessageKey> = {
  helper: 'hostComponentHelper',
  'yt-dlp': 'hostComponentYtDlp',
  ffmpeg: 'hostComponentFfmpeg',
  deno: 'hostComponentDeno',
};

export type HostState =
  | { state: 'unreachable' }
  /** 橋接程式可以連線；status.ready 為 false 時缺少 yt-dlp 或 ffmpeg。 */
  | { state: 'connected'; status: HostStatusResult };

/** README 的安裝章節（QUESTIONS Q33）。 */
export const INSTALL_GUIDE_URL = 'https://github.com/chidi0716/yt-toolbar-master#install-the-helper';

/** 可以下載（yt-dlp 與 ffmpeg 都可用）。 */
export const canDownload = (s: HostState): s is Extract<HostState, { state: 'connected' }> => s.state === 'connected' && s.status.ready;

export interface ComponentView {
  /** 可以使用；null 表示無法確認（找不到橋接程式，或沒有回報這個元件）。 */
  ok: boolean | null;
  version: string | null;
  /** status.components 中的這一項（路徑與來源）。 */
  info: HostComponentInfo | null;
}

/** 元件的狀態；全部以 status.components 為準（小幫手本身另外以能否連線判斷）。 */
export function component(s: HostState | null, name: HostComponent): ComponentView {
  if (s?.state !== 'connected') return { ok: name === 'helper' && s ? false : null, version: null, info: null };
  const info = s.status.components.find((c) => c.name === name) ?? null;
  if (name === 'helper') return { ok: true, version: s.status.hostVersion || null, info };
  if (!info) return { ok: null, version: null, info: null };
  return { ok: info.found && !info.error, version: info.found ? info.version : null, info };
}

/** 元件列的狀態文字：版本、已找到、未安裝、缺少或無法確認。 */
export function componentText(s: HostState, name: HostComponent): { text: string; missing: boolean } {
  const { ok, version } = component(s, name);
  if (!ok) return { text: t(name === 'helper' ? 'hostStatusNotInstalled' : ok === null ? 'hostStatusUnknown' : 'hostStatusMissing'), missing: true };
  return { text: version ? t('hostStatusVersion', version) : t('hostStatusFound'), missing: false };
}

const SOURCE_LABELS: Record<ComponentSource, MessageKey> = {
  bundled: 'componentSourceBundled',
  homebrew: 'componentSourceHomebrew',
  winget: 'componentSourceWinget',
  path: 'componentSourcePath',
};

/** 元件的來源文字（008 FR-24，例如「小幫手安裝」「Homebrew」）；不明時為 null。 */
export const sourceLabel = (info: HostComponentInfo | null): string | null => (info?.source ? t(SOURCE_LABELS[info.source]) : null);

/** 只缺 deno（可以下載，但建議安裝，T15a）。 */
export const missingOnlyDeno = (s: HostState) => canDownload(s) && component(s, 'deno').ok === false;

/** 自動更新連續失敗幾次以上才在下載面板提示（008 FR-25）。 */
export const UPDATE_FAILURE_HINT_AT = 3;

// ---------------------------------------------------------------------------
// 背景腳本的狀態快取（009 FR-10a，tasks T57）
// ---------------------------------------------------------------------------

/** 可以下載的結果保留這麼久，連續打開面板時不必每次都啟動小幫手查詢。 */
export const STATUS_TTL_MS = 60_000;

/**
 * 只有「可以下載、而且元件齊全」的結果可以快取。未安裝（查詢失敗）、缺少 yt-dlp／ffmpeg、或缺少 deno 的結果都不快取：
 * 使用者照著說明補裝後再打開面板，就會立即重新偵測，不會看到舊的畫面（FR-10a）。
 */
export const isCacheableStatus = (status: HostStatusResult) => status.ready && status.complete;

export interface StatusCache {
  /** 未過期的快取結果；沒有時為 null。 */
  get(): HostStatusResult | null;
  /** 記下最新的結果；不能快取的結果會清除舊的快取。 */
  put(status: HostStatusResult): void;
  clear(): void;
}

export function createStatusCache(now: () => number = Date.now, ttlMs = STATUS_TTL_MS): StatusCache {
  let entry: { at: number; value: HostStatusResult } | null = null;
  return {
    get() {
      if (!entry) return null;
      const age = now() - entry.at;
      if (age < 0 || age >= ttlMs) {
        entry = null;
        return null;
      }
      return entry.value;
    },
    put(status) {
      entry = isCacheableStatus(status) ? { at: now(), value: status } : null;
    },
    clear() {
      entry = null;
    },
  };
}

/** 下載面板是否顯示「自動更新連續失敗」的一行提示：失敗 3 次以上、且這次的失敗沒有被使用者關閉。 */
export function showUpdateFailureHint(s: HostState, dismissedAt: number | null): boolean {
  if (s.state !== 'connected' || !s.status.update) return false;
  const u = s.status.update;
  return u.consecutiveFailures >= UPDATE_FAILURE_HINT_AT && (dismissedAt === null || u.lastCheck === null || u.lastCheck !== dismissedAt);
}
