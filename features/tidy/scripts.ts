// 頁面整理中需要程式的選項（005、plan 3.7.2）。每個選項只在設定開啟時啟動，只在必要時機執行，
// 不輪詢（005 NFR-2）；關閉時移除所有監聽。
import { CONVENIENCE_SELECTORS, NAVIGATE_FINISH_EVENT, SELECTORS, findVideo } from '@/utils/youtube/dom';
import { getVideoId, isWatchPage, watchUrlForShorts } from '@/utils/youtube/page';
import { player } from '@/utils/youtube/player';
import type { TidyScriptFeature } from './index';
import { pickOriginalTrack, shouldAutoContinue } from './script-logic';

const LOG_PREFIX = '[yt-toolbar-master]';
const isMainVideo = (target: EventTarget | null) => !!(target as Element | null)?.matches?.(SELECTORS.video);

// ---------------------------------------------------------------------------
// 永遠使用原始語音（005 FR-10 至 FR-13）
// 每部影片只判斷一次：語音軌清單載入後，若預設是自動配音就切到原始語音，之後這部影片不再介入，
// 所以使用者之後從 YouTube 齒輪手動選的語音軌會被尊重（FR-12）；換到下一部影片時重新判斷。
// 檢查時機：影片載入（loadedmetadata）、開始播放（playing）、換頁。
// ---------------------------------------------------------------------------

export function createOriginalAudio(): TidyScriptFeature {
  let running = false;
  /** 已經判斷過的影片 ID。 */
  let decided: string | null = null;
  let busy = false;

  const check = async () => {
    if (!running || busy || !isWatchPage(location.href)) return;
    const id = getVideoId(location.href);
    if (!id || id === decided) return;
    busy = true;
    try {
      const { tracks, current } = await player.getAudioTracks();
      if (!running || getVideoId(location.href) !== id) return;
      if (tracks.length === 0) return; // 清單還沒載入（或只有一個語音軌），等下一個事件
      decided = id;
      const target = pickOriginalTrack(tracks, current);
      if (!target) return;
      const switched = await player.setAudioTrack(target);
      console.info(`${LOG_PREFIX} original audio: ${switched ? `switched ${current} -> ${target}` : 'switch failed'}`);
    } catch (err) {
      console.info(`${LOG_PREFIX} original audio failed`, err);
    } finally {
      busy = false;
    }
  };

  const onMedia = (event: Event) => {
    if (isMainVideo(event.target)) void check();
  };
  const onNavigate = () => void check();

  return {
    start() {
      running = true;
      document.addEventListener('loadedmetadata', onMedia, true);
      document.addEventListener('playing', onMedia, true);
      document.addEventListener(NAVIGATE_FINISH_EVENT, onNavigate);
      void check();
    },
    stop() {
      running = false;
      decided = null;
      document.removeEventListener('loadedmetadata', onMedia, true);
      document.removeEventListener('playing', onMedia, true);
      document.removeEventListener(NAVIGATE_FINISH_EVENT, onNavigate);
    },
  };
}

// ---------------------------------------------------------------------------
// 自動關閉「影片已暫停，要繼續觀看嗎？」（005 FR-30、FR-31）
// 只觀察 YouTube 的彈出視窗容器（plan 3.7.2）。對話框出現時，若影片剛被暫停、且使用者一段時間沒有操作，
// 就按下對話框的確認按鈕並繼續播放；使用者自己按暫停或開啟的對話框不受影響。
// ---------------------------------------------------------------------------

export function createAutoContinue(): TidyScriptFeature {
  let running = false;
  let observer: MutationObserver | null = null;
  let observed: Element | null = null;
  let lastInput = Number.NEGATIVE_INFINITY;
  let lastPause = Number.NEGATIVE_INFINITY;
  let frame = 0;

  const onInput = () => {
    lastInput = performance.now();
  };
  const onPause = (event: Event) => {
    if (isMainVideo(event.target)) lastPause = performance.now();
  };

  const visibleDialog = (): Element | null => {
    const container = observed;
    if (!container) return null;
    for (const dialog of container.querySelectorAll(CONVENIENCE_SELECTORS.confirmDialog)) {
      if (dialog.getClientRects().length > 0) return dialog;
    }
    return null;
  };

  const check = () => {
    frame = 0;
    const dialog = visibleDialog();
    const video = findVideo();
    if (!dialog || !video) return;
    const now = performance.now();
    const ok = shouldAutoContinue({
      dialogVisible: true,
      videoPaused: video.paused,
      msSinceUserInput: now - lastInput,
      msSincePause: now - lastPause,
    });
    if (!ok) return;
    const confirm =
      dialog.querySelector<HTMLElement>(CONVENIENCE_SELECTORS.confirmButton) ??
      dialog.querySelector<HTMLElement>(CONVENIENCE_SELECTORS.confirmButtonHost);
    console.info(`${LOG_PREFIX} auto continue: dismissing "continue watching" dialog`);
    confirm?.click();
    // 對話框的按鈕沒有讓影片繼續時，直接播放。
    if (video.paused) void video.play().catch((err: unknown) => console.info(`${LOG_PREFIX} auto continue: play failed`, err));
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(check);
  };

  /** 找到彈出視窗容器就開始觀察；YouTube 首次載入時容器較晚出現，所以換頁時再找一次。 */
  const attach = () => {
    if (!running) return;
    const container = document.querySelector(CONVENIENCE_SELECTORS.popupContainer);
    if (!container || container === observed) return;
    observer?.disconnect();
    observed = container;
    observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'aria-hidden', 'opened'] });
    schedule();
  };

  return {
    start() {
      running = true;
      window.addEventListener('pointerdown', onInput, true);
      window.addEventListener('keydown', onInput, true);
      document.addEventListener('pause', onPause, true);
      document.addEventListener(NAVIGATE_FINISH_EVENT, attach);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, { once: true });
      attach();
    },
    stop() {
      running = false;
      observer?.disconnect();
      observer = null;
      observed = null;
      cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('pointerdown', onInput, true);
      window.removeEventListener('keydown', onInput, true);
      document.removeEventListener('pause', onPause, true);
      document.removeEventListener(NAVIGATE_FINISH_EVENT, attach);
      document.removeEventListener('DOMContentLoaded', attach);
    },
  };
}

// ---------------------------------------------------------------------------
// Shorts 改用一般播放器（005 FR-50 至 FR-52）
// 首次載入、YouTube 站內換頁、上一頁／下一頁時檢查網址；以 location.replace 取代瀏覽紀錄中的
// Shorts 頁面，按上一頁不會回到 Shorts 而再被轉換（FR-51）。觀看頁永遠不會被轉換，不會形成循環。
// ---------------------------------------------------------------------------

export function createShortsRedirect(): TidyScriptFeature {
  let running = false;
  const check = () => {
    if (!running) return;
    const target = watchUrlForShorts(location.href);
    if (target) location.replace(target);
  };
  return {
    start() {
      running = true;
      document.addEventListener(NAVIGATE_FINISH_EVENT, check);
      window.addEventListener('popstate', check);
      check();
    },
    stop() {
      running = false;
      document.removeEventListener(NAVIGATE_FINISH_EVENT, check);
      window.removeEventListener('popstate', check);
    },
  };
}
