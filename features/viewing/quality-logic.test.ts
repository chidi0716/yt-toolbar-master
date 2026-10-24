import { describe, expect, it } from 'vitest';
import type { QualityCode } from '@/utils/youtube/dom';
import { isManualChange, lockHeight, pickQuality } from './quality-logic';

const UP_TO_4K: QualityCode[] = ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
const UP_TO_720: QualityCode[] = ['hd720', 'large', 'medium', 'small', 'tiny'];

describe('lockHeight', () => {
  it('關閉為 null，最高為不限，其他為畫面高度', () => {
    expect(lockHeight('off')).toBeNull();
    expect(lockHeight('max')).toBe(Number.POSITIVE_INFINITY);
    expect(lockHeight('1080')).toBe(1080);
    expect(lockHeight('480')).toBe(480);
  });
});

describe('pickQuality（004 FR-2）', () => {
  it('有 4K 的影片鎖定 1080p 時使用 1080p', () => {
    expect(pickQuality('1080', UP_TO_4K)).toBe('hd1080');
  });

  it('最高只有 720p 的影片鎖定 1080p 時使用 720p', () => {
    expect(pickQuality('1080', UP_TO_720)).toBe('hd720');
  });

  it('每個鎖定值都對應到正確的代號', () => {
    expect(pickQuality('2160', UP_TO_4K)).toBe('hd2160');
    expect(pickQuality('1440', UP_TO_4K)).toBe('hd1440');
    expect(pickQuality('720', UP_TO_4K)).toBe('hd720');
    expect(pickQuality('480', UP_TO_4K)).toBe('large');
  });

  it('最高可用畫質：選最高的', () => {
    expect(pickQuality('max', UP_TO_4K)).toBe('hd2160');
    expect(pickQuality('max', UP_TO_720)).toBe('hd720');
    expect(pickQuality('max', ['hd1080', 'highres', 'hd2880'])).toBe('highres');
  });

  it('清單順序不影響結果', () => {
    expect(pickQuality('1080', ['tiny', 'hd720', 'hd2160', 'hd1080', 'large'])).toBe('hd1080');
  });

  it('所有畫質都高於鎖定值時使用最低的畫質', () => {
    expect(pickQuality('480', ['hd1080', 'hd720'])).toBe('hd720');
  });

  it('鎖定關閉或沒有可用畫質時回傳 null', () => {
    expect(pickQuality('off', UP_TO_4K)).toBeNull();
    expect(pickQuality('1080', [])).toBeNull();
  });
});

describe('isManualChange（004 FR-3、FR-4）', () => {
  it('設定選單操作後 10 秒內的改變是使用者手動選擇', () => {
    expect(isManualChange(1_000, 1_500)).toBe(true);
    expect(isManualChange(1_000, 11_000)).toBe(true);
  });

  it('沒有操作、或操作太久以前的改變是 YouTube 自動調整', () => {
    expect(isManualChange(null, 5_000)).toBe(false);
    expect(isManualChange(1_000, 11_001)).toBe(false);
    expect(isManualChange(5_000, 1_000)).toBe(false);
  });
});
