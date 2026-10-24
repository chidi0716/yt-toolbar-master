// 加在 YouTube 頁面上的 <style>（constitution 第 6 點：只用 ytm- 前綴的 class 與 id）。

/**
 * 以 id 識別的 <style>：沒有時建立，內容不同時更新。在 document_start 執行時 <head> 不一定存在，
 * 這時直接放在 <html> 底下。
 */
export function ensureStyle(id: string, css: string, doc: Document = document): HTMLStyleElement {
  let style = doc.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = id;
    (doc.head ?? doc.documentElement).append(style);
  }
  if (style.textContent !== css) style.textContent = css;
  return style;
}
