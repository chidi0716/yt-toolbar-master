// 時間的解析、格式化與區間驗證（002 FR-20 至 FR-22、003 FR-50）。純函式。

/** 時:分:秒 輸入框裡最多接受的小時位數。 */
const MAX_HOUR_DIGITS = 3;

/**
 * 解析使用者輸入的時間，回傳秒數；格式不合法時回傳 null。
 *
 * 接受 `時:分:秒`、`分:秒`、`秒`。除了最前面的欄位，其他欄位必須是 1–2 位數字且小於 60
 * （例如 `00:99:00` 不合法）。前後空白會被忽略。
 */
export function parseTime(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length > 3) return null;
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const isFirst = i === 0;
    const maxDigits = isFirst ? (parts.length === 3 ? MAX_HOUR_DIGITS : 5) : 2;
    if (!new RegExp(`^\\d{1,${maxDigits}}$`).test(part)) return null;
    const n = Number(part);
    if (!isFirst && n >= 60) return null;
    seconds = seconds * 60 + n;
  }
  return seconds;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** 秒數拆成時、分、秒（小數無條件捨去；負數與非數字視為 0）。所有時間格式共用。 */
export function splitTime(seconds: number): { h: number; m: number; s: number } {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/**
 * 把秒數格式化成 `時:分:秒`（例如 `00:01:30`）或 `分:秒`（例如 `01:30`）。
 * 小數會無條件捨去；負數視為 0。`withHours` 未指定時，滿 1 小時才顯示小時欄位。
 */
export function formatTime(seconds: number, withHours?: boolean): string {
  const { h, m, s } = splitTime(seconds);
  const showHours = withHours ?? h > 0;
  return showHours ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m + h * 60)}:${pad2(s)}`;
}

/** 小時不補零的時間：`01:23`、`1:02:03`（剩餘時間、下載說明中的時間範圍）。 */
export function formatClock(seconds: number): string {
  const { h, m, s } = splitTime(seconds);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** 時間範圍，例如 `01:00–01:30`。 */
export const formatRange = (section: { start: number; end: number }) => `${formatClock(section.start)}–${formatClock(section.end)}`;

export type TimeError = 'format' | 'outOfRange' | 'order';

export interface RangeValidation {
  start: number | null;
  end: number | null;
  startError: TimeError | null;
  endError: TimeError | null;
  valid: boolean;
}

/**
 * 驗證「開始」「結束」兩個輸入（002 FR-22）：格式錯誤、超出影片長度、開始不早於結束都不合法。
 * `duration` 為影片長度（秒）；小數會無條件捨去，與輸入框顯示的時間一致。
 */
export function validateRange(startText: string, endText: string, duration: number): RangeValidation {
  const limit = Math.max(0, Math.floor(duration));
  const start = parseTime(startText);
  const end = parseTime(endText);
  let startError: TimeError | null = start === null ? 'format' : start > limit ? 'outOfRange' : null;
  let endError: TimeError | null = end === null ? 'format' : end > limit ? 'outOfRange' : null;
  if (!startError && !endError && start! >= end!) {
    startError = 'order';
    endError = 'order';
  }
  return { start, end, startError, endError, valid: !startError && !endError };
}

/** 區間是否等於整部影片（002 FR-21：這時不做裁切）。 */
export function isFullRange(start: number, end: number, duration: number): boolean {
  return start <= 0 && end >= Math.floor(duration);
}
