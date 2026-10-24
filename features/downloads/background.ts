// 背景腳本端：不需要橋接程式的下載（002 FR-30 至 FR-32、FR-44、FR-45、FR-50 至 FR-53，plan 3.8）。
// 檔案一律以 downloads.download 存到瀏覽器的預設下載位置。
import { convertCaption } from '@/utils/captions';
import { captionFilename, screenshotFilename, thumbnailFilename } from '@/utils/filename';
import type { ContentMessage, MessageResponse, ThumbnailInfo } from '@/utils/messages';
import { THUMBNAIL_SIZES, thumbnailSizeUrl, validateCaptionUrl } from '@/utils/youtube/dom';
import { isRealThumbnail } from './logic';

const LOG_PREFIX = '[yt-toolbar-master]';
/** 物件網址在下載完成（或逾時）後釋放。 */
const OBJECT_URL_TTL_MS = 5 * 60_000;

/** 讀圖片的實際尺寸：Chrome 的 service worker 與 Firefox 的背景頁都有 createImageBitmap。 */
async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/** 依序檢查各尺寸，排除 404 與 120×90 的預設圖（plan 3.8）。同一部影片的結果暫存。 */
const thumbnailCache = new Map<string, ThumbnailInfo[]>();
export async function getThumbnails(videoId: string): Promise<ThumbnailInfo[]> {
  const cached = thumbnailCache.get(videoId);
  if (cached) return cached;
  const results = await Promise.all(
    THUMBNAIL_SIZES.map(async ({ key }) => {
      const url = thumbnailSizeUrl(videoId, key);
      try {
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) return null;
        const { width, height } = await imageSize(await res.blob());
        return isRealThumbnail(res.status, width, height) ? { key, width, height, url } : null;
      } catch (err) {
        console.info(`${LOG_PREFIX} thumbnail check failed`, key, err);
        return null;
      }
    }),
  );
  const list = results.filter((r): r is ThumbnailInfo => r !== null);
  if (thumbnailCache.size > 50) thumbnailCache.clear();
  thumbnailCache.set(videoId, list);
  return list;
}

/** 以物件網址（Firefox 背景頁）或 data URL（Chrome 的 service worker 沒有 URL.createObjectURL）下載。 */
async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    try {
      const id = await browser.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
      releaseWhenDone(id, url);
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    return;
  }
  await browser.downloads.download({ url: await blobToDataUrl(blob), filename, conflictAction: 'uniquify', saveAs: false });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

function releaseWhenDone(id: number, url: string) {
  const release = () => {
    clearTimeout(timer);
    browser.downloads.onChanged.removeListener(onChanged);
    URL.revokeObjectURL(url);
  };
  const onChanged = (delta: { id: number; state?: { current?: string } }) => {
    if (delta.id === id && (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')) release();
  };
  const timer = setTimeout(release, OBJECT_URL_TTL_MS);
  browser.downloads.onChanged.addListener(onChanged);
}

const DIRECT_TYPES = ['getThumbnails', 'downloadThumbnail', 'saveScreenshot', 'downloadCaption'] as const;
type DirectMessage = Extract<ContentMessage, { type: (typeof DIRECT_TYPES)[number] }>;

async function handle(message: DirectMessage): Promise<MessageResponse<Record<string, unknown>>> {
  switch (message.type) {
    case 'getThumbnails':
      return { ok: true, thumbnails: await getThumbnails(message.videoId) };

    case 'downloadThumbnail': {
      // 只下載確認存在的尺寸；網址由背景腳本依影片 ID 與尺寸代號組出。
      const found = (await getThumbnails(message.videoId)).find((t) => t.key === message.key);
      if (!found) return { ok: false, error: 'NOT_FOUND' };
      try {
        // 由背景腳本取得圖片後存檔（與字幕、截圖相同的方式），格式維持 YouTube 提供的 JPG 或 WebP（FR-31）。
        const res = await fetch(found.url, { credentials: 'omit' });
        if (!res.ok) return { ok: false, error: 'NOT_FOUND' };
        const blob = await res.blob();
        const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
        await downloadBlob(blob, thumbnailFilename(message.title, message.videoId, extension));
        return { ok: true };
      } catch (err) {
        console.info(`${LOG_PREFIX} thumbnail download failed`, err);
        return { ok: false, error: 'DOWNLOAD_FAILED' };
      }
    }

    case 'saveScreenshot': {
      const filename = screenshotFilename(message.title, message.videoId, message.seconds);
      try {
        if (typeof URL.createObjectURL === 'function') {
          await downloadBlob(await (await fetch(message.dataUrl)).blob(), filename);
        } else {
          await browser.downloads.download({ url: message.dataUrl, filename, conflictAction: 'uniquify', saveAs: false });
        }
        return { ok: true };
      } catch (err) {
        console.info(`${LOG_PREFIX} screenshot download failed`, err);
        return { ok: false, error: 'DOWNLOAD_FAILED' };
      }
    }

    case 'downloadCaption': {
      const valid = validateCaptionUrl(message.url);
      if (!valid) return { ok: false, error: 'INVALID' };
      const url = new URL(valid);
      url.searchParams.set('fmt', 'vtt');
      let source: string;
      try {
        const res = await fetch(url.href, { credentials: 'include' });
        if (!res.ok) return { ok: false, error: 'FETCH_FAILED' };
        source = await res.text();
      } catch (err) {
        console.info(`${LOG_PREFIX} caption fetch failed`, err);
        return { ok: false, error: 'FETCH_FAILED' };
      }
      const text = convertCaption(source, message.format);
      if (text === null) {
        console.info(`${LOG_PREFIX} caption response was empty or not a caption file (${source.length} chars)`);
        return { ok: false, error: 'EMPTY' };
      }
      try {
        // SRT、VTT 以 application/octet-stream 存檔，避免瀏覽器依 text/plain 把副檔名改成 .txt。
        const type = message.format === 'txt' ? 'text/plain;charset=utf-8' : 'application/octet-stream';
        await downloadBlob(
          new Blob([text], { type }),
          captionFilename(message.title, message.videoId, message.languageCode, message.format),
        );
        return { ok: true };
      } catch (err) {
        console.info(`${LOG_PREFIX} caption download failed`, err);
        return { ok: false, error: 'DOWNLOAD_FAILED' };
      }
    }
  }
}

/** 處理下載相關的訊息；結果以 sendResponse 回覆（Chrome 與 Firefox 都支援 return true 的寫法）。 */
export function handleDownloadMessage(message: ContentMessage, sendResponse: (response: unknown) => void): boolean {
  if (!(DIRECT_TYPES as readonly string[]).includes(message.type)) return false;
  handle(message as DirectMessage).then(sendResponse, (err: unknown) => {
    console.info(`${LOG_PREFIX} download message failed`, err);
    sendResponse({ ok: false, error: 'DOWNLOAD_FAILED' });
  });
  return true;
}
