import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applyPageClasses, pageClasses, PAGE_CLASS_TOGGLES } from './classes';
import { TIDY_CATEGORIES, TIDY_OPTIONS } from './options';
import { TIDY_CSS } from './styles';

describe('設定頁的分類（005 FR-1）', () => {
  it('依序為觀看頁、干擾、Shorts、介面，選項與規格相同', () => {
    expect(TIDY_CATEGORIES.map((c) => [c.id, c.options.map((o) => o.id)])).toEqual([
      ['watch', ['originalAudio', 'hideEndCards']],
      ['distractions', ['autoContinue', 'noThumbnailPreview']],
      ['shorts', ['shortsToWatch', 'hideShorts']],
      ['interface', ['fullTitles']],
    ]);
  });

  it('每個選項都有名稱與一行說明，設定存在 sync', () => {
    for (const o of TIDY_OPTIONS) {
      expect(o.label).not.toBe(o.description);
      expect(o.item.key.startsWith('sync:')).toBe(true);
    }
    expect(new Set(TIDY_OPTIONS.map((o) => o.item.key)).size).toBe(TIDY_OPTIONS.length);
  });

  describe('預設值', () => {
    beforeEach(() => fakeBrowser.reset());
    it('所有選項預設關閉（005 FR-2）', async () => {
      for (const o of TIDY_OPTIONS) expect(await o.item.getValue()).toBe(false);
    });
  });
});

/** 以最外層的逗號分開選擇器清單（括號內的逗號不算）。 */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

describe('CSS 開關機制（plan 3.7.2）', () => {
  it('每個 class 都有 ytm- 前綴、不重複', () => {
    const names = PAGE_CLASS_TOGGLES.map((t) => t.className);
    expect(names.every((n) => /^ytm-[a-z-]+$/.test(n))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('每個 class 在樣式中都有以 html.<class> 開頭的規則，所有規則都以 <html> 的 class 開頭', () => {
    for (const { className } of PAGE_CLASS_TOGGLES) expect(TIDY_CSS).toContain(`html.${className} `);
    const selectors = TIDY_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((block) => block.split('{')[0]!.trim())
      .filter(Boolean)
      .flatMap(splitTopLevel);
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel).toMatch(/^html\.ytm-[a-z-]+[\s.:[]/);
  });

  it('隱藏留言只在工具列啟用時作用（003 FR-5）', () => {
    expect(pageClasses({ hideComments: true }, true)).toContain('ytm-hide-comments');
    expect(pageClasses({ hideComments: true }, false)).not.toContain('ytm-hide-comments');
    expect(pageClasses({ hideComments: false }, true)).not.toContain('ytm-hide-comments');
  });

  it('005 的樣式選項不受工具列影響（005 FR-6）', () => {
    const all = { hideEndCards: true, noThumbnailPreview: true, hideShorts: true, fullTitles: true };
    const expected = ['ytm-hide-end-cards', 'ytm-no-thumbnail-preview', 'ytm-hide-shorts', 'ytm-full-titles'];
    expect(pageClasses(all, true)).toEqual(expected);
    expect(pageClasses(all, false)).toEqual(expected);
    expect(pageClasses({}, true)).toEqual([]);
  });

  it('需要程式的選項不使用 class', () => {
    expect(pageClasses({ originalAudio: true, autoContinue: true, shortsToWatch: true }, true)).toEqual([]);
  });

  it('樣式不包含自動播放倒數、不隱藏 Shorts 頁面本身的播放器', () => {
    expect(TIDY_CSS).not.toMatch(/autonav/);
    expect(TIDY_CSS).not.toMatch(/ytd-shorts|ytd-reel-video-renderer/);
  });

  it('applyPageClasses 只增減這個機制的 class，其他 class 不動', () => {
    // 測試環境沒有 DOM：以最小的 classList 代替。
    const classes = new Set(['ytm-cinema', 'something']);
    const root = {
      classList: {
        toggle: (name: string, force: boolean) => (force ? classes.add(name) : classes.delete(name), force),
      },
    } as unknown as Element;
    applyPageClasses(root, ['ytm-hide-comments']);
    expect(classes.has('ytm-hide-comments')).toBe(true);
    applyPageClasses(root, []);
    expect([...classes]).toEqual(['ytm-cinema', 'something']);
  });
});
