import { describe, expect, it } from 'vitest';
import { parseInteger, stepperEnabled, stepValue } from './stepper-math';

describe('parseInteger', () => {
  it('只接受整數', () => {
    expect(parseInteger('3')).toBe(3);
    expect(parseInteger(' 12 ')).toBe(12);
    expect(parseInteger('')).toBeNull();
    expect(parseInteger('1.5')).toBeNull();
    expect(parseInteger('abc')).toBeNull();
  });
});

describe('stepValue（010 FR-31）', () => {
  it('加減一並限制在範圍內', () => {
    expect(stepValue('3', 1, 1, 99)).toBe(4);
    expect(stepValue('3', -1, 1, 99)).toBe(2);
    expect(stepValue('1', -1, 1, 99)).toBe(1);
    expect(stepValue('99', 1, 1, 99)).toBe(99);
  });

  it('超出範圍的輸入拉回範圍內', () => {
    expect(stepValue('150', -1, 1, 99)).toBe(99);
    expect(stepValue('0', 1, 1, 99)).toBe(1);
  });

  it('不是整數時從最小值開始', () => {
    expect(stepValue('', 1, 1, 99)).toBe(1);
    expect(stepValue('x', -1, 1, 99)).toBe(1);
  });
});

describe('stepperEnabled（010 FR-31）', () => {
  it('到達最小或最大值時對應按鈕停用', () => {
    expect(stepperEnabled('1', 1, 99)).toEqual({ down: false, up: true });
    expect(stepperEnabled('99', 1, 99)).toEqual({ down: true, up: false });
    expect(stepperEnabled('50', 1, 99)).toEqual({ down: true, up: true });
  });

  it('輸入不是整數時都可以使用', () => {
    expect(stepperEnabled('', 1, 99)).toEqual({ down: true, up: true });
  });
});
