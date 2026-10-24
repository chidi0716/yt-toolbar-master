// 所有設定的 storage 定義集中於此（plan 3.1）。
// 檔案位於 utils/，WXT 會自動匯入這裡的 export。
// 設定都存在 sync 區：跨分頁、跨重新開機，並跟著使用者的瀏覽器帳號同步。
import type { WxtStorageItem } from 'wxt/utils/storage';
import type { PageThemePreference, Theme } from './page-theme';
import type { ToolbarLayout } from './toolbar-layout';

/** 介面語言（007 FR-1、FR-4）：跟隨瀏覽器、繁體中文或英文。 */
export type UiLanguagePreference = 'auto' | 'zh_TW' | 'en';
export const UI_LANGUAGE_VALUES: readonly UiLanguagePreference[] = ['auto', 'zh_TW', 'en'];
export const uiLanguage = storage.defineItem<UiLanguagePreference>('sync:uiLanguage', { fallback: 'auto' });

/** 設定頁與彈出視窗的外觀（007 FR-20、FR-24）：跟隨 YouTube（預設）、跟隨系統、深色、淺色。 */
export const pageTheme = storage.defineItem<PageThemePreference>('sync:pageTheme', { fallback: 'youtube' });
/** 最近一次在 YouTube 上看到的主題（007 FR-21）；只存在本機。由 utils/page-theme.ts 讀寫。 */
export const lastYouTubeTheme = storage.defineItem<Theme | null>('local:lastYouTubeTheme', { fallback: null });

/** 工具列是否顯示（001 FR-15、FR-16）。 */
export const enabled = storage.defineItem<boolean>('sync:enabled', {
  fallback: true,
});

/** 自訂工具列（006）：工具的顯示／隱藏、順序與分隔點位置；null 表示使用預設值。讀取時以 normalizeLayout 驗證與合併。 */
export const toolbarLayout = storage.defineItem<ToolbarLayout | null>('sync:toolbarLayout', { fallback: null });

// 深色模式不另外存設定：以 YouTube 自己的主題偏好為準（003 FR-12）。

/** 浮動播放器是否開啟（003 FR-40、FR-1）。 */
export const floatingPlayer = storage.defineItem<boolean>('sync:floatingPlayer', {
  fallback: false,
});

/** 浮動播放器貼齊的角落（003 FR-41）。 */
export const floatingCorner = storage.defineItem<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>(
  'sync:floatingCorner',
  { fallback: 'bottom-right' },
);

/** 切換分頁時自動暫停（003 FR-60）。 */
export const smartPause = storage.defineItem<boolean>('sync:smartPause', { fallback: false });

/** 純音訊模式（003 FR-62）。 */
export const audioOnly = storage.defineItem<boolean>('sync:audioOnly', { fallback: false });

/** 滑鼠滾輪調整音量（003 FR-63）。 */
export const wheelVolume = storage.defineItem<boolean>('sync:wheelVolume', { fallback: false });

/** 隱藏留言（003 FR-64）。 */
export const hideComments = storage.defineItem<boolean>('sync:hideComments', { fallback: false });

/** 鎖定畫質的選項（004 FR-1）：關閉、最高可用畫質，或指定的解析度（畫面高度）。 */
export const QUALITY_LOCK_VALUES = ['off', 'max', '2160', '1440', '1080', '720', '480'] as const;
export type QualityLock = (typeof QUALITY_LOCK_VALUES)[number];

/** 鎖定畫質（004 FR-1、FR-5）。 */
export const qualityLock = storage.defineItem<QualityLock>('sync:qualityLock', { fallback: 'off' });

// 頁面整理（005）：在設定頁開關，預設全部關閉（FR-2），跟著瀏覽器帳號同步（FR-4）。

/** 永遠使用原始語音（005 FR-10 至 FR-13）。 */
export const tidyOriginalAudio = storage.defineItem<boolean>('sync:tidyOriginalAudio', { fallback: false });

/** 隱藏片尾推薦卡片與結尾畫面（005 FR-20 至 FR-22）。 */
export const tidyHideEndCards = storage.defineItem<boolean>('sync:tidyHideEndCards', { fallback: false });

/** 自動關閉「影片已暫停，要繼續觀看嗎？」（005 FR-30、FR-31）。 */
export const tidyAutoContinue = storage.defineItem<boolean>('sync:tidyAutoContinue', { fallback: false });

/** 停用縮圖自動預覽（005 FR-40、FR-41）。 */
export const tidyNoThumbnailPreview = storage.defineItem<boolean>('sync:tidyNoThumbnailPreview', { fallback: false });

/** Shorts 改用一般播放器（005 FR-50 至 FR-52）。 */
export const tidyShortsToWatch = storage.defineItem<boolean>('sync:tidyShortsToWatch', { fallback: false });

/** 隱藏 Shorts（005 FR-60 至 FR-63）。 */
export const tidyHideShorts = storage.defineItem<boolean>('sync:tidyHideShorts', { fallback: false });

/** 顯示完整影片標題（005 FR-70、FR-71）。 */
export const tidyFullTitles = storage.defineItem<boolean>('sync:tidyFullTitles', { fallback: false });

// 經由橋接程式的下載（002 FR-60、004 FR-11，tasks T20、T23）。

/** 下載資料夾的絕對路徑；null 表示使用橋接程式回報的系統「下載」資料夾。每台電腦不同，所以存在 local。 */
export const downloadDir = storage.defineItem<string | null>('local:downloadDir', { fallback: null });

/** 檔名格式（橋接程式的 namePreset 白名單，002 FR-60）。 */
export const namePreset = storage.defineItem<string>('sync:namePreset', { fallback: 'title-id' });

/** 嵌入封面、章節與影片資訊（004 FR-11，預設開啟）。 */
export const embedInfo = storage.defineItem<boolean>('sync:embedInfo', { fallback: true });

/** MP3 位元率（002 FR-20：預設 192 kbps，記住上次選擇）。 */
export const mp3Bitrate = storage.defineItem<number>('sync:mp3Bitrate', { fallback: 192 });

// 一鍵下載與右鍵下載（009，plan 3.11）。

/** 一鍵下載（009 FR-1：預設開啟）：點「影片」「MP3」直接以預設值開始下載。 */
export const quickDownload = storage.defineItem<boolean>('sync:quickDownload', { fallback: true });

/** 預設影片畫質（009 FR-2）：最高畫質或畫面高度（短邊）。 */
export const DEFAULT_VIDEO_HEIGHTS = ['best', 2160, 1440, 1080, 720, 480] as const;
export type DefaultVideoHeight = (typeof DEFAULT_VIDEO_HEIGHTS)[number];
export const defaultVideoHeight = storage.defineItem<DefaultVideoHeight>('sync:defaultVideoHeight', { fallback: 1080 });

/** 預設影片格式（009 FR-2）：MP4（相容性最好，預設）或不限格式。 */
export const DEFAULT_VIDEO_CONTAINERS = ['mp4', 'any'] as const;
export type DefaultVideoContainer = (typeof DEFAULT_VIDEO_CONTAINERS)[number];
export const defaultVideoContainer = storage.defineItem<DefaultVideoContainer>('sync:defaultVideoContainer', { fallback: 'mp4' });

/** 在影片連結的右鍵選單顯示下載選項（009 FR-25：預設開啟）。 */
export const downloadContextMenu = storage.defineItem<boolean>('sync:downloadContextMenu', { fallback: true });

/** 讀到的預設畫質不合法時（例如其他版本寫入的值）改用 1080。 */
export const toDefaultVideoHeight = (v: unknown): DefaultVideoHeight =>
  (DEFAULT_VIDEO_HEIGHTS as readonly unknown[]).includes(v) ? (v as DefaultVideoHeight) : 1080;
export const toDefaultVideoContainer = (v: unknown): DefaultVideoContainer => (v === 'any' ? 'any' : 'mp4');

/** 是否已顯示過「裁切需要額外處理時間」的說明（004 FR-23：第一次使用裁切時顯示）。 */
export const clipHintSeen = storage.defineItem<boolean>('local:clipHintSeen', { fallback: false });

// 新版本提醒（008 FR-26 至 FR-29b，plan 3.9）：只存在本機，不同步。內容由 utils/update-check.ts 驗證與解讀。

/** 最近一次查詢的時間與結果、最新正式版本。 */
export const updateCheck = storage.defineItem<unknown>('local:updateCheck', { fallback: null });

/** 跳過的版本、不再提醒、卡片最近一次出現的版本與時間、已處理（前往下載）的版本。 */
export const updateReminder = storage.defineItem<unknown>('local:updateReminder', { fallback: null });

/**
 * 下載面板中「小幫手自動更新連續失敗」提示（008 FR-25、FR-29c）被關閉時，記下當時最近一次檢查的時間；
 * 之後再有新的失敗（檢查時間改變）時再顯示。設定頁可以清除（重新顯示）。
 */
export const hostUpdateHintDismissed = storage.defineItem<number | null>('local:hostUpdateHintDismissed', { fallback: null });

// ---------------------------------------------------------------------------
// 讀取與監看
// ---------------------------------------------------------------------------

type AnyItem = WxtStorageItem<any, any>;
type Values<T extends readonly AnyItem[]> = { -readonly [K in keyof T]: T[K] extends WxtStorageItem<infer V, any> ? V : never };

/** 一次讀取多個設定（同一個儲存區只讀一次）；讀不到時為各自的預設值。 */
export async function readSettings<const T extends readonly AnyItem[]>(items: T): Promise<Values<T>> {
  try {
    return (await storage.getItems([...items])).map((r) => r.value) as Values<T>;
  } catch (err) {
    console.info('[yt-toolbar-master] failed to read settings', err);
    return items.map((item) => item.fallback) as Values<T>;
  }
}

/**
 * 讀取並監看多個設定：讀到時、以及之後任何一個改變時，以全部的目前值呼叫 onChange。
 * 回傳釋放的函式（取消監聽；之後不再呼叫）。
 */
export function watchSettings<const T extends readonly AnyItem[]>(items: T, onChange: (values: Values<T>) => void): () => void {
  let values: unknown[] | null = null;
  let released = false;
  const early = new Map<number, unknown>();
  const unwatch = items.map((item, i) =>
    item.watch((value: unknown) => {
      if (released) return;
      if (!values) {
        early.set(i, value);
        return;
      }
      values = values.map((v, j) => (j === i ? value : v));
      onChange(values as Values<T>);
    }),
  );
  void readSettings(items).then((read) => {
    if (released) return;
    values = read.map((v, i) => (early.has(i) ? early.get(i) : v));
    onChange(values as Values<T>);
  });
  return () => {
    released = true;
    unwatch.forEach((off) => off());
  };
}
