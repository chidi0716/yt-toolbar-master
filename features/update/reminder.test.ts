import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReminderView } from '@/utils/update-check';
import { COLLAPSE_AFTER_MS, createReminderController, PRESENCE_MS, type ReminderController } from './reminder';

const view = (patch: Partial<ReminderView> = {}): ReminderView => ({
  currentVersion: '0.1.0',
  eligible: true,
  latest: { version: '0.2.0', title: 'v0.2.0', url: 'https://github.com/chidi0716/yt-toolbar-master/releases/tag/v0.2.0' },
  lastCheckedAt: 0,
  lastResult: 'ok',
  disabled: false,
  pending: true,
  showCard: true,
  ...patch,
});

const READY = { mounted: true, pageVisible: true, inViewport: true, pageBlocked: false, toolbarBlocked: false };

describe('新版本提醒卡片（008 FR-28、constitution 第 7c 點）', () => {
  let shown: string[];
  let c: ReminderController;
  const phase = () => c.state.get().phase;
  const visible = () => c.state.get().cardVisible;
  /** 使用者持續操作：每秒移動一次滑鼠，共 ms 毫秒。 */
  const activeFor = (ms: number) => {
    for (let t = 0; t < ms; t += 1000) {
      c.activity();
      vi.advanceTimersByTime(Math.min(1000, ms - t));
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
    c = createReminderController({
      onCardShown: (v) => shown.push(v),
      timers: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t as number) },
    });
  });
  afterEach(() => {
    c.dispose();
    vi.useRealTimers();
  });

  it('沒有提醒時什麼都不顯示', () => {
    c.setConditions(READY);
    c.setView(view({ pending: false, showCard: false }));
    expect(phase()).toBe('none');
    expect(shown).toEqual([]);
  });

  it('條件符合時出現，並回報「今天已經出現過」', () => {
    c.setConditions(READY);
    c.setView(view());
    expect(phase()).toBe('card');
    expect(visible()).toBe(true);
    expect(shown).toEqual(['0.2.0']);
  });

  it.each([
    ['展開的面板或編輯工具列', { toolbarBlocked: true }],
    ['全螢幕、子母畫面或正在輸入', { pageBlocked: true }],
    ['分頁在背景', { pageVisible: false }],
    ['工具列不在畫面中', { inViewport: false }],
    ['工具列被關閉（未掛載）', { mounted: false }],
  ])('%s：延後，條件符合後才出現', (_name, blocked) => {
    c.setConditions({ ...READY, ...blocked });
    c.setView(view());
    expect(phase()).toBe('waiting');
    expect(visible()).toBe(false);
    expect(shown).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(phase()).toBe('waiting');
    c.setConditions(READY);
    expect(phase()).toBe('card');
    expect(visible()).toBe(true);
    expect(shown).toEqual(['0.2.0']);
  });

  it('使用者沒有任何操作時不計時：離開電腦時卡片不會收合', () => {
    c.setConditions(READY);
    c.setView(view());
    vi.advanceTimersByTime(10 * 60_000);
    expect(phase()).toBe('card');
    expect(c.elapsed()).toBe(0);
  });

  it('有操作後才開始計時，累計 15 秒沒有處理就收合成小圓點', () => {
    c.setConditions(READY);
    c.setView(view());
    activeFor(COLLAPSE_AFTER_MS - 1000);
    expect(phase()).toBe('card');
    activeFor(1000);
    expect(phase()).toBe('collapsed');
    expect(visible()).toBe(false);
  });

  it('操作一次後離開：只計算操作後短暫的時間，之後暫停，回來操作才繼續', () => {
    c.setConditions(READY);
    c.setView(view());
    c.activity();
    vi.advanceTimersByTime(10 * 60_000);
    expect(phase()).toBe('card');
    expect(c.elapsed()).toBe(PRESENCE_MS);
    activeFor(COLLAPSE_AFTER_MS - PRESENCE_MS);
    expect(phase()).toBe('collapsed');
  });

  it('分頁在背景時暫停；回到前景後要再次操作才繼續', () => {
    c.setConditions(READY);
    c.setView(view());
    activeFor(5000);
    expect(c.elapsed()).toBe(5000);
    c.setConditions({ pageVisible: false });
    c.activity(); // 背景中的事件不算
    vi.advanceTimersByTime(60_000);
    expect(c.elapsed()).toBe(5000);
    c.setConditions({ pageVisible: true });
    vi.advanceTimersByTime(60_000);
    expect(c.elapsed()).toBe(5000);
    expect(phase()).toBe('card');
    activeFor(10_000);
    expect(phase()).toBe('collapsed');
  });

  it('滑鼠停在卡片上時暫停', () => {
    c.setConditions(READY);
    c.setView(view());
    activeFor(5000);
    c.hover(true);
    for (let i = 0; i < 60; i++) {
      c.activity();
      vi.advanceTimersByTime(1000);
    }
    expect(c.elapsed()).toBe(5000);
    expect(phase()).toBe('card');
    c.hover(false);
    activeFor(10_000);
    expect(phase()).toBe('collapsed');
  });

  it('卡片顯示中展開面板：暫時隱藏並暫停，收起面板後回來', () => {
    c.setConditions(READY);
    c.setView(view());
    activeFor(5000);
    c.setConditions({ toolbarBlocked: true });
    expect(visible()).toBe(false);
    expect(phase()).toBe('card');
    activeFor(30_000);
    expect(c.elapsed()).toBe(5000);
    c.setConditions({ toolbarBlocked: false });
    expect(visible()).toBe(true);
    expect(shown).toEqual(['0.2.0']); // 不會重複回報
  });

  it('✕：只關閉這次，收合成小圓點', () => {
    c.setConditions(READY);
    c.setView(view());
    c.dismiss();
    expect(phase()).toBe('collapsed');
  });

  it('卡片出現後背景腳本回報 showCard=false：維持卡片，不會立刻收合', () => {
    c.setConditions(READY);
    c.setView(view());
    c.setView(view({ showCard: false }));
    expect(phase()).toBe('card');
  });

  it('今天已經出現過：直接是小圓點，保留到處理為止', () => {
    c.setConditions(READY);
    c.setView(view({ showCard: false }));
    expect(phase()).toBe('collapsed');
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(phase()).toBe('collapsed');
    expect(shown).toEqual([]);
  });

  it('處理後（前往下載、跳過、不再提醒）立即消失；背景腳本回報 pending=false 時也消失', () => {
    c.setConditions(READY);
    c.setView(view());
    c.handled();
    expect(phase()).toBe('none');
    c.setView(view({ showCard: false }));
    expect(phase()).toBe('collapsed');
    c.setView(view({ pending: false, showCard: false }));
    expect(phase()).toBe('none');
  });

  it('收合後出現更新的版本：再以卡片出現', () => {
    c.setConditions(READY);
    c.setView(view());
    c.dismiss();
    c.setView(view({ latest: { version: '0.3.0', title: 'v0.3.0', url: 'https://github.com/chidi0716/yt-toolbar-master/releases/tag/v0.3.0' } }));
    expect(phase()).toBe('card');
    expect(shown).toEqual(['0.2.0', '0.3.0']);
  });
});
