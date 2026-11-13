// 數字輸入框旁「−」「＋」按鈕的計算（010 FR-30、FR-31）。純函式。

/** 輸入框的文字是不是整數；不是時回傳 null。 */
export function parseInteger(text: string): number | null {
  return /^\s*-?\d+\s*$/.test(text) ? Number(text) : null;
}

/** 按一下「−」（-1）或「＋」（+1）後的值。輸入不是整數時從最小值開始；結果限制在 min–max。 */
export function stepValue(text: string, delta: -1 | 1, min: number, max: number): number {
  const n = parseInteger(text);
  if (n === null) return min;
  return Math.min(max, Math.max(min, n + delta));
}

/** 「−」「＋」是否可以使用：到達最小或最大值時停用；輸入不是整數時都可以使用。 */
export function stepperEnabled(text: string, min: number, max: number): { down: boolean; up: boolean } {
  const n = parseInteger(text);
  if (n === null) return { down: true, up: true };
  return { down: n > min, up: n < max };
}
