// 劇院模式（T07a，003 FR-20 至 FR-21）的設定檢查。實際的遮蓋與點擊在假觀看頁上以 elementFromPoint 驗證
// （spikes/stage1-smoke/viewing-test.mjs 的 T07）。
import { describe, expect, it } from 'vitest';
import { CINEMA_DIMMED_REGIONS } from '@/utils/youtube/dom';
import { CINEMA_INTERCEPTED_EVENTS } from './cinema';
import { CINEMA_CLASS, CINEMA_DIM_OPACITY, PAGE_CSS } from './page-styles';

/** 選擇器去掉 :not(...) 後剩下的部分（也就是實際被調暗的元素）；以 > 結尾表示「任何子元素」。 */
const withoutNot = (selector: string) => {
  const rest = selector.replace(/:not\([^)]*\)/g, '').trim();
  return rest.endsWith('>') ? `${rest} *` : rest;
};

describe('劇院模式調暗的區域', () => {
  it('包含頂端列、側欄、播放器下方（標題、說明、留言）', () => {
    expect(CINEMA_DIMMED_REGIONS).toContain('#masthead-container');
    // 右側欄（#secondary）是 #columns 中 #primary 以外的欄位
    expect(CINEMA_DIMMED_REGIONS).toContain('ytd-watch-flexy #columns > :not(#primary)');
    expect(CINEMA_DIMMED_REGIONS.some((s) => s.startsWith('ytd-watch-flexy #below >'))).toBe(true);
  });

  it('不調暗播放器、播放器的容器與祖先，也不調暗工具列（FR-20a）', () => {
    const protectedParts = ['#movie_player', '#player-container', '#player', 'ytm-toolbar', 'ytd-player', '#primary', '#columns', 'ytd-app', '#player-full-bleed-container', '#full-bleed-container', 'ytd-watch-flexy'];
    for (const selector of CINEMA_DIMMED_REGIONS) {
      const target = withoutNot(selector).trim().split(/\s+|>/).filter(Boolean).at(-1) ?? '';
      for (const part of protectedParts) expect(target === part, `${selector} 調暗了 ${part}`).toBe(false);
    }
    // 以「容器的其他子元素」表示的區域，都排除了包含播放器（或工具列）的那個子元素
    expect(CINEMA_DIMMED_REGIONS).toContain('ytd-watch-flexy #full-bleed-container > :not(#player-full-bleed-container)');
    expect(CINEMA_DIMMED_REGIONS).toContain('ytd-watch-flexy #primary-inner > :not(#player):not(#below)');
    // #below 本身包含工具列，只能調暗它的其他子元素
    expect(CINEMA_DIMMED_REGIONS).not.toContain('ytd-watch-flexy #below');
    expect(CINEMA_DIMMED_REGIONS.find((s) => s.includes('#below'))).toContain(':not(ytm-toolbar)');
  });

  it('樣式：只在 <html> 有 class 時作用，背景變黑，區域變暗約 90–95%', () => {
    expect(CINEMA_DIM_OPACITY).toBeGreaterThanOrEqual(0.05);
    expect(CINEMA_DIM_OPACITY).toBeLessThanOrEqual(0.1);
    expect(PAGE_CSS).toContain(`html.${CINEMA_CLASS} :is(${CINEMA_DIMMED_REGIONS.join(', ')})`);
    expect(PAGE_CSS).toMatch(new RegExp(`html\\.${CINEMA_CLASS} ytd-app \\{\\s*background: #000 !important;`));
    // 不再使用整頁遮罩
    expect(PAGE_CSS).not.toContain('ytm-cinema-overlay');
  });
});

describe('劇院模式攔截的事件', () => {
  it('點擊用來關閉；中鍵與按下／放開也一併攔截，避免誤觸連結（FR-21）', () => {
    expect(CINEMA_INTERCEPTED_EVENTS).toContain('click');
    expect(CINEMA_INTERCEPTED_EVENTS).toContain('auxclick');
    expect(CINEMA_INTERCEPTED_EVENTS).toContain('pointerdown');
    expect(CINEMA_INTERCEPTED_EVENTS).toContain('mousedown');
  });
});
