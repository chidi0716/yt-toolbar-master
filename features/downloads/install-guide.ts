// 一行指令安裝的說明（008 FR-1、FR-2、FR-11，plan 3.10）：指令、三步驟、「這個指令會做什麼？」的內容。
// 影片／MP3 面板（Preact）與設定頁（DOM API）共用這裡的資料，兩邊顯示相同的說明。指令本身不翻譯。
import type { MessageKey } from '@/utils/i18n';
import type { HostOs } from './logic';

export type InstallOs = Exclude<HostOs, 'other'>;

const RELEASE_DOWNLOAD = 'https://github.com/chidi0716/yt-toolbar-master/releases/latest/download';

/** 安裝腳本（本專案 GitHub 正式版本附帶的引導腳本）。 */
export const INSTALL_SCRIPT_URLS: Record<InstallOs, string> = {
  mac: `${RELEASE_DOWNLOAD}/install.sh`,
  windows: `${RELEASE_DOWNLOAD}/install.ps1`,
};

/** 一行指令（plan 3.10）。 */
export const INSTALL_COMMANDS: Record<InstallOs, string> = {
  mac: `curl -fsSL ${INSTALL_SCRIPT_URLS.mac} | sh`,
  windows: `irm ${INSTALL_SCRIPT_URLS.windows} | iex`,
};

/** 先檢視腳本再執行：下載、檢視、執行（「這個指令會做什麼？」中顯示）。 */
export const REVIEW_COMMANDS: Record<InstallOs, readonly string[]> = {
  mac: [`curl -fsSL ${INSTALL_SCRIPT_URLS.mac} -o install.sh`, 'less install.sh', 'sh install.sh'],
  windows: [`irm ${INSTALL_SCRIPT_URLS.windows} -OutFile install.ps1`, 'notepad install.ps1', 'powershell -ExecutionPolicy Bypass -File .\\install.ps1'],
};

/** 三步驟說明（008 FR-1）。 */
export const INSTALL_STEPS: Record<InstallOs, readonly MessageKey[]> = {
  mac: ['installStepMacOpen', 'installStepMacPaste', 'installStepDone'],
  windows: ['installStepWindowsOpen', 'installStepWindowsPaste', 'installStepDone'],
};

/** 「這個指令會做什麼？」：依序列出安裝腳本的步驟與下載來源（008 FR-11、plan 4.9）。 */
export interface InstallDetail {
  text: MessageKey;
  /** 下載來源或安裝位置；依作業系統不同時分開寫。 */
  source?: string | Record<InstallOs, string>;
}

export const INSTALL_DETAILS: readonly InstallDetail[] = [
  { text: 'installDetailHelper', source: 'github.com/chidi0716/yt-toolbar-master' },
  { text: 'installDetailYtDlp', source: 'github.com/yt-dlp/yt-dlp' },
  { text: 'installDetailDeno', source: 'github.com/denoland/deno' },
  { text: 'installDetailFfmpeg', source: { mac: 'ffmpeg.martin-riedl.de', windows: 'github.com/yt-dlp/FFmpeg-Builds' } },
  {
    text: 'installDetailFolder',
    source: { mac: '~/Library/Application Support/youtube-extension-host/', windows: '%LOCALAPPDATA%\\youtube-extension-host\\' },
  },
  { text: 'installDetailDone' },
];

export const detailSource = (detail: InstallDetail, os: InstallOs): string | null =>
  detail.source === undefined ? null : typeof detail.source === 'string' ? detail.source : detail.source[os];

/** 安裝說明的標題（依作業系統）。 */
export const INSTALL_TITLES: Record<HostOs, MessageKey> = {
  mac: 'hostStepsTitleMac',
  windows: 'hostStepsTitleWindows',
  other: 'hostStepsTitleOther',
};

/** runtime.getPlatformInfo() 的 os（plan 3.10）→ 安裝說明的作業系統。 */
export function platformToOs(os: unknown): HostOs {
  if (os === 'mac') return 'mac';
  if (os === 'win') return 'windows';
  return 'other';
}

/** 安裝中檢查小幫手的間隔（plan 3.10：每 3 秒，只在面板開著時）。 */
export const INSTALL_POLL_MS = 3000;
