// 鎖定畫質（004 第 1 節、plan 3.7.1）：每部影片開始播放時切換到鎖定的畫質；YouTube 自動改變畫質時切回；
// 使用者從 YouTube 設定選單手動改畫質時，這部影片不再強制。
//
// 只在必要的時機檢查（不輪詢）：影片載入（loadedmetadata）、開始播放（playing）、畫面尺寸改變（resize，
// 畫質改變時 <video> 會發出）、換頁與改變設定時。
import { qualityLock, QUALITY_LOCK_VALUES, type QualityLock } from '@/utils/settings';
import { AUTO_QUALITY, CONVENIENCE_SELECTORS, SELECTORS, type QualityCode } from '@/utils/youtube/dom';
import { getVideoId, isWatchPage } from '@/utils/youtube/page';
import { player } from '@/utils/youtube/player';
import { isManualChange, pickQuality } from './quality-logic';
import { createStore, type Store, type ViewingFeature } from './store';

const LOG_PREFIX = '[yt-toolbar-master]';
const VIDEO_EVENTS = ['loadedmetadata', 'playing', 'resize'] as const;
const MENU_EVENTS = ['pointerdown', 'keydown'] as const;

export interface QualityLockFeature extends ViewingFeature {
  state: Store<{ value: QualityLock }>;
  setLock(value: QualityLock): void;
}

const isLock = (value: unknown): value is QualityLock => (QUALITY_LOCK_VALUES as readonly unknown[]).includes(value);

export function createQualityLock(): QualityLockFeature {
  const state = createStore<{ value: QualityLock }>({ value: 'off' });
  let running = false;
  let unwatch: (() => void) | null = null;
  /** 目前檢查中的影片。 */
  let videoId: string | null = null;
  /** 使用者已在這部影片手動改過畫質（FR-4）。 */
  let userChose = false;
  /** 這部影片目前由擴充功能維持的畫質；null 表示還沒設定過。 */
  let enforced: QualityCode | null = null;
  /** 這個頁面中是否曾經設定過畫質（關閉或停用時才需要交還給 YouTube）。 */
  let touched = false;
  let lastMenuInteraction: number | null = null;
  let checking = false;
  let again = false;

  const check = async (): Promise<void> => {
    if (!running) return;
    if (checking) {
      again = true;
      return;
    }
    checking = true;
    try {
      do {
        again = false;
        await checkOnce();
      } while (again && running);
    } finally {
      checking = false;
    }
  };

  const checkOnce = async () => {
    const lock = state.get().value;
    if (lock === 'off' || !isWatchPage(location.href)) return;
    const id = getVideoId(location.href);
    if (id !== videoId) {
      // 換到下一部影片：恢復鎖定（FR-4）。
      videoId = id;
      userChose = false;
      enforced = null;
    }
    if (userChose) return;
    try {
      const [available, current] = await Promise.all([player.getAvailableQualities(), player.getQuality()]);
      if (!running || getVideoId(location.href) !== id || state.get().value !== lock) return;
      const target = pickQuality(lock, available);
      if (!target) return; // 畫質清單還沒載入，等下一個事件
      if (current === target) {
        enforced = target;
        return;
      }
      // 畫質變成別的值、而且不是擴充功能設定的：使用者剛操作過 YouTube 設定選單就尊重使用者（FR-4），
      // 否則是 YouTube 自動調整，切回鎖定的畫質（FR-3）。
      if (enforced === target && isManualChange(lastMenuInteraction, Date.now())) {
        userChose = true;
        console.info(`${LOG_PREFIX} quality lock: manual change detected; not enforcing for this video`);
        return;
      }
      await player.setQuality(target);
      enforced = target;
      touched = true;
    } catch (err) {
      console.info(`${LOG_PREFIX} quality lock failed`, err);
    }
  };

  const release = () => {
    enforced = null;
    if (!touched) return;
    touched = false;
    player.setQuality(AUTO_QUALITY).catch((err: unknown) => console.info(`${LOG_PREFIX} quality lock: release failed`, err));
  };

  const onVideoEvent = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.matches?.(SELECTORS.video)) void check();
  };

  const onMenuInput = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.closest?.(CONVENIENCE_SELECTORS.settingsMenu)) lastMenuInteraction = Date.now();
  };

  const apply = (value: QualityLock) => {
    state.set({ value });
    userChose = false;
    if (value === 'off') release();
    else {
      enforced = null;
      void check();
    }
  };

  return {
    state,
    setLock(value) {
      if (!isLock(value) || value === state.get().value) return;
      void qualityLock.setValue(value);
      apply(value);
    },
    start() {
      if (running) return;
      running = true;
      // 媒體事件不會冒泡，但會經過 document 的捕獲階段；YouTube 換掉 <video> 時也不用重新掛監聽。
      for (const type of VIDEO_EVENTS) document.addEventListener(type, onVideoEvent, true);
      for (const type of MENU_EVENTS) document.addEventListener(type, onMenuInput, true);
      // 其他分頁改變設定時同步（FR-5）。
      unwatch = qualityLock.watch((value) => {
        if (running && isLock(value) && value !== state.get().value) apply(value);
      });
      void qualityLock.getValue().then((value) => {
        if (running) apply(isLock(value) ? value : 'off');
      });
    },
    stop() {
      if (!running) return;
      running = false;
      for (const type of VIDEO_EVENTS) document.removeEventListener(type, onVideoEvent, true);
      for (const type of MENU_EVENTS) document.removeEventListener(type, onMenuInput, true);
      unwatch?.();
      unwatch = null;
      videoId = null;
      userChose = false;
      // 停用時還原頁面：交還給 YouTube 自動決定（003 FR-5）。
      release();
    },
    navigate() {
      void check();
    },
  };
}
