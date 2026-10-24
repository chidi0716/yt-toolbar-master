// 劇院模式（003 FR-20 至 FR-23，plan 3.7，T07a）：分區調暗。
// 在 <html> 加上 class，以 CSS 把播放器容器與工具列以外的頁面區域調暗、頁面背景改為黑色
// （區域選擇器在 utils/youtube/dom.ts）。不使用蓋住整頁的遮罩：播放器位於多層形成堆疊脈絡的
// 容器內，提高 z-index 無法讓播放器跳出遮罩，會連播放器一起蓋住。
// 點被調暗的區域（以捕獲階段攔截，不會誤觸連結）或按 Esc 關閉。不記住狀態。
import { findPlayerContainer, isInCinemaDimmedRegion } from '@/utils/youtube/dom';
import { isWatchPage } from '@/utils/youtube/page';
import { CINEMA_CLASS, ensurePageStyles } from './page-styles';
import { createStore, type ToggleState, type ViewingFeature } from './store';

/** 劇院模式時加在工具列宿主元素上的 class：工具列維持在調暗區域之上，按鈕改用深色背景上的顏色。 */
export const CINEMA_HOST_CLASS = 'yte-cinema-raised';

/**
 * 在調暗區域上攔截的滑鼠事件：全部阻止，讓 YouTube 的連結、按鈕與滑鼠移入效果都不會被觸發；
 * 其中 click 用來關閉劇院模式（FR-21），auxclick（中鍵）也不會開新分頁。
 */
export const CINEMA_INTERCEPTED_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick'] as const;

export interface CinemaFeature extends ViewingFeature {
  state: ReturnType<typeof createStore<ToggleState>>;
  toggle(): void;
  /** 工具列重新掛載時呼叫，讓工具列維持在調暗區域之上（FR-20a）。 */
  decorateToolbarHost(host: HTMLElement): void;
}

/** 事件的目標是否位於調暗的區域中。 */
function targetInDimmedRegion(event: Event): boolean {
  const target = event.target as Partial<Element> | null;
  // 不用 instanceof：Firefox 內容腳本中的頁面元素也適用。
  return typeof target?.closest === 'function' && isInCinemaDimmedRegion(target as Element);
}

export function createCinema(): CinemaFeature {
  const state = createStore<ToggleState>({ active: false });
  let toolbarHost: HTMLElement | null = null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // 有未釘選的面板展開時，Esc 先收起面板（001 FR-12），不關閉劇院模式。
    if (toolbarHost?.shadowRoot?.querySelector('.yte-panel:not([data-pinned])')) return;
    off();
  };

  const onPointer = (event: Event) => {
    if (!targetInDimmedRegion(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'click') off();
  };

  function on() {
    if (!findPlayerContainer()) {
      console.info('[yt-toolbar-master] cinema mode: player container not found');
      return;
    }
    ensurePageStyles();
    document.documentElement.classList.add(CINEMA_CLASS);
    toolbarHost?.classList.add(CINEMA_HOST_CLASS);
    window.addEventListener('keydown', onKeyDown, true);
    for (const type of CINEMA_INTERCEPTED_EVENTS) window.addEventListener(type, onPointer, true);
    state.set({ active: true });
  }

  function off() {
    document.documentElement.classList.remove(CINEMA_CLASS);
    toolbarHost?.classList.remove(CINEMA_HOST_CLASS);
    window.removeEventListener('keydown', onKeyDown, true);
    for (const type of CINEMA_INTERCEPTED_EVENTS) window.removeEventListener(type, onPointer, true);
    state.set({ active: false });
  }

  return {
    state,
    start() {},
    stop: off,
    navigate() {
      // 離開觀看頁時關閉；換到另一部影片時繼續生效（003 FR-3）。
      if (!isWatchPage(location.href)) off();
    },
    toggle() {
      if (state.get().active) off();
      else on();
    },
    decorateToolbarHost(host) {
      toolbarHost = host;
      host.classList.toggle(CINEMA_HOST_CLASS, state.get().active);
    },
  };
}
