// 複製帶時間的連結（004 第 4 節、plan 3.7.1）的純邏輯：產生連結與 Markdown 文字、預覽的省略。
import { formatTime } from '@/utils/time';

/** 一律使用 youtu.be 短網址（FR-35）。 */
export const SHORT_LINK_BASE = 'https://youtu.be/';

export type LinkKind = 'time' | 'markdown' | 'plain';

/** 面板中三個選項的順序（FR-31）。 */
export const LINK_KINDS: readonly LinkKind[] = ['time', 'markdown', 'plain'];

/** 播放器目前時間（秒）無條件捨去成整數；不合法的值視為 0。 */
export function wholeSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

/**
 * youtu.be 短網址；秒數大於 0 時加上 `?t=<秒數>`（FR-31、FR-33）。
 * 只帶影片 ID 與時間，播放清單等其他參數一律不帶（FR-35）。
 */
export function shortLink(videoId: string, seconds = 0): string {
  const t = wholeSeconds(seconds);
  const base = `${SHORT_LINK_BASE}${encodeURIComponent(videoId)}`;
  return t > 0 ? `${base}?t=${t}` : base;
}

/** Markdown 連結文字中有特殊意義的字元加上反斜線；換行改成空白。 */
export function escapeMarkdownText(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').replace(/[\\[\]]/g, (c) => `\\${c}`);
}

/**
 * Markdown 格式：`[影片標題（01:23）](https://youtu.be/<ID>?t=83)`（FR-31）。
 * 時間滿一小時時為 時:分:秒；連結的時間規則與 shortLink 相同。
 */
export function markdownLink(title: string, videoId: string, seconds: number): string {
  const t = wholeSeconds(seconds);
  return `[${escapeMarkdownText(title.trim())}（${formatTime(t)}）](${shortLink(videoId, t)})`;
}

/** 三個選項實際會複製的文字。 */
export function linkText(kind: LinkKind, videoId: string, title: string, seconds: number): string {
  switch (kind) {
    case 'time':
      return shortLink(videoId, seconds);
    case 'markdown':
      return markdownLink(title, videoId, seconds);
    case 'plain':
      return shortLink(videoId);
  }
}

/** 過長的預覽在中間以「…」省略（FR-32），保留開頭與結尾（帶時間的連結以時間結尾）。 */
export function middleEllipsis(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max || max < 3) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}
