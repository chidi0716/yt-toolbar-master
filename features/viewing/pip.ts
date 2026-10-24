// 子母畫面（003 FR-30 至 FR-33，plan 3.7）：使用瀏覽器原生的 Picture-in-Picture。不記住狀態。
import { t } from '@/utils/i18n';
import { findVideo } from '@/utils/youtube/dom';
import { createStore, type ToggleState, type ViewingFeature } from './store';

export interface PipFeature extends ViewingFeature {
  state: ReturnType<typeof createStore<ToggleState>>;
  toggle(): void;
}

const LOG_PREFIX = '[yt-toolbar-master]';

/** 瀏覽器是否支援原生子母畫面（例如 Firefox 沒有這個 API）。 */
export function isPipSupported(doc: Document = document): boolean {
  return (
    doc.pictureInPictureEnabled === true &&
    typeof HTMLVideoElement !== 'undefined' &&
    'requestPictureInPicture' in HTMLVideoElement.prototype
  );
}

export function createPip(): PipFeature {
  const supported = isPipSupported();
  const unsupportedState = (): ToggleState => ({ active: false, disabledReason: t('pipUnsupported') });
  const state = createStore<ToggleState>(supported ? { active: false } : unsupportedState());

  const sync = () => {
    if (!supported) return;
    const pipElement = document.pictureInPictureElement;
    state.set({ active: !!pipElement && pipElement === findVideo() });
  };

  return {
    state,
    start() {
      if (!supported) return;
      // 這兩個事件會從 <video> 往上冒泡；從子母畫面視窗本身關閉時也會觸發（FR-31）。
      document.addEventListener('enterpictureinpicture', sync, true);
      document.addEventListener('leavepictureinpicture', sync, true);
      sync();
    },
    stop() {
      document.removeEventListener('enterpictureinpicture', sync, true);
      document.removeEventListener('leavepictureinpicture', sync, true);
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
      state.set(supported ? { active: false } : unsupportedState());
    },
    navigate: sync,
    toggle() {
      if (!supported) return;
      const video = findVideo();
      if (!video) {
        console.info(`${LOG_PREFIX} picture-in-picture: video element not found`);
        return;
      }
      const request =
        document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture();
      request
        .catch((err: unknown) => console.info(`${LOG_PREFIX} picture-in-picture failed`, err))
        .finally(sync);
    },
  };
}
