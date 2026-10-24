import { describe, expect, it } from 'vitest';
import { formatClock, formatRange, formatTime, isFullRange, parseTime, splitTime, validateRange } from './time';

describe('parseTime', () => {
  it.each([
    ['00:01:30', 90],
    ['1:02:03', 3723],
    ['01:30', 90],
    ['1:5', 65],
    ['45', 45],
    ['  00:00:07 ', 7],
    ['0', 0],
    ['100:00:00', 360000],
    ['99:00', 5940],
  ])('%s → %d 秒', (text, seconds) => {
    expect(parseTime(text)).toBe(seconds);
  });

  it.each(['', '   ', '00:99:00', '00:00:60', '1:60', 'abc', '1:2:3:4', '-5', '1.5', '01:', ':30', '1:-1', '1 : 2', '1234:00:00', '０１:３０'])(
    '%j 不合法',
    (text) => {
      expect(parseTime(text)).toBeNull();
    },
  );
});

describe('formatTime', () => {
  it('未滿 1 小時顯示 分:秒', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(90)).toBe('01:30');
    expect(formatTime(3599)).toBe('59:59');
  });

  it('滿 1 小時顯示 時:分:秒', () => {
    expect(formatTime(3600)).toBe('01:00:00');
    expect(formatTime(3723)).toBe('01:02:03');
    expect(formatTime(360000)).toBe('100:00:00');
  });

  it('可以強制顯示或不顯示小時', () => {
    expect(formatTime(60, true)).toBe('00:01:00');
    expect(formatTime(3723, false)).toBe('62:03');
  });

  it('小數捨去、負數與非數字視為 0', () => {
    expect(formatTime(19.9)).toBe('00:19');
    expect(formatTime(-3)).toBe('00:00');
    expect(formatTime(Number.NaN)).toBe('00:00');
  });

  it('格式化後再解析得到相同秒數', () => {
    for (const s of [0, 1, 59, 60, 61, 3599, 3600, 7322, 86399]) {
      expect(parseTime(formatTime(s, true))).toBe(s);
      expect(parseTime(formatTime(s))).toBe(s);
    }
  });
});

describe('validateRange（002 FR-22）', () => {
  const duration = 245.6; // 04:05

  it('合法的區間', () => {
    expect(validateRange('00:01:30', '00:03:45', duration)).toEqual({
      start: 90,
      end: 225,
      startError: null,
      endError: null,
      valid: true,
    });
  });

  it('結束可以等於影片長度（捨去小數）', () => {
    expect(validateRange('0', '04:05', duration).valid).toBe(true);
    expect(validateRange('0', '04:06', duration)).toMatchObject({ endError: 'outOfRange', valid: false });
  });

  it('格式錯誤', () => {
    expect(validateRange('00:99:00', '00:03:00', duration)).toMatchObject({ startError: 'format', valid: false });
    expect(validateRange('00:00', 'x', duration)).toMatchObject({ endError: 'format', valid: false });
  });

  it('超出影片長度', () => {
    expect(validateRange('00:05:00', '00:06:00', duration)).toMatchObject({
      startError: 'outOfRange',
      endError: 'outOfRange',
      valid: false,
    });
  });

  it('開始晚於或等於結束', () => {
    expect(validateRange('00:03:00', '00:01:00', duration)).toMatchObject({
      startError: 'order',
      endError: 'order',
      valid: false,
    });
    expect(validateRange('00:01:00', '00:01:00', duration).valid).toBe(false);
  });
});

describe('isFullRange（002 FR-21）', () => {
  it('從 0 到影片結束才算整部影片', () => {
    expect(isFullRange(0, 245, 245.6)).toBe(true);
    expect(isFullRange(0, 244, 245.6)).toBe(false);
    expect(isFullRange(1, 245, 245.6)).toBe(false);
  });
});

describe('splitTime／formatClock／formatRange（共用的拆分）', () => {
  it('拆成時分秒；小數捨去，負數與非數字為 0', () => {
    expect(splitTime(3723.9)).toEqual({ h: 1, m: 2, s: 3 });
    expect(splitTime(-5)).toEqual({ h: 0, m: 0, s: 0 });
    expect(splitTime(Number.NaN)).toEqual({ h: 0, m: 0, s: 0 });
  });

  it('小時不補零', () => {
    expect(formatClock(83)).toBe('01:23');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatRange({ start: 60, end: 90 })).toBe('01:00–01:30');
    expect(formatRange({ start: 3600, end: 3723 })).toBe('1:00:00–1:02:03');
  });
});
