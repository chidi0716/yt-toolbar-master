// 畫質清單（002 FR-10 至 FR-13、004 FR-22，plan 3.8，tasks T18）。純函式。
// 輸入是橋接程式 getInfo 回傳的格式清單（yt-dlp 的格式資料精簡後的欄位）。
// - 只列出「影像加聲音」的完整結果：只有影像的格式自動搭配最佳聲音，大小為兩者相加；已經包含聲音的格式直接列出。
// - MP4 組：H.264（avc1）影像＋M4A（mp4a）聲音。其他格式組（WEBM）：VP9／AV1 影像＋Opus 聲音（plan 3.8）。
// - 2K 以上沒有 H.264 時，以 AV1（沒有才用 VP9）＋M4A 合併成 MP4 列在主清單，並標記部分播放器不支援
//   （002 FR-13、QUESTIONS Q43，tasks T18a）。
// - 依解析度與幀率分組，每組取位元率最高的格式；由高到低排列。
import { formatNumber } from './i18n';
import type { HostFormat } from './native-protocol';

export type Container = 'mp4' | 'webm';

export interface QualityRow {
  /** 清單中的唯一鍵。 */
  key: string;
  container: Container;
  /** 橋接程式 download 的 formatId（例如 "137+140" 或 "18"）。 */
  formatId: string;
  /** 畫面的短邊（直式影片也以短邊表示，與 YouTube 的「1080p」相同）。 */
  height: number;
  fps: number;
  /** 例如 "2160p"、"1080p60"。 */
  resolution: string;
  /** 002 FR-11：8K、4K、2K、1080、HD；其他為 null。 */
  badge: '8K' | '4K' | '2K' | '1080' | 'HD' | null;
  /** 位元組；未知時為 null。 */
  size: number | null;
  /** 大小只有估計值（任一方只有估計值、或依時間範圍比例估算）。 */
  approx: boolean;
  /** 是否為 HDR 影像。 */
  hdr: boolean;
  /** MP4 但影像不是 H.264（AV1 或 VP9）：部分播放器不支援（002 FR-13）。 */
  limited: boolean;
  /** limited 時的影像編碼，顯示在說明中。 */
  limitedCodec?: 'AV1' | 'VP9';
}

const hasVideo = (f: HostFormat) => !!f.vcodec && f.vcodec !== 'none';
const hasAudio = (f: HostFormat) => !!f.acodec && f.acodec !== 'none';
const isDrc = (f: HostFormat) => /-drc$/i.test(f.id) || /\bdrc\b/i.test(f.note);
const isH264 = (codec: string) => /^(avc1|h264)/i.test(codec);
const isAv1 = (codec: string) => /^(av01|av1)/i.test(codec);
const isVp9OrAv1 = (codec: string) => /^(vp0?9)/i.test(codec) || isAv1(codec);

/** 2K 以上才以 AV1／VP9 合併成 MP4（002 FR-13）。 */
export const LIMITED_MP4_MIN_HEIGHT = 1440;
const isAac = (codec: string) => /^mp4a/i.test(codec);
const isOpus = (codec: string) => /^opus/i.test(codec);

/** 只列出可以下載的格式（排除分鏡圖等）。 */
const usable = (f: HostFormat) => f.protocol !== 'mhtml' && f.ext !== 'mhtml' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,9}$/.test(f.id);

function shortSide(f: HostFormat): number | null {
  if (f.width && f.height) return Math.min(f.width, f.height);
  return f.height ?? null;
}

/** 002 FR-11 的畫質標籤。 */
export function qualityBadge(height: number): QualityRow['badge'] {
  if (height >= 4320) return '8K';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080';
  if (height >= 720) return 'HD';
  return null;
}

/** 幀率超過 30 時加在解析度後面（例如 1080p60）。 */
export function resolutionLabel(height: number, fps: number): string {
  return fps > 30 ? `${height}p${Math.round(fps)}` : `${height}p`;
}

function sizeOf(f: HostFormat): { size: number | null; approx: boolean } {
  if (f.filesize !== null && f.filesize > 0) return { size: f.filesize, approx: false };
  if (f.filesizeApprox !== null && f.filesizeApprox > 0) return { size: f.filesizeApprox, approx: true };
  return { size: null, approx: false };
}

const rate = (f: HostFormat) => f.tbr ?? f.abr ?? 0;

/** 最佳聲音：符合編碼條件、非 DRC（動態範圍壓縮）優先、位元率最高。 */
function bestAudio(formats: readonly HostFormat[], match: (codec: string) => boolean): HostFormat | null {
  const audios = formats.filter((f) => usable(f) && !hasVideo(f) && hasAudio(f) && match(f.acodec));
  audios.sort((a, b) => Number(isDrc(a)) - Number(isDrc(b)) || rate(b) - rate(a));
  return audios[0] ?? null;
}

interface Candidate {
  container: Container;
  height: number;
  fps: number;
  formatId: string;
  size: number | null;
  approx: boolean;
  hdr: boolean;
  /** 同組時比較用：合併的影像＋聲音優先於已含聲音的單一格式，其次比位元率。 */
  merged: boolean;
  rate: number;
  limited: boolean;
  limitedCodec?: 'AV1' | 'VP9';
}

const groupKey = (container: Container, height: number, fps: number, hdr: boolean) => `${container}-${height}-${fps > 30 ? 60 : 30}-${hdr ? 'hdr' : 'sdr'}`;

/** 只有影像的格式＋聲音合併成一個候選。 */
function mergedCandidate(f: HostFormat, a: HostFormat, container: Container, height: number, limited: boolean): Candidate {
  const v = sizeOf(f);
  const s = sizeOf(a);
  const size = v.size !== null && s.size !== null ? v.size + s.size : null;
  return {
    container,
    height,
    fps: f.fps ?? 30,
    formatId: `${f.id}+${a.id}`,
    size,
    approx: size !== null && (v.approx || s.approx),
    hdr: /hdr/i.test(f.dynamicRange),
    merged: true,
    rate: rate(f),
    limited,
    ...(limited ? { limitedCodec: isAv1(f.vcodec) ? ('AV1' as const) : ('VP9' as const) } : {}),
  };
}

/** 由 getInfo 的格式清單產生畫質清單（全部容器），由高到低排列。 */
export function buildQualityList(formats: readonly HostFormat[]): QualityRow[] {
  const audio = { mp4: bestAudio(formats, isAac), webm: bestAudio(formats, isOpus) };
  const candidates: Candidate[] = [];
  /** 2K 以上的 AV1／VP9 影像（沒有 H.264 時合併成 MP4 用）。 */
  const highNonH264: { f: HostFormat; height: number }[] = [];

  for (const f of formats) {
    if (!usable(f) || !hasVideo(f)) continue;
    const height = shortSide(f);
    if (!height) continue;
    const fps = f.fps ?? 30;
    const hdr = /hdr/i.test(f.dynamicRange);
    if (hasAudio(f)) {
      // 已經包含聲音的格式（例如 360p 的 MP4）直接列出。
      const container: Container | null = f.ext === 'mp4' && isH264(f.vcodec) ? 'mp4' : f.ext === 'webm' ? 'webm' : null;
      if (!container) continue;
      const { size, approx } = sizeOf(f);
      candidates.push({ container, height, fps, formatId: f.id, size, approx, hdr, merged: false, rate: rate(f), limited: false });
      continue;
    }
    // 只有影像：依編碼決定組別，搭配同組的最佳聲音。
    const container: Container | null = isH264(f.vcodec) ? 'mp4' : isVp9OrAv1(f.vcodec) ? 'webm' : null;
    if (!container) continue;
    if (container === 'webm' && height >= LIMITED_MP4_MIN_HEIGHT) highNonH264.push({ f, height });
    const a = audio[container];
    if (!a) continue;
    candidates.push(mergedCandidate(f, a, container, height, false));
  }

  // 依容器、解析度、幀率（30／60）、HDR 分組，每組留一個。
  const groups = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = groupKey(c.container, c.height, c.fps, c.hdr);
    const prev = groups.get(key);
    if (!prev || Number(c.merged) - Number(prev.merged) > 0 || (c.merged === prev.merged && c.rate > prev.rate)) groups.set(key, c);
  }

  // 2K 以上沒有 H.264 的組：AV1 優先（沒有才用 VP9），同編碼取位元率最高，搭配 M4A 合併成 MP4（002 FR-13）。
  if (audio.mp4) {
    const best = new Map<string, { f: HostFormat; height: number }>();
    for (const h of highNonH264) {
      const key = groupKey('mp4', h.height, h.f.fps ?? 30, /hdr/i.test(h.f.dynamicRange));
      if (groups.has(key)) continue;
      const prev = best.get(key);
      const better = !prev || Number(isAv1(h.f.vcodec)) - Number(isAv1(prev.f.vcodec)) > 0 || (isAv1(h.f.vcodec) === isAv1(prev.f.vcodec) && rate(h.f) > rate(prev.f));
      if (better) best.set(key, h);
    }
    for (const [key, h] of best) groups.set(key, mergedCandidate(h.f, audio.mp4, 'mp4', h.height, true));
  }

  return [...groups.entries()]
    .map(([key, c]) => ({
      key,
      container: c.container,
      formatId: c.formatId,
      height: c.height,
      fps: c.fps,
      resolution: resolutionLabel(c.height, c.fps),
      badge: qualityBadge(c.height),
      size: c.size,
      approx: c.approx,
      hdr: c.hdr,
      limited: c.limited,
      ...(c.limitedCodec ? { limitedCodec: c.limitedCodec } : {}),
    }))
    .sort((a, b) => b.height - a.height || b.fps - a.fps || Number(a.hdr) - Number(b.hdr) || (a.container === b.container ? 0 : a.container === 'mp4' ? -1 : 1));
}

/** 002 FR-13：預設只列出 MP4；展開後列出全部。 */
export function visibleRows(rows: readonly QualityRow[], showAll: boolean): QualityRow[] {
  return showAll ? [...rows] : rows.filter((r) => r.container === 'mp4');
}

/** 004 FR-22：時間範圍不是整部影片時，大小依比例估算並標示「約」。 */
export function sizeForSection(row: QualityRow, section: { start: number; end: number } | null, duration: number): { size: number | null; approx: boolean } {
  if (!section || !(duration > 0) || row.size === null) return { size: row.size, approx: row.approx };
  const ratio = Math.min(1, Math.max(0, (section.end - section.start) / duration));
  return { size: Math.round(row.size * ratio), approx: true };
}

/** 檔案大小的文字（002 FR-11）：例如「147.1 MB」；只有估計值時加上 approxPrefix；未知為「—」。 */
export function formatSize(size: number | null, approx: boolean, approxPrefix: string): string {
  if (size === null || !Number.isFinite(size) || size < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const text = `${formatNumber(unit === 0 ? Math.round(value) : value, unit === 0 ? 0 : 1)} ${units[unit]}`;
  return approx ? `${approxPrefix}${text}` : text;
}
