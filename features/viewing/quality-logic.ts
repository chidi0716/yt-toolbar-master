// 鎖定畫質的純邏輯（004 第 1 節、plan 3.7.1）：選擇畫質、判斷是不是使用者手動改的。
import type { QualityLock } from '@/utils/settings';
import { QUALITY_HEIGHTS, type QualityCode } from '@/utils/youtube/dom';

/** 使用者在 YouTube 設定選單操作後這段時間內發生的畫質改變，視為使用者手動選擇（FR-4）。 */
export const MANUAL_CHANGE_WINDOW_MS = 10_000;

/** 鎖定值對應的畫面高度上限；`max` 為不限，`off` 為 null。 */
export function lockHeight(lock: QualityLock): number | null {
  if (lock === 'off') return null;
  if (lock === 'max') return Number.POSITIVE_INFINITY;
  return Number(lock);
}

/**
 * 依鎖定值選出要使用的畫質（FR-2）：可用畫質中不高於鎖定值的最高畫質；
 * 都比鎖定值高時（例如鎖定 480p、影片最低只有 720p）使用最低的畫質。
 * 鎖定關閉或沒有可用畫質時回傳 null。
 */
export function pickQuality(lock: QualityLock, available: readonly QualityCode[]): QualityCode | null {
  const limit = lockHeight(lock);
  if (limit === null || available.length === 0) return null;
  const sorted = [...new Set(available)].sort((a, b) => QUALITY_HEIGHTS[b] - QUALITY_HEIGHTS[a]);
  return sorted.find((q) => QUALITY_HEIGHTS[q] <= limit) ?? sorted[sorted.length - 1]!;
}

/**
 * 畫質改變（不是擴充功能設定的值）時，判斷是不是使用者從 YouTube 設定選單手動改的（FR-3、FR-4）。
 * `lastMenuInteraction` 是使用者最後一次在設定選單中點擊或按鍵的時間（毫秒），沒有時為 null。
 */
export function isManualChange(lastMenuInteraction: number | null, now: number, windowMs = MANUAL_CHANGE_WINDOW_MS): boolean {
  return lastMenuInteraction !== null && now - lastMenuInteraction >= 0 && now - lastMenuInteraction <= windowMs;
}
