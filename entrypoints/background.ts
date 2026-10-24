import { handleDownloadMessage } from '@/features/downloads/background';
import { handleHostMessage, onNotificationClicked, resumeDownloads } from '@/features/downloads/host-background';
import { browserUpdateService } from '@/features/update/background';
import { initI18n } from '@/utils/i18n';
import { isContentMessage } from '@/utils/messages';

export default defineBackground(() => {
  // 新版本提醒（008 第三之一節）：查詢只在內容腳本送 updateCheck 時進行，不在啟動時或背景定時查詢（FR-27）。
  const updates = browserUpdateService();
  // 監聽器必須在頂層同步註冊（Firefox 事件頁面，見 specs/notes/T00-firefox-mv3.md）。
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 只接受本擴充功能自己的內容腳本或頁面送來、且格式正確的訊息。
    if (sender.id !== browser.runtime.id || !isContentMessage(message)) return;
    switch (message.type) {
      case 'openOptions':
        void browser.runtime.openOptionsPage();
        return;
      case 'platformInfo':
        browser.runtime.getPlatformInfo().then(
          (info) => sendResponse({ ok: true, os: info.os }),
          () => sendResponse({ ok: false, error: 'UNKNOWN' }),
        );
        return true;
      case 'updateCheck':
      case 'updateStatus':
      case 'updateAction': {
        const done =
          message.type === 'updateCheck' ? updates.checkIfDue() : message.type === 'updateStatus' ? updates.status() : updates.act(message.action, message.version);
        done.then(
          (view) => sendResponse({ ok: true, view }),
          (err: unknown) => {
            console.info('[yt-toolbar-master] update reminder failed', err);
            sendResponse({ ok: false, error: 'UNKNOWN' });
          },
        );
        return true;
      }
      default:
        // 經由橋接程式的下載（階段 4）；縮圖、截圖、直接下載的字幕（階段 4a）。
        // 非同步處理後以 sendResponse 回覆。
        return handleHostMessage(message, sender.tab?.id, sendResponse) || handleDownloadMessage(message, sendResponse);
    }
  });
  // 點下載完成的通知：在 Finder／檔案總管中顯示檔案（002 FR-5）。
  browser.notifications.onClicked.addListener(onNotificationClicked);
  // 有進行中的下載時重新連線，繼續接收進度並補發通知（002 FR-7、plan 4.6）。
  void resumeDownloads();
  // 圖示的 NEW 標記：瀏覽器重新啟動或擴充功能更新後依記錄重新設定（更新到最新版本後消失，FR-29a）。
  void updates.refreshBadge();
  // 通知等文字使用設定的介面語言（007 FR-3）。
  void initI18n();
});
