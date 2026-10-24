import { describe, expect, it } from 'vitest';
import { TOOL_IDS } from '@/utils/toolbar-layout';
import { FIXED, TOOLS, getButton, isToolOngoing } from './buttons';

describe('工具註冊表（006、plan 3.7.3）', () => {
  it('設定模型中的每個工具都有定義，識別字串一致', () => {
    for (const id of TOOL_IDS) expect(TOOLS[id].id).toBe(id);
    expect(Object.keys(TOOLS).sort()).toEqual([...TOOL_IDS].sort());
    expect(getButton('more')).toBe(FIXED.more);
    expect(getButton('loop')).toBe(TOOLS.loop);
  });

  it('類型：面板、切換、執行', () => {
    expect(TOOLS.video.kind).toBe('panel');
    expect(TOOLS.floating.kind).toBe('toggle');
    expect(TOOLS.screenshot.kind).toBe('action');
  });
});

describe('isToolOngoing（006 FR-17：隱藏的工具進行中時「更多」顯示圓點）', () => {
  it('下載中（含不確定進度）', () => {
    expect(isToolOngoing('video', { progress: 30 })).toBe(true);
    expect(isToolOngoing('mp3', { progress: 'indeterminate' })).toBe(true);
    expect(isToolOngoing('video', { progress: null })).toBe(false);
  });
  it('循環中', () => {
    expect(isToolOngoing('loop', { active: true })).toBe(true);
    expect(isToolOngoing('loop', { active: false })).toBe(false);
  });
  it('浮動、劇院、子母畫面開啟中；深色模式不算', () => {
    expect(isToolOngoing('floating', { active: true })).toBe(true);
    expect(isToolOngoing('cinema', { active: true })).toBe(true);
    expect(isToolOngoing('pip', { active: false })).toBe(false);
    expect(isToolOngoing('darkMode', { active: true })).toBe(false);
  });
});
