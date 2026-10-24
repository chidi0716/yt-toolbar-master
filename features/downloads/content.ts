// 內容腳本端：與背景腳本溝通的封裝，以及截圖（002 FR-50 至 FR-53，plan 3.8）。
import { createStore, type Store, type ToggleState } from '@/features/viewing/store';
import { t } from '@/utils/i18n';
import type { ContentMessage, DownloadError, MessageResponse } from '@/utils/messages';
import { findVideo } from '@/utils/youtube/dom';
import { getVideoId } from '@/utils/youtube/page';
import { player } from '@/utils/youtube/player';

const LOG_PREFIX = '[yt-toolbar-master]';

/** 送訊息給背景腳本；背景腳本沒有回覆或出錯時視為失敗。 */
export async function sendToBackground<T extends Record<string, unknown> = Record<string, never>>(
  message: ContentMessage,
): Promise<MessageResponse<T>> {
  try {
    const res = (await browser.runtime.sendMessage(message)) as MessageResponse<T> | undefined;
    return res && typeof res === 'object' && 'ok' in res ? res : { ok: false, error: 'DOWNLOAD_FAILED' };
  } catch (err) {
    console.info(`${LOG_PREFIX} background message failed`, err);
    return { ok: false, error: 'DOWNLOAD_FAILED' };
  }
}

/** 目前影片的標題（檔名用）；讀不到時為空字串，檔名只用影片 ID。 */
export async function currentTitle(videoId: string): Promise<string> {
  try {
    const data = await player.getVideoData();
    return data?.videoId === videoId ? data.title : '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 截圖
// ---------------------------------------------------------------------------

/** 完成或錯誤提示顯示的時間（一次性的計時器）。 */
const SCREENSHOT_NOTICE_MS = 2500;

export type CaptureResult = { ok: true; dataUrl: string; width: number; height: number } | { ok: false; reason: 'NO_VIDEO' | 'BLOCKED' };

/**
 * 把 <video> 目前的畫面以原始解析度畫到 canvas，轉成 PNG（FR-50）。只畫影片本身，不含播放器的控制列、
 * 字幕或疊加資訊。canvas 被視為跨來源而無法輸出時回傳 BLOCKED（FR-52）。
 */
export function captureFrame(video: HTMLVideoElement): CaptureResult {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height || video.readyState < 2) return { ok: false, reason: 'NO_VIDEO' };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'BLOCKED' };
    ctx.drawImage(video, 0, 0, width, height);
    return { ok: true, dataUrl: canvas.toDataURL('image/png'), width, height };
  } catch (err) {
    console.info(`${LOG_PREFIX} screenshot: canvas could not be exported`, err);
    return { ok: false, reason: 'BLOCKED' };
  }
}

export interface ScreenshotFeature {
  /** 按鈕的提示文字（完成或錯誤，FR-52）。 */
  state: Store<ToggleState>;
  capture(): void;
}

export function createScreenshot(): ScreenshotFeature {
  const state = createStore<ToggleState>({ active: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;

  const notify = (notice: string) => {
    clearTimeout(timer);
    state.set({ active: false, notice });
    timer = setTimeout(() => state.set({ active: false }), SCREENSHOT_NOTICE_MS);
  };

  return {
    state,
    capture() {
      if (busy) return;
      const videoId = getVideoId(location.href);
      const video = findVideo();
      if (!videoId || !video) {
        notify(t('screenshotNoVideo'));
        return;
      }
      // 先同步擷取，記下當時的時間點（之後才非同步讀標題、存檔）。
      const seconds = video.currentTime;
      const frame = captureFrame(video);
      if (!frame.ok) {
        notify(t(frame.reason === 'NO_VIDEO' ? 'screenshotNoVideo' : 'screenshotFailed'));
        return;
      }
      busy = true;
      void (async () => {
        const title = await currentTitle(videoId);
        const res = await sendToBackground({ type: 'saveScreenshot', videoId, title, seconds, dataUrl: frame.dataUrl });
        notify(t(res.ok ? 'screenshotSaved' : 'screenshotFailed'));
      })().finally(() => {
        busy = false;
      });
    },
  };
}

export function downloadErrorText(error: DownloadError | string): string {
  return t(error === 'NOT_FOUND' ? 'thumbnailMissing' : 'downloadFailed');
}
