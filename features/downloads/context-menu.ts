// 背景腳本端：右鍵下載（009 第三節，plan 3.11，tasks T55）。
// - 在 YouTube 頁面上的影片連結加上「下載影片（1080p MP4）」「下載 MP3（192 kbps）」，放在以擴充功能名稱為標題的子選單；
// - 選單在安裝、更新、瀏覽器啟動，以及設定或介面語言改變時重建（FR-25、FR-26）；
// - 點擊時從連結取出影片 ID，以預設值開始下載（FR-22），並以系統通知告知開始、需要安裝小幫手或無法下載（FR-23、FR-24）。
import { initI18n, resolveLocale, setLocale, t } from '@/utils/i18n';
import { HostRequestError } from '@/utils/native';
import type { HostErrorCode } from '@/utils/native-protocol';
import { downloadContextMenu, uiLanguage } from '@/utils/settings';
import { videoIdFromLink } from '@/utils/youtube/page';
import { quickDownload, readQuickDefaults } from './host-background';
import { errorInfo } from './jobs';
import { contextMenuTitles, mp3SpecLabel, needsHelper, startNotificationId, videoSpecLabel, type QuickKind } from './quick';

const LOG_PREFIX = '[yt-toolbar-master]';

export const MENU_PARENT = 'ytm-download';
export const MENU_VIDEO = 'ytm-download-video';
export const MENU_MP3 = 'ytm-download-mp3';
/** 「下載影片需要先安裝小幫手」的通知；點了打開設定頁的「下載」區（FR-24）。 */
export const INSTALL_NOTIFICATION_ID = 'ytm-install-helper';

/** 只在 YouTube 頁面、指向單一影片的連結上出現（FR-21，plan 3.11）。 */
export const MENU_PATTERNS = {
  contexts: ['link'] as const,
  documentUrlPatterns: ['*://*.youtube.com/*'],
  targetUrlPatterns: ['*://*.youtube.com/watch*', '*://*.youtube.com/shorts/*', '*://youtu.be/*'],
};

/** 影響選單的設定（sync）：開關、預設畫質與格式、MP3 位元率、介面語言。 */
export const MENU_SETTING_KEYS = ['downloadContextMenu', 'defaultVideoHeight', 'defaultVideoContainer', 'mp3Bitrate', 'uiLanguage'];

export interface MenuItem {
  id: string;
  parentId?: string;
  title: string;
  contexts: ['link'];
  documentUrlPatterns: string[];
  targetUrlPatterns: string[];
}

/** 要建立的選單項目；關閉時為空（FR-25）。純函式。 */
export function menuItems(enabled: boolean, titles: { parent: string; video: string; mp3: string }): MenuItem[] {
  if (!enabled) return [];
  const base = { contexts: ['link'] as ['link'], documentUrlPatterns: [...MENU_PATTERNS.documentUrlPatterns], targetUrlPatterns: [...MENU_PATTERNS.targetUrlPatterns] };
  return [
    { id: MENU_PARENT, title: titles.parent, ...base },
    { id: MENU_VIDEO, parentId: MENU_PARENT, title: titles.video, ...base },
    { id: MENU_MP3, parentId: MENU_PARENT, title: titles.mp3, ...base },
  ];
}

export const menuKind = (menuItemId: unknown): QuickKind | null => (menuItemId === MENU_VIDEO ? 'video' : menuItemId === MENU_MP3 ? 'mp3' : null);

let rebuilding: Promise<void> = Promise.resolve();

/** 以 removeAll 後重建（plan 3.11）。依序執行，避免同時重建造成重複的 ID。 */
export function rebuildContextMenus(): Promise<void> {
  rebuilding = rebuilding
    .then(async () => {
      await initI18n();
      // 翻譯層的監聽器不一定已經處理了這次的語言變更：直接以設定決定。
      setLocale(resolveLocale(await uiLanguage.getValue()));
      const [enabled, defaults] = await Promise.all([downloadContextMenu.getValue(), readQuickDefaults()]);
      await browser.contextMenus.removeAll();
      for (const item of menuItems(enabled !== false, contextMenuTitles(defaults))) {
        browser.contextMenus.create(item, () => {
          const err = browser.runtime.lastError;
          if (err) console.info(`${LOG_PREFIX} context menu: ${err.message}`);
        });
      }
    })
    .catch((err: unknown) => console.info(`${LOG_PREFIX} failed to build the context menu`, err));
  return rebuilding;
}

async function notify(id: string, title: string, message: string): Promise<void> {
  try {
    // 同一個 ID 再建立一次會取代原本的通知（Chrome 與 Firefox 都是），用來把影片 ID 換成標題。
    await browser.notifications.create(id, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title, message });
  } catch (err) {
    console.info(`${LOG_PREFIX} notification failed`, err);
  }
}

/** 右鍵選單「下載影片」「下載 MP3」（FR-22 至 FR-24）。 */
export async function downloadFromMenu(videoId: string, kind: QuickKind): Promise<void> {
  await initI18n();
  const id = startNotificationId(videoId, kind);
  const defaults = await readQuickDefaults();
  const spec = kind === 'video' ? videoSpecLabel(defaults.height, defaults.container) : mp3SpecLabel(defaults.bitrate);
  let title = '';
  try {
    const result = await quickDownload(videoId, kind, {
      source: 'contextMenu',
      onStart: () => void notify(id, t('notifyStarted', videoId), spec),
      onInfo: (name) => {
        title = name;
        if (name) void notify(id, t('notifyStarted', name), spec);
      },
    });
    const name = result.title || title || videoId;
    await notify(id, t(result.status === 'running' ? 'notifyAlreadyDownloading' : 'notifyStarted', name), result.label);
  } catch (err) {
    const code: HostErrorCode = err instanceof HostRequestError ? err.code : 'UNKNOWN';
    if (needsHelper(code)) {
      browser.notifications.clear(id).catch(() => {});
      await notify(INSTALL_NOTIFICATION_ID, t('notifyNeedHelper'), t('notifyNeedHelperBody'));
      return;
    }
    console.info(`${LOG_PREFIX} right-click download failed: ${code}`);
    await notify(id, t('notifyFailedTitle'), `${title || videoId}\n${t(errorInfo(code).message)}`);
  }
}

/** 選單被點擊：只處理我們的項目、YouTube 頁面上、指向單一影片的連結（FR-21）。 */
export function onContextMenuClicked(info: { menuItemId: unknown; linkUrl?: string; pageUrl?: string }): void {
  const kind = menuKind(info.menuItemId);
  if (!kind) return;
  const videoId = videoIdFromLink(info.linkUrl ?? '');
  if (!videoId) return;
  void downloadFromMenu(videoId, kind);
}

/** 點「需要安裝小幫手」的通知：打開設定頁的「下載」區（含安裝引導）。回傳是否處理了這個通知。 */
export function onMenuNotificationClicked(notificationId: string): boolean {
  if (notificationId === INSTALL_NOTIFICATION_ID) {
    void browser.notifications.clear(notificationId);
    // openOptionsPage 不能指定位置；tabs.create 開啟擴充功能自己的頁面不需要 tabs 權限。
    browser.tabs.create({ url: browser.runtime.getURL('/options.html#downloads') }).catch((err: unknown) => console.info(`${LOG_PREFIX} failed to open settings`, err));
    return true;
  }
  if (notificationId.startsWith('ytm-start:')) {
    void browser.notifications.clear(notificationId);
    return true;
  }
  return false;
}

/** 在背景腳本頂層同步註冊（Firefox 事件頁面、Chrome service worker 喚醒時都要有監聽器）。 */
export function registerContextMenu(): void {
  browser.contextMenus.onClicked.addListener((info) => onContextMenuClicked(info));
  browser.runtime.onInstalled.addListener(() => void rebuildContextMenus());
  browser.runtime.onStartup.addListener(() => void rebuildContextMenus());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && MENU_SETTING_KEYS.some((k) => k in changes)) void rebuildContextMenus();
  });
}
