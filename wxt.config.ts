import { defineConfig } from 'wxt';

// Chrome：固定的公鑰，讓未封裝載入的擴充功能 ID 永遠相同（plan 3.3）。
// 對應的擴充功能 ID 記錄在 specs/notes/extension-ids.md。私鑰不在 repo 內。
const CHROME_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnS+lCUvqBBGgNYybmUV8UIN1ouvn806lrte+WCYPOHr0A2q0cjGqDnmWRgizBxPjC72dl0cPYuDIU72d567E/vEB1LK3x16PXv+RYSnsOglIN3n4/a4uuyhs5NI+XDaas9KRC1zA275TO2rQPRqBH+fOmKtAgivD0RlYceYxVmc8mKWzbTe0boZqk/uJA/qsRv7YIwb9GXyIddvR5Y6PobfHCp+XfaP3CXChKHjrprca+XIt+4K2FscNimY3KZ0vzEbZV6WQ+k/dnx7yF56feeWuaxEvP+vHhxw7yx3ogiZBN4omc42Wvt6baORZF+Un27V8vCvjF07UTsnOFe07cQIDAQAB';

// Firefox：固定的附加元件 ID（plan 3.3）。
const GECKO_ID = 'yt-toolbar-master@chidi0716';

// Firefox：簽署版由瀏覽器依這個網址自動更新（plan 4.10、008 FR-23）。網址會轉址到最新正式版本
// （不含預先發行版本）的 updates.json，由發佈流程產生。
const GECKO_UPDATE_URL = 'https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/updates.json';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  // Chrome 與 Firefox 都輸出 Manifest V3（plan 第 2 節、T00 結論）。
  manifestVersion: 3,

  // Preact + TSX：使用 Vite 內建的 JSX 轉換（automatic runtime），從 preact 匯入。
  vite: () => ({
    oxc: {
      jsx: {
        runtime: 'automatic',
        importSource: 'preact',
      },
    },
  }),

  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // 權限完全依 plan 3.2，每一項的用途寫在 plan 中。
    // contextMenus：影片連結的右鍵下載（009 第三節），不會產生安裝警告。
    permissions: ['storage', 'downloads', 'notifications', 'nativeMessaging', 'contextMenus'],
    host_permissions: ['*://*.youtube.com/*', 'https://i.ytimg.com/*'],
    ...(browser === 'firefox'
      ? {
          // plan 3.3.1：以 AMO 不公開頻道送簽署。
          browser_specific_settings: {
            gecko: {
              id: GECKO_ID,
              // main world 內容腳本需要 128、data_collection_permissions 需要 140（constitution 第 5 點）。
              strict_min_version: '140.0',
              // 不收集任何資料（constitution 第 2 點）。
              data_collection_permissions: { required: ['none'] },
              update_url: GECKO_UPDATE_URL,
            },
          },
        }
      : { key: CHROME_PUBLIC_KEY }),
  }),
});
