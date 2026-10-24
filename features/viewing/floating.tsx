// 浮動播放器（003 FR-40 至 FR-46，plan 3.7）：播放器捲出畫面時縮小並固定在角落，
// 可拖到其他角落並貼齊、記住位置；✕ 暫時回到原位置。只用 CSS 與擴充功能內建的程式。
// 是否浮出只在使用者捲動（scroll 事件）與使用者操作時判斷，不因其他功能或 YouTube 的版面變化
// 而浮出（FR-46）；劇院模式開啟期間暫停作用（FR-45）。
import { render } from 'preact';
import { Icon } from '@/components/icons';
import { useLocale } from '@/components/useLocale';
import { t } from '@/utils/i18n';
import { ensureStyle } from '@/utils/style';
import { Z_INDEX } from '@/utils/z-index';
import { floatingCorner, floatingPlayer, readSettings } from '@/utils/settings';
import { findPlayerContainer, findVideo, mastheadHeight } from '@/utils/youtube/dom';
import { isWatchPage } from '@/utils/youtube/page';
import {
  clampToViewport,
  cornerRect,
  floatingReducer,
  initialFloatingState,
  isCorner,
  isFloating,
  nearestCorner,
  placeholderOutOfView,
  type Corner,
  type FloatingEvent,
  type FloatingState,
  type Rect,
  type Viewport,
} from './floating-logic';
import { ensurePageStyles } from './page-styles';
import { createStore, type ToggleState, type ViewingFeature } from './store';

const FLOATING_CLASS = 'ytm-floating';
const POSITION_STYLE_ID = 'ytm-floating-position';
const CONTROLS_TAG = 'ytm-floating-controls';

export interface FloatingFeature extends ViewingFeature {
  state: ReturnType<typeof createStore<ToggleState>>;
  toggle(): void;
  /** 劇院模式開啟時暫停（浮動中會先回到原位），關閉時恢復判斷（FR-45）。 */
  setSuspended(suspended: boolean): void;
}

const CONTROLS_CSS = `
:host { all: initial; position: fixed; z-index: ${Z_INDEX.floatingControls}; pointer-events: none; }
.bar {
  position: absolute; inset: 0 0 auto 0; height: 36px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 4px 0 8px; box-sizing: border-box;
  background: linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0));
  color: #fff; pointer-events: auto; cursor: move; touch-action: none;
  border-radius: 12px 12px 0 0; opacity: 0.85;
}
.bar:hover { opacity: 1; }
.close {
  display: grid; place-items: center; width: 32px; height: 32px; padding: 0;
  border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer;
}
.close:hover { background: rgba(255, 255, 255, 0.2); }
.close:focus-visible { outline: 2px solid #fff; }
svg { display: block; }
`;

function Controls({ onPointerDown, onClose }: { onPointerDown: (e: PointerEvent) => void; onClose: () => void }) {
  useLocale();
  return (
    <div class="bar" title={t('floatingDrag')} onPointerDown={onPointerDown}>
      <Icon name="drag_indicator" size={20} />
      <button
        type="button"
        class="close"
        aria-label={t('floatingClose')}
        title={t('floatingClose')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClose}
      >
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

export function createFloating(): FloatingFeature {
  const state = createStore<ToggleState>({ active: false });
  let fs: FloatingState = initialFloatingState(false);
  let corner: Corner = 'bottom-right';
  let running = false;
  let container: HTMLElement | null = null;
  /** 播放器原本所在的位置（浮動中的容器的父元素，仍留在版面中）。 */
  let placeholder: Element | null = null;
  let scrollFrame = 0;
  let controls: HTMLElement | null = null;
  let rect: Rect | null = null;
  let floating = false;

  const viewport = (): Viewport => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
    topInset: mastheadHeight(),
  });

  const aspect = () => {
    const video = findVideo();
    return video && video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
  };

  const notifyResize = () => window.dispatchEvent(new Event('resize'));

  /** 位置與尺寸寫在我們自己的 <style> 裡，不改 YouTube 元素的 style 屬性（plan 風險 R3）。 */
  const writeRect = (next: Rect) => {
    rect = next;
    ensureStyle(POSITION_STYLE_ID, `.${FLOATING_CLASS} { left: ${next.left}px !important; top: ${next.top}px !important; width: ${next.width}px !important; height: ${next.height}px !important; }`);
    if (controls) {
      Object.assign(controls.style, {
        left: `${next.left}px`,
        top: `${next.top}px`,
        width: `${next.width}px`,
        height: `${next.height}px`,
      });
    }
  };

  // ---- 拖曳（FR-41）----
  let drag: { dx: number; dy: number; pointerId: number; target: Element } | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !rect) return;
    event.preventDefault();
    const target = event.currentTarget as Element;
    target.setPointerCapture(event.pointerId);
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, pointerId: event.pointerId, target };
    target.addEventListener('pointermove', onPointerMove as EventListener);
    target.addEventListener('pointerup', onPointerUp as EventListener);
    target.addEventListener('pointercancel', onPointerUp as EventListener);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || !rect) return;
    writeRect(clampToViewport({ ...rect, left: event.clientX - drag.dx, top: event.clientY - drag.dy }, viewport()));
  };

  const onPointerUp = () => {
    if (!drag) return;
    drag.target.removeEventListener('pointermove', onPointerMove as EventListener);
    drag.target.removeEventListener('pointerup', onPointerUp as EventListener);
    drag.target.removeEventListener('pointercancel', onPointerUp as EventListener);
    drag = null;
    if (!rect) return;
    // 放開時貼齊最近的角落，並記住位置。
    corner = nearestCorner(rect, viewport());
    void floatingCorner.setValue(corner);
    writeRect(cornerRect(corner, viewport(), aspect()));
    notifyResize();
  };

  const showControls = () => {
    if (controls) return;
    controls = document.createElement(CONTROLS_TAG);
    const shadow = controls.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CONTROLS_CSS;
    const root = document.createElement('div');
    shadow.append(style, root);
    render(<Controls onPointerDown={onPointerDown} onClose={() => dispatch({ type: 'dismiss' })} />, root);
    document.body.append(controls);
  };

  const hideControls = () => {
    if (!controls) return;
    const root = controls.shadowRoot?.lastElementChild;
    if (root) render(null, root);
    controls.remove();
    controls = null;
  };

  const float = () => {
    if (!container) return;
    ensurePageStyles();
    showControls();
    writeRect(cornerRect(corner, viewport(), aspect()));
    container.classList.add(FLOATING_CLASS);
    floating = true;
    notifyResize();
  };

  const unfloat = () => {
    if (!floating) return;
    container?.classList.remove(FLOATING_CLASS);
    document.getElementById(POSITION_STYLE_ID)?.remove();
    hideControls();
    rect = null;
    floating = false;
    notifyResize();
  };

  const apply = () => {
    const wanted = running && !!container && isFloating(fs);
    if (wanted && !floating) float();
    else if (!wanted && floating) unfloat();
  };

  function dispatch(event: FloatingEvent) {
    fs = floatingReducer(fs, event);
    apply();
  }

  /** 依播放器原位置目前是否在畫面外更新狀態；無法判斷時不變（FR-46）。 */
  const checkVisibility = () => {
    // YouTube 切換劇院模式時會把播放器容器移到別的父元素：沒在浮動時跟著改用目前的父元素。
    const current = container?.parentElement ?? null;
    if (current && current !== placeholder && !floating) placeholder = current;
    if (!placeholder) return;
    const r = placeholder.getBoundingClientRect();
    const outOfView = placeholderOutOfView(r, viewport());
    if (outOfView !== null && outOfView !== fs.outOfView) dispatch({ type: 'visibility', outOfView });
  };

  // 只在使用者捲動時判斷，每個畫面最多一次（被動監聽，閒置時不執行任何東西）。
  const onScroll = () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      checkVisibility();
    });
  };

  const disconnect = () => {
    window.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    placeholder = null;
  };

  /** 找到播放器原本所在的位置並開始依捲動判斷。 */
  const attach = () => {
    if (!running || !fs.enabled || !isWatchPage(location.href)) {
      if (floating) unfloat();
      disconnect();
      container = null;
      return;
    }
    const next = findPlayerContainer();
    if (next !== container && floating) unfloat();
    container = next;
    const target = container?.parentElement ?? null;
    if (!target) {
      console.info('[yt-toolbar-master] floating player: player container not found');
      disconnect();
      return;
    }
    if (target !== placeholder) {
      disconnect();
      placeholder = target;
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    // 開啟、換頁是使用者的操作：立即依目前的捲動位置判斷一次。
    checkVisibility();
  };

  const onFullscreen = () => dispatch({ type: 'fullscreen', fullscreen: !!document.fullscreenElement });
  const onResize = (event: Event) => {
    // 忽略我們自己為了讓 YouTube 重新計算尺寸而觸發的 resize。
    if (!event.isTrusted || !floating) return;
    writeRect(cornerRect(corner, viewport(), aspect()));
  };

  const setEnabled = (value: boolean) => {
    state.set({ active: value });
    dispatch({ type: 'enable', enabled: value });
    attach();
  };

  return {
    state,
    start() {
      if (running) return;
      running = true;
      document.addEventListener('fullscreenchange', onFullscreen);
      window.addEventListener('resize', onResize);
      void readSettings([floatingPlayer, floatingCorner] as const).then(([enabled, savedCorner]) => {
        if (!running) return;
        if (isCorner(savedCorner)) corner = savedCorner;
        setEnabled(enabled);
      });
    },
    stop() {
      running = false;
      unfloat();
      disconnect();
      container = null;
      fs = initialFloatingState(fs.enabled);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('resize', onResize);
    },
    navigate() {
      dispatch({ type: 'navigate' });
      attach();
    },
    toggle() {
      const next = !fs.enabled;
      void floatingPlayer.setValue(next);
      setEnabled(next);
    },
    setSuspended(suspended) {
      if (fs.suspended === suspended) return;
      // 開啟劇院模式時若正在浮動，dispatch 會先讓播放器回到原位（FR-45）。
      dispatch({ type: 'suspend', suspended });
      // 關閉劇院模式後恢復正常判斷：依目前的捲動位置判斷一次。
      if (!suspended) checkVisibility();
    },
  };
}
