// CSS 開關機制（plan 3.7.2、constitution 第 7 點）：依設定在 <html> 加上有前綴的 class，
// 由 styles.ts 的樣式處理頁面外觀。開關時只改變 class，不需要持續執行的程式（005 NFR-1）。
import type { TidyOptionId } from './options';

/** class 由哪個設定決定：頁面整理的選項，或 003 的「隱藏留言」。 */
export type ClassSource = TidyOptionId | 'hideComments';

export interface PageClassToggle {
  className: string;
  source: ClassSource;
  /**
   * 只在工具列啟用時作用：003 的功能（「更多」面板中的開關）在工具列關閉時一併停止（003 FR-5）；
   * 頁面整理的選項不受工具列影響（005 FR-6）。
   */
  requiresToolbar: boolean;
}

export const PAGE_CLASS_TOGGLES: readonly PageClassToggle[] = [
  // 003 FR-64 隱藏留言
  { className: 'ytm-hide-comments', source: 'hideComments', requiresToolbar: true },
  // 005 只靠樣式的選項（NFR-1）
  { className: 'ytm-hide-end-cards', source: 'hideEndCards', requiresToolbar: false },
  { className: 'ytm-no-thumbnail-preview', source: 'noThumbnailPreview', requiresToolbar: false },
  { className: 'ytm-hide-shorts', source: 'hideShorts', requiresToolbar: false },
  { className: 'ytm-full-titles', source: 'fullTitles', requiresToolbar: false },
];

/** 依設定值計算 <html> 上應有的 class。 */
export function pageClasses(values: Partial<Record<ClassSource, boolean>>, toolbarEnabled: boolean): string[] {
  return PAGE_CLASS_TOGGLES.filter((t) => values[t.source] === true && (!t.requiresToolbar || toolbarEnabled)).map((t) => t.className);
}

/** 把 <html> 上屬於這個機制的 class 設成指定的集合；其他 class 不動。 */
export function applyPageClasses(root: Element, active: readonly string[]): void {
  for (const { className } of PAGE_CLASS_TOGGLES) root.classList.toggle(className, active.includes(className));
}
