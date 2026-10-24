// 橋接程式的連線狀態（002 FR-2，tasks T16、T22）：由背景腳本以 status 指令查詢。
// 必要元件為橋接程式、yt-dlp、ffmpeg、deno；ready（yt-dlp 與 ffmpeg 可用）時可以下載，只缺 deno 時顯示建議安裝的提示。
import type { HostStatusResult } from '@/utils/native-protocol';
import { INSTALL_COMMANDS } from './install-guide';
import type { HostOs } from './logic';

export type HostComponent = 'host' | 'ytDlp' | 'ffmpeg' | 'deno';
export const HOST_COMPONENTS: readonly HostComponent[] = ['host', 'ytDlp', 'ffmpeg', 'deno'];

export type HostState =
  | { state: 'unreachable' }
  /** 橋接程式可以連線；status.ready 為 false 時缺少 yt-dlp 或 ffmpeg。 */
  | { state: 'connected'; status: HostStatusResult };

/** README 的安裝章節（QUESTIONS Q33）。 */
export const INSTALL_GUIDE_URL = 'https://github.com/chidi0716/yt-toolbar-master#install-the-helper';

/** 可以下載（yt-dlp 與 ffmpeg 都可用）。 */
export const canDownload = (s: HostState): s is Extract<HostState, { state: 'connected' }> => s.state === 'connected' && s.status.ready;

/** 各元件是否可用；null 表示無法確認（找不到橋接程式，或舊版橋接程式沒有回報 deno）。 */
export function componentState(s: HostState, c: HostComponent): boolean | null {
  if (c === 'host') return s.state === 'connected';
  if (s.state !== 'connected') return null;
  if (c === 'ytDlp') return s.status.ytDlp.found && !s.status.ytDlp.error;
  if (c === 'ffmpeg') return s.status.ffmpeg.found && !s.status.ffmpeg.error;
  return s.status.deno ? s.status.deno.found && !s.status.deno.error : null;
}

/** 元件的版本（可用時）。 */
export function componentVersion(s: HostState, c: HostComponent): string | null {
  if (s.state !== 'connected') return null;
  if (c === 'host') return s.status.hostVersion || null;
  const tool = c === 'ytDlp' ? s.status.ytDlp : c === 'ffmpeg' ? s.status.ffmpeg : s.status.deno;
  return tool?.found ? tool.version : null;
}

/**
 * 安裝或補齊元件的指令（008 FR-1、FR-13）：一律是一行安裝指令。指令可以重複執行，
 * 已安裝的部分會跳過、缺少的部分會補上，所以小幫手未安裝或缺少 yt-dlp、ffmpeg、deno 時都用同一個指令。
 */
export function installCommand(_s: HostState, os: HostOs): string | null {
  return os === 'other' ? null : INSTALL_COMMANDS[os];
}

/** 只缺 deno（可以下載，但建議安裝，T15a）。 */
export const missingOnlyDeno = (s: HostState) => canDownload(s) && componentState(s, 'deno') === false;

/** 自動更新連續失敗幾次以上才在下載面板提示（008 FR-25）。 */
export const UPDATE_FAILURE_HINT_AT = 3;

/** 下載面板是否顯示「自動更新連續失敗」的一行提示：失敗 3 次以上、且這次的失敗沒有被使用者關閉。 */
export function showUpdateFailureHint(s: HostState, dismissedAt: number | null): boolean {
  if (s.state !== 'connected' || !s.status.update) return false;
  const u = s.status.update;
  return u.consecutiveFailures >= UPDATE_FAILURE_HINT_AT && (dismissedAt === null || u.lastCheck === null || u.lastCheck !== dismissedAt);
}
