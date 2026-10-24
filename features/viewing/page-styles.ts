// 觀看輔助功能加在 YouTube 頁面上的樣式（constitution 第 6 點：只用 ytm- 前綴的 class，
// 不改 YouTube 原本的屬性）。選擇器來自 utils/youtube/dom.ts。
import { APPEARANCE_MENU, CINEMA_DIMMED_REGIONS, SELECTORS } from '@/utils/youtube/dom';

const STYLE_ID = 'ytm-page-styles';

/** 深色模式操作 YouTube 外觀選單期間加在 <html> 上的 class（003 FR-11：選單不得被看見）。 */
export const THEME_MENU_BUSY_CLASS = 'ytm-theme-menu-busy';

/** 劇院模式時加在 <html> 上的 class。 */
export const CINEMA_CLASS = 'ytm-cinema';
/** 劇院模式調暗區域的不透明度：變暗約 93%（003 FR-20）。 */
export const CINEMA_DIM_OPACITY = 0.07;

export const PAGE_CSS = `
/*
 * 劇院模式（003 FR-20、FR-20a）：分區調暗。不使用蓋住整頁的遮罩——播放器位於多層形成堆疊脈絡的
 * 容器內，提高 z-index 無法跳出遮罩。改為只調暗播放器容器與工具列以外的區域，頁面背景改為黑色。
 */
html.${CINEMA_CLASS},
html.${CINEMA_CLASS} body,
html.${CINEMA_CLASS} ytd-app {
  background: #000 !important;
}
html.${CINEMA_CLASS} :is(${CINEMA_DIMMED_REGIONS.join(', ')}) {
  opacity: ${CINEMA_DIM_OPACITY} !important;
  cursor: pointer;
}

/* 深色模式（003 FR-11）：擴充功能代替使用者操作 YouTube 外觀選單時，選單不可見也不可點。 */
html.${THEME_MENU_BUSY_CLASS} ${APPEARANCE_MENU.popup} {
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 浮動播放器（003 FR-40）：位置與尺寸由 features/viewing/floating.ts 另外寫入。 */
.ytm-floating {
  position: fixed !important;
  right: auto !important;
  bottom: auto !important;
  z-index: 2150 !important;
  overflow: hidden !important;
  border-radius: 12px !important;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5) !important;
}

/* 隱藏留言（003 FR-64）改由 CSS 開關機制處理：features/tidy/styles.ts */

/* 純音訊模式（003 FR-62）：隱藏畫面，縮圖由 features/viewing/audio-only.ts 另外寫入。 */
html.ytm-audio-only ${SELECTORS.videoContainer} {
  background: #000 center / contain no-repeat !important;
}
html.ytm-audio-only ${SELECTORS.videoContainer} video {
  opacity: 0 !important;
}
`;

/** 在頁面加入一次共用樣式（重複呼叫沒有作用）。 */
export function ensurePageStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PAGE_CSS;
  (doc.head ?? doc.documentElement).append(style);
}
