// 一鍵下載與右鍵下載的畫質選擇（009 FR-2，plan 3.11）。純函式，重用 format-list.ts 的分組結果。
// - 影片有設定的畫質就用它；沒有時選比它低的最高畫質；全部都比它高時選最低的（與 004 鎖定畫質相同的規則）。
// - MP4：只從 MP4 組選（2K 以上是 AV1／VP9 合併的 MP4，002 FR-13）；完全沒有 MP4 結果時改從全部結果選。
// - 不限格式：從全部結果選，WEBM 畫質較高時選 WEBM。
// - 同一個畫質有多個幀率時選最高幀率；同畫質同幀率時 SDR 優先於 HDR，再依 H.264 的 MP4、WEBM、AV1／VP9 的 MP4 的順序。
import { buildQualityList, type QualityRow } from './format-list';
import type { HostFormat } from './native-protocol';
import type { DefaultVideoContainer, DefaultVideoHeight } from './settings';

export interface DefaultFormatOptions {
  height: DefaultVideoHeight;
  container: DefaultVideoContainer;
}

/** 依 FR-2 的規則，從可用的畫質（畫面高度）中選出要用的一個；沒有可用畫質時回傳 null。 */
export function pickHeight(available: readonly number[], target: DefaultVideoHeight): number | null {
  const heights = [...new Set(available)].sort((a, b) => b - a);
  if (heights.length === 0) return null;
  if (target === 'best') return heights[0]!;
  return heights.find((h) => h <= target) ?? heights[heights.length - 1]!;
}

/** 同畫質時的優先順序（數字小的優先）。 */
function preference(row: QualityRow): number {
  if (row.container === 'mp4' && !row.limited) return 0;
  if (row.container === 'webm') return 1;
  return 2;
}

/** 一鍵下載使用的格式（009 FR-2）；沒有任何可下載的結果時回傳 null。 */
export function pickDefaultFormat(formats: readonly HostFormat[], options: DefaultFormatOptions): QualityRow | null {
  return pickDefaultRow(buildQualityList(formats), options);
}

/** 同 pickDefaultFormat，但輸入是已經產生好的畫質清單（面板已有清單時不重算）。 */
export function pickDefaultRow(rows: readonly QualityRow[], { height, container }: DefaultFormatOptions): QualityRow | null {
  const mp4 = rows.filter((r) => r.container === 'mp4');
  const candidates = container === 'mp4' && mp4.length > 0 ? mp4 : [...rows];
  const target = pickHeight(
    candidates.map((r) => r.height),
    height,
  );
  if (target === null) return null;
  const same = candidates.filter((r) => r.height === target);
  same.sort((a, b) => b.fps - a.fps || Number(a.hdr) - Number(b.hdr) || preference(a) - preference(b));
  return same[0] ?? null;
}
