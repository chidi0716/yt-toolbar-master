// 字幕格式轉換（002 FR-41、FR-44，plan 3.8）。純函式，背景腳本使用（Chrome 的 service worker 沒有
// DOMParser，所以 XML 以簡單的規則解析）。
// - 輸入：YouTube 字幕網址回傳的 WebVTT（fmt=vtt），或 YouTube 的 XML 格式（<transcript><text start dur>、
//   format 3 的 <timedtext><body><p t d>）。
// - 輸出：SRT、VTT、TXT（只有文字，去掉時間碼與重複行）。

export interface Cue {
  /** 毫秒 */
  start: number;
  end: number;
  /** WebVTT 的 cue 文字：會含有 <c>、<00:00:01.000> 等標籤，特殊字元以實體表示；多行以 \n 分隔。 */
  text: string;
}

export type CaptionOutput = 'srt' | 'vtt' | 'txt';

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '‎', rlm: '‏' };

/** 解碼 HTML／XML 實體（&amp;、&#39;、&#x27; 等）。 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** 去掉 VTT／XML 的行內標籤（<c>、<i>、<00:00:01.120>、<s> 等），解碼實體，整理每一行的空白。 */
export function plainText(text: string): string {
  return decodeEntities(text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 毫秒 → `HH:MM:SS.mmm`（VTT）或 `HH:MM:SS,mmm`（SRT）。 */
export function formatTimestamp(ms: number, separator: '.' | ','): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(total % 1000, 3)}`;
}

/** `HH:MM:SS.mmm`、`MM:SS.mmm`（也接受逗號）→ 毫秒；格式不對時回傳 null。 */
export function parseTimestamp(text: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(text.trim());
  if (!m) return null;
  const [, h, min, s, frac] = m;
  return ((Number(h ?? 0) * 60 + Number(min)) * 60 + Number(s)) * 1000 + Number(frac!.padEnd(3, '0'));
}

const escapeVtt = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export function isVtt(text: string): boolean {
  return /^﻿?WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(text);
}

/** 解析 WebVTT：略過標頭、NOTE／STYLE／REGION 區塊與 cue 識別名稱。 */
export function parseVtt(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks.slice(1)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((l) => l.includes('-->'));
    if (timingIndex === -1 || timingIndex > 1) continue; // NOTE、STYLE、REGION 等
    const [from, rest] = lines[timingIndex]!.split('-->');
    const start = parseTimestamp(from!);
    const end = parseTimestamp(rest!.trim().split(/\s+/)[0]!);
    if (start === null || end === null) continue;
    const textLines = lines.slice(timingIndex + 1);
    while (textLines.length && textLines[textLines.length - 1] === '') textLines.pop();
    cues.push({ start, end, text: textLines.join('\n') });
  }
  return cues;
}

const attributes = (raw: string): Record<string, string> =>
  Object.fromEntries([...raw.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));

/**
 * 解析 YouTube 的 XML 字幕：
 * - `<transcript><text start="1.5" dur="2.3">…</text>`（秒）；
 * - format 3：`<timedtext format="3"><body><p t="1500" d="2300">…</p>`（毫秒，內含 <s> 逐字標籤）。
 * 先去掉 XML 標籤（<s>、<br/> 等），再解碼實體；文字中的實體有時被編碼兩次（例如 `&amp;#39;`），所以解碼兩次。
 * 沒有長度時以下一句的開始時間為結束。產生的 cue 文字跳脫成 WebVTT 的格式。
 */
export function parseTimedTextXml(xml: string): Cue[] {
  const raw: Array<{ start: number; dur: number | null; text: string }> = [];
  for (const m of xml.matchAll(/<text\b([^>]*?)(?:\/>|>([\s\S]*?)<\/text>)/g)) {
    const a = attributes(m[1]!);
    const start = Number(a.start);
    if (!Number.isFinite(start)) continue;
    raw.push({ start: start * 1000, dur: a.dur !== undefined && Number.isFinite(Number(a.dur)) ? Number(a.dur) * 1000 : null, text: m[2] ?? '' });
  }
  if (raw.length === 0) {
    for (const m of xml.matchAll(/<p\b([^>]*?)(?:\/>|>([\s\S]*?)<\/p>)/g)) {
      const a = attributes(m[1]!);
      const start = Number(a.t);
      if (!Number.isFinite(start)) continue;
      raw.push({ start, dur: a.d !== undefined && Number.isFinite(Number(a.d)) ? Number(a.d) : null, text: m[2] ?? '' });
    }
  }
  const cues: Cue[] = [];
  raw.forEach((c, i) => {
    const decoded = decodeEntities(decodeEntities(c.text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')));
    const text = decoded
      .split('\n')
      .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (!text) return;
    const next = raw[i + 1]?.start;
    const end = c.dur !== null ? c.start + c.dur : next !== undefined ? next : c.start + 2000;
    cues.push({ start: Math.round(c.start), end: Math.round(Math.max(end, c.start)), text: escapeVtt(text) });
  });
  return cues;
}

// ---------------------------------------------------------------------------
// 輸出
// ---------------------------------------------------------------------------

/** SRT：編號、`HH:MM:SS,mmm --> HH:MM:SS,mmm`、去掉標籤的文字；沒有文字的 cue 略過。 */
export function cuesToSrt(cues: readonly Cue[]): string {
  const out: string[] = [];
  let n = 0;
  for (const cue of cues) {
    const text = plainText(cue.text);
    if (!text) continue;
    n++;
    out.push(`${n}\n${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}\n${text}\n`);
  }
  return out.join('\n');
}


/** WebVTT（由 XML 轉換時使用；文字已是純文字，需要跳脫 & < >）。 */
export function cuesToVtt(cues: readonly Cue[]): string {
  const body = cues
    .map((cue) => ({ cue, text: plainText(cue.text) }))
    .filter(({ text }) => text)
    .map(({ cue, text }) => `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}\n${escapeVtt(text)}\n`);
  return `WEBVTT\n\n${body.join('\n')}`;
}

/**
 * 純文字（002 FR-41）：只有文字、沒有時間碼。YouTube 的自動字幕以「捲動」的方式重複上一句，
 * 所以與前一行相同的行只保留一次。
 */
export function cuesToTxt(cues: readonly Cue[]): string {
  const lines: string[] = [];
  for (const cue of cues) {
    for (const line of plainText(cue.text).split('\n')) {
      if (line && line !== lines[lines.length - 1]) lines.push(line);
    }
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * 把字幕網址回傳的內容轉成指定格式；看不懂或沒有任何字幕文字時回傳 null。
 * 輸入已是 VTT、輸出也是 VTT 時原樣保留（只統一換行）。
 */
export function convertCaption(source: string, format: CaptionOutput): string | null {
  const vtt = isVtt(source);
  const cues = vtt ? parseVtt(source) : /<(?:transcript|timedtext)\b/.test(source) ? parseTimedTextXml(source) : null;
  if (!cues || !cues.some((c) => plainText(c.text))) return null;
  switch (format) {
    case 'vtt':
      return vtt ? `${source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trimEnd()}\n` : cuesToVtt(cues);
    case 'srt':
      return cuesToSrt(cues);
    case 'txt':
      return cuesToTxt(cues);
  }
}
