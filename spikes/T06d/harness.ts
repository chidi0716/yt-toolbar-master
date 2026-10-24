// T06d 實測用：把擴充功能實際的頁面橋接處理（main world 端）與深色模式模組打包成一段程式，
// 由 probe-home.mjs 以 page.evaluate 放進 YouTube 首頁執行（工具列只在觀看頁出現）。
// 只在實測腳本中使用，不屬於擴充功能。擴充功能中兩者分別在 main world 與 isolated world 執行，
// 以 document 上的事件溝通；這裡兩者都在頁面中，事件流程相同。
import { createDarkMode } from '@/features/viewing/dark-mode';
import { BRIDGE_REQUEST_EVENT, BRIDGE_RESPONSE_EVENT, handleBridgeRequest, parseBridgeRequest } from '@/utils/youtube/bridge';
import { findPlayer, type YtPlayerApi } from '@/utils/youtube/dom';

// 擴充功能外沒有 browser.i18n：提示文字以訊息名稱代替。
(globalThis as unknown as { browser: unknown }).browser = { i18n: { getMessage: (key: string) => key } };

// window.__ytmNoBridge = true 時不處理橋接請求：選項無法被標記，用來測試找不到選項時的處理（FR-15）。
if (!(window as unknown as { __ytmNoBridge?: boolean }).__ytmNoBridge) {
  document.addEventListener(BRIDGE_REQUEST_EVENT, (event) => {
    const req = parseBridgeRequest((event as CustomEvent<unknown>).detail);
    if (!req) return;
    const res = handleBridgeRequest(req, findPlayer() as (HTMLElement & YtPlayerApi) | null, document);
    document.dispatchEvent(new CustomEvent(BRIDGE_RESPONSE_EVENT, { detail: JSON.stringify(res) }));
  });
}

const dark = createDarkMode();
dark.start();
(window as unknown as { __ytmDark: typeof dark }).__ytmDark = dark;
