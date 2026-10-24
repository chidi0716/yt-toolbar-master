// 擴充功能加在 YouTube 頁面上的元素的堆疊順序，集中在這裡（003 FR-20a、FR-40、008 FR-28）。
// 工具列的 Shadow DOM 以 CSS 變數 --ytm-z-* 引用（toolbarZIndexCss），頁面樣式直接代入數值。

export const Z_INDEX = {
  /** 新版本提醒卡片：低於面板與浮動播放器，不會蓋住浮動中的影片。 */
  updateCard: 2050,
  /** 展開的面板。 */
  panel: 2100,
  /** 浮動中的播放器容器。 */
  floatingPlayer: 2150,
  /** 浮動播放器的拖曳列與 ✕。 */
  floatingControls: 2151,
  /** 劇院模式：工具列維持在調暗的區域之上，展開的面板不會被遮住。 */
  cinemaToolbar: 2201,
  /** 滾輪調音量的提示。 */
  volumeHint: 2300,
} as const;

/** 工具列 Shadow DOM 使用的 CSS 變數。 */
export const toolbarZIndexCss = `:host { --ytm-z-panel: ${Z_INDEX.panel}; --ytm-z-update-card: ${Z_INDEX.updateCard}; }`;
