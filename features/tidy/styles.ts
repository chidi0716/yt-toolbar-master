// CSS 開關機制的樣式（plan 3.7.2：所有相關樣式放在同一個樣式檔）。
// 每條規則都以 <html> 上的 class 開頭，選擇器來自 utils/youtube/dom.ts（constitution 第 7 點）。
import { ensureStyle } from '@/utils/style';
import {
  END_SCREEN_SELECTORS,
  SELECTORS,
  SHORTS_GUIDE_SELECTORS,
  SHORTS_SELECTORS,
  THUMBNAIL_PREVIEW_SELECTORS,
  VIDEO_TITLE_SELECTORS,
} from '@/utils/youtube/dom';

/** 選擇器清單 → :is(…)。:is() 會略過無法解析的選擇器，單一選擇器失效不影響其他（005 FR-7）。 */
const any = (selectors: readonly string[]) => `:is(${selectors.join(', ')})`;

const STYLE_ID = 'ytm-tidy-styles';

/** 每個 class 的規則（plan 3.7.2）。 */
const TIDY_RULES: Record<string, string> = {
  // 003 FR-64 隱藏留言
  'ytm-hide-comments': `html.ytm-hide-comments ${SELECTORS.comments} {
  display: none !important;
}`,
  // 005 FR-20、FR-21 隱藏片尾推薦卡片與結尾畫面（自動播放倒數不在清單中，FR-22）
  'ytm-hide-end-cards': `html.ytm-hide-end-cards ${any(END_SCREEN_SELECTORS)} {
  display: none !important;
}`,
  // 005 FR-40 停用縮圖自動預覽：預覽播放器不顯示，縮圖維持靜態圖片；點縮圖照常開啟影片（FR-41）
  'ytm-no-thumbnail-preview': `html.ytm-no-thumbnail-preview ${any(THUMBNAIL_PREVIEW_SELECTORS)} {
  display: none !important;
}`,
  // 005 FR-60 至 FR-62 隱藏 Shorts：以 display: none 移除，格狀清單會重新排列，不留空位
  'ytm-hide-shorts': `html.ytm-hide-shorts ${any([...SHORTS_SELECTORS, ...SHORTS_GUIDE_SELECTORS])} {
  display: none !important;
}`,
  // 005 FR-70、FR-71 顯示完整影片標題：取消行數與高度限制，卡片跟著變高
  'ytm-full-titles': `html.ytm-full-titles ${any(VIDEO_TITLE_SELECTORS)} {
  -webkit-line-clamp: unset !important;
  line-clamp: unset !important;
  max-height: none !important;
  overflow: visible !important;
  text-overflow: clip !important;
  white-space: normal !important;
}`,
};

/**
 * 開啟中的選項的樣式。關閉的選項不放規則：YouTube 每次改變版面時，瀏覽器不必比對用不到的選擇器
 * （例如 :has()）。
 */
export const tidyCss = (active: readonly string[]): string =>
  active
    .map((className) => TIDY_RULES[className])
    .filter(Boolean)
    .join('\n');

/** 把頁面上的樣式換成開啟中的選項的規則（內容沒變時不動）。 */
export function applyTidyStyles(active: readonly string[], doc: Document = document): void {
  ensureStyle(STYLE_ID, tidyCss(active), doc);
}
