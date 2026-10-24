// ★ 所有依賴 YouTube 頁面結構的選擇器、事件名稱與播放器方法都集中在這個模組
//   （constitution 第 7 點）。YouTube 改版時只需要修改這裡。
//
// 規則：找不到預期的元素時回傳 null，由呼叫端安靜地放棄該功能並在 console 記錄，
// 不得丟出例外讓 YouTube 頁面出錯。

/** YouTube 單頁應用完成換頁時，在 document 上發出的事件。 */
export const NAVIGATE_FINISH_EVENT = 'yt-navigate-finish';

/** 會出現影片觀看頁的網域（不含 m.youtube.com、music.youtube.com 等版面不同的子網域）。 */
export const WATCH_HOSTS: readonly string[] = ['www.youtube.com', 'youtube.com'];

export const SELECTORS = {
  /** 觀看頁的根元素。 */
  watchRoot: 'ytd-watch-flexy',
  /** 播放器（同時也是播放器 API 物件）。 */
  player: '#movie_player',
  /** 播放器內的主要 <video>。 */
  video: '#movie_player video.html5-main-video',
  /** 播放器下方的欄位；工具列插在這裡的最前面，也就是標題的上方。 */
  belowPlayer: 'ytd-watch-flexy #below',
  /** 影片標題與資訊區塊（在 #below 之內，可能包在其他容器裡）。 */
  metadata: 'ytd-watch-metadata',
  /**
   * 包住播放器的容器（一般模式在 #player 內，YouTube 劇院模式時會被移到加寬的容器）。
   * 劇院模式（003 FR-20）提高它的 z-index；浮動播放器（FR-40）把它改成固定定位。
   */
  playerContainer: 'ytd-watch-flexy #player-container',
  /** 固定在頁面頂端的標題列；浮動播放器不蓋住它（003 FR-40）。 */
  masthead: '#masthead-container',
  /** 播放器內包住 <video> 的容器；純音訊模式在這裡顯示縮圖（003 FR-62）。 */
  videoContainer: '#movie_player .html5-video-container',
  /** 播放器上 YouTube 自己的「自動播放」開關；aria-checked 表示開或關（003 FR-61）。 */
  autoplayToggle: '#movie_player .ytp-autonav-toggle-button',
  /** 觀看頁的留言區（003 FR-64）。 */
  comments: 'ytd-watch-flexy #comments',
} as const;

/**
 * 劇院模式（003 FR-20、plan 3.7）調暗的頁面區域：播放器容器與工具列以外的各個區塊。
 * 依 2026-10-21 從站內換頁進入的真實觀看頁確認（spikes/T07a/results-real-*.txt）。
 * 工具列（ytm-toolbar）插在 #below 的最前面，所以 #below 只調暗工具列以外的子元素。
 * 播放器容器與它的祖先都不在這個清單中（播放器位於多層堆疊脈絡內，不能靠提高 z-index）。
 */
export const CINEMA_DIMMED_REGIONS: readonly string[] = [
  // 頂端列
  '#masthead-container',
  // 左側導覽（觀看頁預設收合成抽屜）
  'tp-yt-app-drawer#guide',
  'ytd-mini-guide-renderer',
  // 播放器欄位（#primary）以外的欄位：右側欄（推薦影片、播放清單、聊天室、資訊面板）等
  'ytd-watch-flexy #columns > :not(#primary)',
  // 播放器下方：標題、頻道、說明、留言（視窗較窄時推薦影片也在這裡）
  'ytd-watch-flexy #below > :not(ytm-toolbar)',
  // 播放器欄位中播放器與 #below 以外的區塊
  'ytd-watch-flexy #primary-inner > :not(#player):not(#below)',
  // YouTube 劇院模式（加寬播放器）時的全寬區：播放器以外的資訊面板
  'ytd-watch-flexy #full-bleed-container > :not(#player-full-bleed-container)',
  // 部分版面在右側的固定選單（說明、留言等按鈕）與問卷
  'ytd-watch-flexy #fixed-side-menu',
  'ytd-watch-flexy #survey',
  // YouTube「環境模式」在播放器周圍的光暈（與播放器容器是兄弟元素）
  'ytd-watch-flexy #cinematics-container',
];

/** 元素是否位於劇院模式調暗的區域中（不含播放器與工具列）。 */
export function isInCinemaDimmedRegion(el: Element): boolean {
  if (el.closest(`${SELECTORS.player}, ytm-toolbar`)) return false;
  return el.closest(CINEMA_DIMMED_REGIONS.join(', ')) !== null;
}

/** 標題列的預設高度（找不到標題列時使用）。 */
const DEFAULT_MASTHEAD_HEIGHT = 56;

export interface ToolbarAnchor {
  /** 工具列要插入的父元素。 */
  parent: Element;
  /** 工具列要插在這個元素前面；null 表示放在 parent 的最前面。 */
  before: Element | null;
}

/** 找出工具列的掛載位置：播放器正下方、影片標題上方（001 FR-2）。 */
export function findToolbarAnchor(doc: Document = document): ToolbarAnchor | null {
  const below = doc.querySelector(SELECTORS.belowPlayer);
  if (!below) return null;
  // 工具列插在「#below 中包含標題區塊的那個子元素」前面。
  let before = below.querySelector(SELECTORS.metadata);
  while (before && before.parentElement !== below) before = before.parentElement;
  if (!before) return null;
  return { parent: below, before };
}

export function findPlayer(doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(SELECTORS.player);
}

export function findPlayerContainer(doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(SELECTORS.playerContainer);
}

/** 影片縮圖的網址（i.ytimg.com，所有影片都有 hqdefault）。純音訊模式使用（003 FR-62）。 */
export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

export interface AutoplayToggle {
  /** 帶 aria-checked 的元素。 */
  indicator: Element;
  /** 要點擊的按鈕。 */
  button: HTMLElement;
}

/** YouTube 播放器上的自動播放開關；找不到時回傳 null。 */
export function findAutoplayToggle(doc: Document = document): AutoplayToggle | null {
  const indicator = doc.querySelector(SELECTORS.autoplayToggle);
  const button = indicator?.closest<HTMLElement>('button') ?? null;
  return indicator && button ? { indicator, button } : null;
}

export function isAutoplayOn(toggle: AutoplayToggle): boolean {
  return toggle.indicator.getAttribute('aria-checked') === 'true';
}

/** 頁面頂端被固定標題列蓋住的高度。 */
export function mastheadHeight(doc: Document = document): number {
  const masthead = doc.querySelector(SELECTORS.masthead);
  if (!masthead) return DEFAULT_MASTHEAD_HEIGHT;
  const rect = masthead.getBoundingClientRect();
  return rect.height > 0 ? Math.max(0, Math.round(rect.bottom)) : 0;
}

export function findVideo(doc: Document = document): HTMLVideoElement | null {
  return doc.querySelector<HTMLVideoElement>(SELECTORS.video);
}

// ---------------------------------------------------------------------------
// 主題（003 深色模式）
// ---------------------------------------------------------------------------

/** YouTube 以 <html> 上的這個屬性切換深色主題，顏色變數會跟著換值。 */
export const DARK_THEME_ATTRIBUTE = 'dark';

export function isDarkTheme(doc: Document = document): boolean {
  return doc.documentElement.hasAttribute(DARK_THEME_ATTRIBUTE);
}

// ---------------------------------------------------------------------------
// YouTube「外觀」選單（003 FR-10 至 FR-15、plan 3.7、T06d）。依 2026-10-21 在 YouTube 首頁（未登入）
// 的實測，見 specs/notes/T06d-dark-mode-menu.md：
// - 頂端列右側的選單按鈕（未登入：設定按鈕；已登入：頭像按鈕）是 ytd-topbar-menu-button-renderer，
//   打開的選單放在 ytd-popup-container 的 tp-yt-iron-dropdown 中；
// - 「外觀」項目是專用的元件 ytd-toggle-theme-compact-link-renderer；
// - 點「外觀」後，子選單（#submenu）中的每個選項是 ytd-compact-link-renderer。選項沒有不依文字的
//   DOM 屬性，但元件的 data（只有頁面的 main world 讀得到）中有動作代號：
//   serviceEndpoint.signalServiceEndpoint.actions[].signalAction.signal 為
//   TOGGLE_DARK_THEME_ON（深色主題）或 TOGGLE_DARK_THEME_OFF（淺色主題），與介面語言無關。
//   頁面橋接腳本依此在選項上加上 THEME_OPTION_ATTRIBUTE，內容腳本再點擊。
// ---------------------------------------------------------------------------

export const APPEARANCE_MENU = {
  /** 已登入時的頭像按鈕（本環境無法登入，未實測）。 */
  avatarButton: 'ytd-masthead #end button#avatar-btn',
  /** 頂端列右側的選單按鈕元件；最右邊的一個是頭像（已登入）或設定（未登入）。 */
  menuButtonRenderer: 'ytd-masthead #end #buttons ytd-topbar-menu-button-renderer',
  /** 打開的彈出選單（操作期間以暫時的 class 讓它不可見）。 */
  popup: 'ytd-popup-container tp-yt-iron-dropdown',
  /** 選單中的「外觀」項目。 */
  appearanceItem: 'ytd-popup-container ytd-toggle-theme-compact-link-renderer',
  /** 「外觀」子選單中的選項。 */
  themeOption: 'ytd-popup-container #submenu ytd-compact-link-renderer',
  /** 選項中實際處理點擊的連結。 */
  themeOptionLink: 'a#endpoint',
} as const;

/** 頁面橋接腳本在外觀選項上加的屬性，值為 dark 或 light。 */
export const THEME_OPTION_ATTRIBUTE = 'data-ytm-theme-option';

/** 外觀選項的動作代號與對應的主題。 */
export const THEME_OPTION_SIGNALS: Readonly<Record<string, 'dark' | 'light'>> = {
  TOGGLE_DARK_THEME_ON: 'dark',
  TOGGLE_DARK_THEME_OFF: 'light',
};

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** 從外觀選項元件的 data 取出它代表的主題；不是深色或淺色選項（例如「使用裝置主題」）時回傳 null。 */
export function themeOptionOf(data: unknown): 'dark' | 'light' | null {
  const endpoint = asRecord(asRecord(asRecord(data)?.serviceEndpoint)?.signalServiceEndpoint);
  const actions = Array.isArray(endpoint?.actions) ? endpoint.actions : [];
  for (const action of actions) {
    const signal = asRecord(asRecord(action)?.signalAction)?.signal;
    if (typeof signal === 'string' && Object.hasOwn(THEME_OPTION_SIGNALS, signal)) return THEME_OPTION_SIGNALS[signal]!;
  }
  return null;
}

/**
 * main world 用：在目前外觀子選單的選項上標記它代表的主題（先清除舊的標記）。
 * 只加上資料屬性，不點擊、不修改其他東西。回傳找到哪些選項。
 */
export function markThemeOptions(doc: Document = document): { dark: boolean; light: boolean } {
  const found = { dark: false, light: false };
  for (const el of doc.querySelectorAll(`[${THEME_OPTION_ATTRIBUTE}]`)) el.removeAttribute(THEME_OPTION_ATTRIBUTE);
  for (const el of doc.querySelectorAll(APPEARANCE_MENU.themeOption)) {
    const theme = themeOptionOf((el as Element & { data?: unknown }).data);
    if (!theme) continue;
    el.setAttribute(THEME_OPTION_ATTRIBUTE, theme);
    found[theme] = true;
  }
  return found;
}

/** 打開帳號／設定選單的按鈕：已登入時的頭像按鈕，否則頂端列最右邊的選單按鈕。 */
export function findAccountMenuButton(doc: Document = document): HTMLElement | null {
  const avatar = doc.querySelector<HTMLElement>(APPEARANCE_MENU.avatarButton);
  if (avatar) return avatar;
  const renderers = doc.querySelectorAll(APPEARANCE_MENU.menuButtonRenderer);
  return renderers.length > 0 ? renderers[renderers.length - 1]!.querySelector<HTMLElement>('button') : null;
}

/** 已打開、顯示中的彈出選單。 */
export function findOpenPopup(doc: Document = document): HTMLElement | null {
  for (const el of doc.querySelectorAll<HTMLElement>(APPEARANCE_MENU.popup)) {
    if (el.getAttribute('aria-hidden') !== 'true' && el.style.display !== 'none' && el.getClientRects().length > 0) return el;
  }
  return null;
}

/** 顯示中的「外觀」項目。 */
export function findAppearanceItem(doc: Document = document): HTMLElement | null {
  const el = doc.querySelector<HTMLElement>(APPEARANCE_MENU.appearanceItem);
  return el && el.getClientRects().length > 0 ? el : null;
}

/** 已被橋接腳本標記、顯示中的深色或淺色選項（點擊的目標）。 */
export function findThemeOption(theme: 'dark' | 'light', doc: Document = document): HTMLElement | null {
  const option = doc.querySelector<HTMLElement>(`${APPEARANCE_MENU.themeOption}[${THEME_OPTION_ATTRIBUTE}="${theme}"]`);
  if (!option || option.getClientRects().length === 0) return null;
  return option.querySelector<HTMLElement>(APPEARANCE_MENU.themeOptionLink) ?? option;
}

// ---------------------------------------------------------------------------
// 播放器 API（只在 main world 的頁面橋接腳本中使用）
// ---------------------------------------------------------------------------

/** 播放器元素上我們會用到的方法；每個都可能不存在，呼叫前要檢查。 */
export interface YtPlayerApi {
  getVideoData?: () => { video_id?: unknown; title?: unknown; isLive?: unknown } | undefined;
  getPlayerResponse?: () =>
    | { videoDetails?: { isLive?: unknown; isUpcoming?: unknown; lengthSeconds?: unknown; title?: unknown } }
    | undefined;
  getDuration?: () => unknown;
  getCurrentTime?: () => unknown;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  getVolume?: () => unknown;
  setVolume?: (volume: number) => void;
  isMuted?: () => unknown;
  unMute?: () => void;
}

export interface VideoData {
  videoId: string;
  title: string;
  /** 秒；未知時為 0。 */
  duration: number;
  isLive: boolean;
  isUpcoming: boolean;
}

const toNumber = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
};

/** 從播放器讀出目前影片的資料；讀不到影片 ID 時回傳 null。 */
export function readVideoData(player: YtPlayerApi): VideoData | null {
  const data = player.getVideoData?.();
  const details = player.getPlayerResponse?.()?.videoDetails;
  const videoId = typeof data?.video_id === 'string' ? data.video_id : '';
  if (!videoId) return null;
  const title =
    typeof data?.title === 'string' && data.title
      ? data.title
      : typeof details?.title === 'string'
        ? details.title
        : '';
  const duration = toNumber(player.getDuration?.()) || toNumber(details?.lengthSeconds);
  return {
    videoId,
    title,
    duration,
    isLive: data?.isLive === true || details?.isLive === true,
    isUpcoming: details?.isUpcoming === true,
  };
}

export function readCurrentTime(player: YtPlayerApi): number {
  return toNumber(player.getCurrentTime?.());
}

export function readVolume(player: YtPlayerApi): { volume: number; muted: boolean } {
  return { volume: toNumber(player.getVolume?.()), muted: player.isMuted?.() === true };
}

export function writeVolume(player: YtPlayerApi, volume: number): void {
  player.setVolume?.(volume);
  if (volume > 0 && player.isMuted?.() === true) player.unMute?.();
}

export function writeSeek(player: YtPlayerApi, seconds: number): void {
  player.seekTo?.(seconds, true);
}

// ---------------------------------------------------------------------------
// 鎖定畫質（004 第 1 節、plan 3.7.1）
// 播放器方法依 2026-10-22 在真實觀看頁（站內換頁進入）上列出的 #movie_player 方法確認存在
// （spikes/stage2c/results-watch.txt）；畫質代號與解析度的對應來自 YouTube IFrame Player API
// 的公開文件。實際切換的效果在本環境無法驗證（影片無法播放），見 specs/notes/T27-quality-lock.md。
// ---------------------------------------------------------------------------

/** YouTube 播放器的畫質代號與對應的畫面高度。 */
export const QUALITY_HEIGHTS = {
  tiny: 144,
  small: 240,
  medium: 360,
  large: 480,
  hd720: 720,
  hd1080: 1080,
  hd1440: 1440,
  hd2160: 2160,
  hd2880: 2880,
  highres: 4320,
} as const;

export type QualityCode = keyof typeof QUALITY_HEIGHTS;

/** 交還給 YouTube 自動決定畫質時使用的代號。 */
export const AUTO_QUALITY = 'auto';

export function isQualityCode(value: unknown): value is QualityCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(QUALITY_HEIGHTS, value);
}

/** 播放器上與畫質相關的方法；每個都可能不存在，呼叫前要檢查。 */
export interface YtQualityApi {
  getAvailableQualityLevels?: () => unknown;
  getPlaybackQuality?: () => unknown;
  setPlaybackQuality?: (quality: string) => void;
  setPlaybackQualityRange?: (min: string, max?: string) => void;
}

/** 目前影片可用的畫質（只回傳已知的代號，不含 auto）；影片還沒載入時為空陣列。 */
export function readAvailableQualities(player: YtQualityApi): QualityCode[] {
  const levels = player.getAvailableQualityLevels?.();
  return Array.isArray(levels) ? levels.filter(isQualityCode) : [];
}

/** 目前的播放畫質；不是已知的代號時（例如 "unknown"）回傳 null。 */
export function readQuality(player: YtQualityApi): QualityCode | null {
  const q = player.getPlaybackQuality?.();
  return isQualityCode(q) ? q : null;
}

/**
 * 設定畫質：把畫質範圍的上下限都設成同一個代號（YouTube 的自動調整不會再改變它），並切換到該畫質。
 * `auto` 表示交還給 YouTube 自動決定。
 */
export function writeQuality(player: YtQualityApi, quality: QualityCode | typeof AUTO_QUALITY): void {
  player.setPlaybackQualityRange?.(quality, quality);
  player.setPlaybackQuality?.(quality);
}

// ---------------------------------------------------------------------------
// 語音軌（005 FR-10 至 FR-13、plan 3.7.2）
// 依 2026-10-22 在真實觀看頁上列出的方法：getAvailableAudioTracks、getAudioTrack、setAudioTrack。
// getAudioTrack() 回傳的物件有 id、xtags，以及一個內含 name／id／isDefault／isAutoDubbed 的物件
// （屬性名稱是壓縮過的短名稱，例如 "Nb"，改版時會變），所以以「含有 isAutoDubbed 或 isDefault 布林值的
// 子物件」來找（spikes/stage2c/results-watch.txt）。有多個語音軌時的實際內容在本環境無法確認。
// ---------------------------------------------------------------------------

export interface YtAudioApi {
  getAvailableAudioTracks?: () => unknown;
  getAudioTrack?: () => unknown;
  setAudioTrack?: (track: unknown) => unknown;
}

export interface AudioTrackInfo {
  id: string;
  name: string;
  /** 影片的預設語音軌。 */
  isDefault: boolean;
  /** YouTube 自動配音（AI 配音）。 */
  isAutoDubbed: boolean;
  /** 明確標示為原始語音（xtags 的 acont=original）。 */
  isOriginal: boolean;
}

/** 語音軌識別值的格式（例如 "en.4"、"es-419.3"、"und"）；setAudioTrack 只接受這種格式。 */
export const AUDIO_TRACK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** 把播放器的語音軌物件整理成固定欄位；看不懂時回傳 null。 */
export function describeAudioTrack(track: unknown): AudioTrackInfo | null {
  if (!isRecord(track)) return null;
  const id = track.id;
  if (typeof id !== 'string' || !AUDIO_TRACK_ID_PATTERN.test(id)) return null;
  let info: Record<string, unknown> = {};
  for (const value of Object.values(track)) {
    if (isRecord(value) && (typeof value.isAutoDubbed === 'boolean' || typeof value.isDefault === 'boolean')) {
      info = value;
      break;
    }
  }
  const xtags = typeof track.xtags === 'string' ? track.xtags : '';
  const name = [info.name, track.name, track.displayName].find((v): v is string => typeof v === 'string') ?? id;
  return {
    id,
    name,
    isDefault: info.isDefault === true || track.isDefault === true,
    isAutoDubbed: info.isAutoDubbed === true || /(?:^|[:&])acont=dubbed-auto(?:$|[:&])/.test(xtags),
    isOriginal: /(?:^|[:&])acont=original(?:$|[:&])/.test(xtags),
  };
}

/** 目前影片的語音軌清單與目前播放的語音軌 ID（清單還沒載入或只有一個語音軌時可能是空陣列）。 */
export function readAudioTracks(player: YtAudioApi): { tracks: AudioTrackInfo[]; current: string | null } {
  const raw = player.getAvailableAudioTracks?.();
  const tracks = Array.isArray(raw) ? raw.map(describeAudioTrack).filter((t): t is AudioTrackInfo => t !== null) : [];
  return { tracks, current: describeAudioTrack(player.getAudioTrack?.())?.id ?? null };
}

/** 切換到清單中 ID 相同的語音軌；清單中沒有時不做任何事並回傳 false。 */
export function writeAudioTrack(player: YtAudioApi, id: string): boolean {
  const raw = player.getAvailableAudioTracks?.();
  const track = Array.isArray(raw) ? raw.find((t) => describeAudioTrack(t)?.id === id) : undefined;
  if (!track || !player.setAudioTrack) return false;
  player.setAudioTrack(track);
  return true;
}

/** 便利功能與頁面整理使用的 YouTube 選擇器（004、005）。 */
export const CONVENIENCE_SELECTORS = {
  /** 播放器的設定（齒輪）選單；使用者在這裡手動改畫質或語音軌（004 FR-4、005 FR-12）。 */
  settingsMenu: '#movie_player .ytp-settings-menu',
  /** YouTube 的彈出視窗容器（在 ytd-app 底下，已確認存在）；「要繼續觀看嗎？」對話框出現在這裡（005 FR-30）。 */
  popupContainer: 'ytd-popup-container',
  /** 確認對話框（未確認：本環境看不到「要繼續觀看嗎？」對話框，依公開的元素名稱）。 */
  confirmDialog: 'yt-confirm-dialog-renderer',
  /** 對話框中的確認（「是」）按鈕；找不到內層的 <button> 時點外層元素。 */
  confirmButton: '#confirm-button button',
  confirmButtonHost: '#confirm-button',
} as const;

// ---------------------------------------------------------------------------
// 頁面整理中只靠樣式的選項（005、plan 3.7.2）：要隱藏或調整的元素。
// 依 2026-10-22 在真實 YouTube 首頁、搜尋頁、觀看頁（站內換頁進入）上的觀察
// （spikes/stage2c/results-home.txt、results-watch.txt、results-details.txt）；
// 標示「未確認」的項目在本環境看不到（例如影片無法播放、未登入時首頁沒有內容），依公開的元素名稱加入。
// ---------------------------------------------------------------------------

/** 片尾推薦卡片與播完後的推薦畫面（005 FR-20、FR-21）。不含自動播放倒數（FR-22）。 */
export const END_SCREEN_SELECTORS: readonly string[] = [
  // 影片最後幾秒的推薦卡片（影片、頻道、訂閱、連結）（未確認：本環境影片無法播放）
  '#movie_player .ytp-ce-element',
  // 自動播放關閉時，播完後的推薦影片格狀畫面（未確認）
  '#movie_player .html5-endscreen.videowall-endscreen',
  '#movie_player .ytp-endscreen-content',
  // 新版播放器的推薦格子（觀看頁上有 .ytp-fullscreen-grid，平時不顯示）；只在播完時隱藏（未確認）
  '#movie_player.ended-mode .ytp-fullscreen-grid-stills-container',
];

/** 縮圖自動預覽（005 FR-40）：ytd-app 底下共用的預覽播放器，以及舊版縮圖上的動態預覽。 */
export const THUMBNAIL_PREVIEW_SELECTORS: readonly string[] = [
  'ytd-app > #video-preview',
  'ytd-video-preview',
  'ytd-moving-thumbnail-renderer',
];

/** Shorts 的區塊與個別項目（005 FR-60）。以 :has() 判斷項目是否連到 /shorts/。 */
export const SHORTS_SELECTORS: readonly string[] = [
  // 首頁、訂閱：Shorts 區塊（未確認：未登入時首頁沒有內容）
  'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
  'ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model)',
  'ytd-rich-shelf-renderer[is-shorts]',
  // 搜尋：Shorts 格狀區塊（已確認）
  'grid-shelf-view-model:has(ytm-shorts-lockup-view-model)',
  // 觀看頁推薦清單與舊版搜尋：Shorts 橫向區塊（已確認）
  'ytd-reel-shelf-renderer',
  // 個別 Shorts 項目
  'ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model)',
  'ytd-rich-item-renderer:has(a#thumbnail[href^="/shorts/"])',
  'ytd-video-renderer:has(a#thumbnail[href^="/shorts/"])',
  'ytd-grid-video-renderer:has(a#thumbnail[href^="/shorts/"])',
  'ytd-compact-video-renderer:has(a#thumbnail[href^="/shorts/"])',
  'yt-lockup-view-model:has(a[href^="/shorts/"])',
  'ytm-shorts-lockup-view-model-v2',
  'ytm-shorts-lockup-view-model',
];

/**
 * 左側導覽與迷你導覽的 Shorts 入口（005 FR-61）。實測 Shorts 入口的連結沒有 href、title 為 "Shorts"；
 * 為了不依賴介面語言，也以 Shorts 圖示的 SVG path 開頭辨識（YouTube 換圖示時需要更新）。
 */
export const SHORTS_GUIDE_SELECTORS: readonly string[] = [
  'ytd-guide-entry-renderer:has(> a#endpoint[title="Shorts"])',
  'ytd-guide-entry-renderer:has(a[href^="/shorts"])',
  'ytd-guide-entry-renderer:has(path[d^="m13.467 1.19-8 4.7"])',
  'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
  'ytd-mini-guide-entry-renderer:has(a[href^="/shorts"])',
  'ytd-mini-guide-entry-renderer:has(path[d^="m13.467 1.19-8 4.7"])',
];

/**
 * 影片清單中的標題（005 FR-70）：實測一般影片 a#video-title、新版 a.ytLockupMetadataViewModelTitle
 * 都是 2 行截斷（-webkit-line-clamp: 2、max-height: 52px），Shorts 的標題截斷在外層 h3。
 */
export const VIDEO_TITLE_SELECTORS: readonly string[] = [
  '#video-title',
  '.ytLockupMetadataViewModelTitle',
  '.shortsLockupViewModelHostMetadataTitle',
];

// ---------------------------------------------------------------------------
// 縮圖（002 FR-30、plan 3.8）
// i.ytimg.com 的縮圖網址與尺寸。依 2026-10-22 直接取得的結果（spikes/stage4a/results-thumbnails.txt）：
// 不存在的尺寸回傳 404，內容是 120×90 的預設圖。
// ---------------------------------------------------------------------------

export const THUMBNAIL_SIZES = [
  { key: 'maxresdefault', width: 1280, height: 720 },
  { key: 'sddefault', width: 640, height: 480 },
  { key: 'hqdefault', width: 480, height: 360 },
  { key: 'mqdefault', width: 320, height: 180 },
] as const;

export type ThumbnailKey = (typeof THUMBNAIL_SIZES)[number]['key'];

/** YouTube 對不存在的尺寸回傳的預設圖大小。 */
export const THUMBNAIL_PLACEHOLDER_SIZE = { width: 120, height: 90 } as const;

export function isThumbnailKey(value: unknown): value is ThumbnailKey {
  return THUMBNAIL_SIZES.some((s) => s.key === value);
}

/** 某個尺寸的縮圖網址（JPG）。影片 ID 必須先驗證過。 */
export function thumbnailSizeUrl(videoId: string, key: ThumbnailKey): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${key}.jpg`;
}

// ---------------------------------------------------------------------------
// 字幕清單（002 FR-40、FR-44、plan 3.8）：播放器影片資料（getPlayerResponse()）中的
// captions.playerCaptionsTracklistRenderer.captionTracks；每項有 baseUrl、name（simpleText 或 runs）、
// languageCode、vssId，自動產生的字幕 kind 為 "asr"（vssId 以 "a." 開頭）。
// 本環境的觀看頁影片無法播放，影片資料中沒有字幕清單，這個結構依 YouTube 公開可見的影片資料，未在真實頁面確認
// （spikes/stage4a/results-captions.txt）。
// ---------------------------------------------------------------------------

export interface CaptionTrack {
  languageCode: string;
  /** YouTube 顯示的字幕名稱，例如 "English (auto-generated)"。 */
  name: string;
  /** 自動產生的字幕。 */
  isAuto: boolean;
  /** 字幕網址（已驗證為 https 的 youtube.com 網域）。 */
  url: string;
}

/** 字幕語言代碼的格式（與 plan 4.4 的 subLang 相同）。 */
export const CAPTION_LANGUAGE_PATTERN = /^[A-Za-z0-9-]{1,20}$/;

/**
 * 字幕網址必須是 https 的 youtube.com 或其子網域（plan 3.8）；相對網址以 https://www.youtube.com 解析。
 * 合法時回傳完整網址，否則回傳 null。
 */
export function validateCaptionUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  let url: URL;
  try {
    url = new URL(raw, 'https://www.youtube.com');
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const ok = url.protocol === 'https:' && !url.username && !url.password && !url.port && (host === 'youtube.com' || host.endsWith('.youtube.com'));
  return ok ? url.href : null;
}

const textOf = (value: unknown): string => {
  if (!isRecord(value)) return '';
  if (typeof value.simpleText === 'string') return value.simpleText;
  return Array.isArray(value.runs) ? value.runs.map((r) => (isRecord(r) && typeof r.text === 'string' ? r.text : '')).join('') : '';
};

/** 讀出字幕清單；格式不對或網址不是 youtube.com 的項目略過。 */
export function readCaptionTracks(player: { getPlayerResponse?: () => unknown }): CaptionTrack[] {
  const response = player.getPlayerResponse?.();
  const captions = isRecord(response) ? response.captions : undefined;
  const renderer = isRecord(captions) ? captions.playerCaptionsTracklistRenderer : undefined;
  const tracks = isRecord(renderer) && Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
  const out: CaptionTrack[] = [];
  for (const t of tracks.slice(0, 200)) {
    if (!isRecord(t)) continue;
    const languageCode = typeof t.languageCode === 'string' ? t.languageCode : '';
    const url = validateCaptionUrl(t.baseUrl);
    if (!CAPTION_LANGUAGE_PATTERN.test(languageCode) || !url) continue;
    const isAuto = t.kind === 'asr' || (typeof t.vssId === 'string' && t.vssId.startsWith('a.'));
    out.push({ languageCode, name: textOf(t.name).slice(0, 100) || languageCode, isAuto, url });
  }
  return out;
}
