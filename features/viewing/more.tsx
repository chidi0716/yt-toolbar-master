// 「更多」選單中的功能（003 FR-60 至 FR-64，plan 3.7）。
import { render } from 'preact';
import { Icon } from '@/components/icons';
import { t } from '@/utils/i18n';
import { audioOnly, hideComments, smartPause, wheelVolume } from '@/utils/settings';
import { SELECTORS, findAutoplayToggle, findPlayer, findVideo, isAutoplayOn, thumbnailUrl } from '@/utils/youtube/dom';
import { getVideoId, isWatchPage } from '@/utils/youtube/page';
import { player } from '@/utils/youtube/player';
import { nextVolume, smartPauseStep, wheelSteps, type DeltaMode, type SmartPauseState } from './more-logic';
import { ensurePageStyles } from './page-styles';
import { createSettingFeature } from './setting-feature';
import { createStore, type Store, type ToggleState, type ViewingFeature } from './store';

const LOG_PREFIX = '[yt-toolbar-master]';

// ---------------------------------------------------------------------------
// 切換分頁時自動暫停（FR-60）
// ---------------------------------------------------------------------------

export function createSmartPause() {
  let pause: SmartPauseState = { pausedByUs: false };
  let ourPause = false;
  let video: HTMLVideoElement | null = null;

  const onVisibility = () => {
    video = findVideo();
    if (!video || !isWatchPage(location.href)) return;
    const event =
      document.visibilityState === 'hidden'
        ? ({ type: 'hidden', playing: !video.paused && !video.ended } as const)
        : ({ type: 'visible' } as const);
    const { state, action } = smartPauseStep(pause, event);
    pause = state;
    if (action === 'pause') {
      ourPause = true;
      video.pause();
      ourPause = false;
    } else if (action === 'play') {
      void video.play().catch((err: unknown) => console.info(`${LOG_PREFIX} smart pause: resume failed`, err));
    }
  };

  // 分頁隱藏期間使用者自己開始播放（例如媒體鍵），回來時就不再自動恢復。
  const onPlay = () => {
    if (document.visibilityState === 'hidden' && !ourPause) pause = smartPauseStep(pause, { type: 'userPlayback' }).state;
  };

  const feature = createSettingFeature(smartPause, {
    apply(on) {
      pause = smartPauseStep(pause, { type: 'reset' }).state;
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('play', onPlay, true);
      if (on) {
        document.addEventListener('visibilitychange', onVisibility);
        document.addEventListener('play', onPlay, true);
      }
    },
    navigate() {
      pause = smartPauseStep(pause, { type: 'reset' }).state;
    },
  });
  return feature;
}

// ---------------------------------------------------------------------------
// 自動播放下一部（FR-61）：直接操作 YouTube 自己的開關，狀態由 YouTube 記住。
// ---------------------------------------------------------------------------

export interface AutoplayFeature extends ViewingFeature {
  state: Store<ToggleState>;
  toggle(): void;
  /** 重新尋找 YouTube 的開關（播放器可能比內容腳本晚出現）。 */
  refresh(): void;
}

export function createAutoplay(): AutoplayFeature {
  const missing = (): ToggleState => ({ active: false, disabledReason: t('moreAutoplayMissing') });
  const state = createStore<ToggleState>(missing());
  let running = false;
  let observer: MutationObserver | null = null;
  let observed: Element | null = null;

  const sync = () => {
    const toggle = findAutoplayToggle();
    if (!toggle) {
      state.set(missing());
      return;
    }
    state.set({ active: isAutoplayOn(toggle) });
  };

  const refresh = () => {
    if (!running) return;
    const toggle = findAutoplayToggle();
    if (toggle?.indicator !== observed) {
      observer?.disconnect();
      observed = toggle?.indicator ?? null;
      if (observed) {
        observer ??= new MutationObserver(sync);
        observer.observe(observed, { attributes: true, attributeFilter: ['aria-checked'] });
      }
    }
    sync();
  };

  return {
    state,
    refresh,
    start() {
      running = true;
      refresh();
    },
    stop() {
      running = false;
      observer?.disconnect();
      observer = null;
      observed = null;
    },
    navigate: refresh,
    toggle() {
      const toggle = findAutoplayToggle();
      if (!toggle) {
        state.set(missing());
        return;
      }
      toggle.button.click();
      // YouTube 更新 aria-checked 後由 MutationObserver 同步；這裡先確認一次。
      refresh();
    },
  };
}

// ---------------------------------------------------------------------------
// 純音訊模式（FR-62）
// ---------------------------------------------------------------------------

const AUDIO_ONLY_CLASS = 'yte-audio-only';
const AUDIO_COVER_STYLE_ID = 'yte-audio-only-cover';

export function createAudioOnly() {
  const writeCover = () => {
    const id = getVideoId(location.href);
    let style = document.getElementById(AUDIO_COVER_STYLE_ID);
    if (!id) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = AUDIO_COVER_STYLE_ID;
      (document.head ?? document.documentElement).append(style);
    }
    // 影片 ID 已驗證為 [A-Za-z0-9_-]{11}，可以安全放進 CSS 字串。
    style.textContent = `html.${AUDIO_ONLY_CLASS} ${SELECTORS.videoContainer} { background-image: url("${thumbnailUrl(id)}") !important; }`;
  };

  return createSettingFeature(audioOnly, {
    apply(on) {
      if (on) {
        ensurePageStyles();
        writeCover();
      } else {
        document.getElementById(AUDIO_COVER_STYLE_ID)?.remove();
      }
      document.documentElement.classList.toggle(AUDIO_ONLY_CLASS, on);
    },
    navigate(on) {
      if (on) writeCover();
    },
  });
}

// ---------------------------------------------------------------------------
// 滑鼠滾輪調整音量（FR-63）
// ---------------------------------------------------------------------------

const HINT_TAG = 'yte-volume-hint';
const HINT_MS = 1000;
const HINT_CSS = `
:host { all: initial; position: fixed; z-index: 2300; pointer-events: none; transform: translate(-50%, -50%); }
.hint {
  display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 24px;
  background: rgba(0, 0, 0, 0.7); color: #fff; font: 500 18px/24px Roboto, Arial, sans-serif;
}
svg { display: block; }
`;

export function createWheelVolume() {
  let target: HTMLElement | null = null;
  let acc = { pixels: 0 };
  let queue: Promise<void> = Promise.resolve();
  let hint: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const showHint = (volume: number) => {
    const rect = findPlayer()?.getBoundingClientRect();
    if (!rect) return;
    if (!hint) {
      hint = document.createElement(HINT_TAG);
      const shadow = hint.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = HINT_CSS;
      shadow.append(style, document.createElement('div'));
      document.body.append(hint);
    }
    hint.style.left = `${rect.left + rect.width / 2}px`;
    hint.style.top = `${rect.top + rect.height / 2}px`;
    const root = hint.shadowRoot!.lastElementChild!;
    render(
      <div class="hint" role="status" aria-label={t('volumeHint')}>
        <Icon name={volume === 0 ? 'volume_off' : 'volume_up'} />
        <span>{volume}%</span>
      </div>,
      root,
    );
    // 一次性的計時器：顯示一秒後移除，閒置時不會有計時器在跑。
    clearTimeout(hideTimer);
    hideTimer = setTimeout(removeHint, HINT_MS);
  };

  const removeHint = () => {
    clearTimeout(hideTimer);
    if (hint) {
      render(null, hint.shadowRoot!.lastElementChild!);
      hint.remove();
      hint = null;
    }
  };

  const onWheel = (event: WheelEvent) => {
    const result = wheelSteps(acc, event.deltaY, event.deltaMode as DeltaMode);
    acc = result.acc;
    // 游標在播放器上：不捲動頁面（FR-63）。
    event.preventDefault();
    if (result.steps === 0) return;
    // 依序處理，避免連續滾動時讀到舊的音量。
    queue = queue.then(async () => {
      try {
        const { volume } = await player.getVolume();
        const next = nextVolume(volume, result.steps);
        await player.setVolume(next);
        showHint(next);
      } catch (err) {
        console.info(`${LOG_PREFIX} wheel volume failed`, err);
      }
    });
  };

  const attach = () => {
    const next = isWatchPage(location.href) ? findPlayer() : null;
    if (next === target) return;
    target?.removeEventListener('wheel', onWheel);
    target = next;
    target?.addEventListener('wheel', onWheel, { passive: false });
  };

  const detach = () => {
    target?.removeEventListener('wheel', onWheel);
    target = null;
    removeHint();
  };

  return createSettingFeature(wheelVolume, {
    apply(on) {
      if (on) attach();
      else detach();
    },
    navigate(on) {
      if (on) attach();
    },
  });
}

// ---------------------------------------------------------------------------
// 隱藏留言（FR-64）：以 CSS 開關機制實作（plan 3.7.2，features/tidy）。document_start 的內容腳本依
// 這個設定與工具列是否啟用（003 FR-5）在 <html> 加上 class；這裡只負責面板中的開關與寫入設定。
// ---------------------------------------------------------------------------

export function createHideComments() {
  return createSettingFeature(hideComments, {
    apply() {},
  });
}
