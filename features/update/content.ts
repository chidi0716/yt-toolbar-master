// 內容腳本端的新版本提醒（008 FR-27 至 FR-29b，plan 3.9）：
// - 影片頁載入完成時請背景腳本查詢（背景腳本決定是否真的連網）；
// - 收集卡片的顯示條件（分頁在前景、工具列在畫面中、全螢幕、子母畫面、正在輸入）與使用者操作，交給 reminder.ts；
// - 其他分頁或設定頁處理提醒後（storage 改變）重新讀取狀態；
// - 卡片與「更多」選單的操作：前往下載、跳過這個版本、不再提醒、✕。
// 只有在有提醒要顯示（等待出現或卡片顯示中）時才監聽頁面事件，平常不增加任何監聽（001 NFR-3）。
import { sendToBackground } from '@/features/downloads/content';
import { updateCheck, updateReminder } from '@/utils/settings';
import { isReleaseUrl, type ReminderAction, type ReminderView } from '@/utils/update-check';
import { createReminderController, type ReminderController, type ReminderPhase } from './reminder';

const LOG_PREFIX = '[yt-toolbar-master]';
/** pointermove 很頻繁：最多每這麼久回報一次操作。 */
const ACTIVITY_THROTTLE_MS = 500;

export interface UpdateReminder {
  readonly controller: ReminderController;
  /** 影片頁載入完成（含 YouTube 站內換頁到影片頁）。 */
  check(): void;
  /** 工具列掛載時傳入 Shadow DOM 的宿主元素，移除時傳入 null（工具列被關閉時不顯示卡片，FR-29b）。 */
  attach(host: HTMLElement | null): void;
  /** 工具列本身的阻擋條件：展開的面板、編輯工具列。 */
  setToolbarBlocked(blocked: boolean): void;
  open(): void;
  skip(): void;
  disable(): void;
  dismiss(): void;
  dispose(): void;
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'number', 'password', 'tel']);

/** 焦點是否在可以輸入文字的地方（含 Shadow DOM 內）。 */
export function isTyping(doc: Document = document): boolean {
  let el: Element | null = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type) && !el.disabled && !el.readOnly;
  return el instanceof HTMLElement && el.isContentEditable;
}

/** 全螢幕、子母畫面、正在輸入（constitution 第 7c 點）。 */
const pageBlocked = () => !!document.fullscreenElement || !!document.pictureInPictureElement || isTyping();

export function createUpdateReminder(): UpdateReminder {
  let view: ReminderView | null = null;
  let host: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let listening = false;
  let activityListening = false;
  let lastActivity = 0;
  let disposed = false;

  const controller = createReminderController({
    onCardShown: (version) => void send('cardShown', version),
  });

  const apply = (next: ReminderView | null) => {
    view = next;
    controller.setView(next);
  };

  async function request(type: 'updateCheck' | 'updateStatus') {
    const res = await sendToBackground<{ view: ReminderView }>({ type });
    if (!disposed && res.ok && res.view) apply(res.view);
  }

  async function send(action: ReminderAction, version: string | null) {
    const res = await sendToBackground<{ view: ReminderView }>({ type: 'updateAction', action, version });
    if (!res.ok) console.info(`${LOG_PREFIX} update reminder action failed: ${action}`);
  }

  // ---- 顯示條件與操作 ----
  const refreshConditions = () =>
    controller.setConditions({ pageVisible: document.visibilityState === 'visible', pageBlocked: pageBlocked() });
  const onActivity = () => {
    const now = Date.now();
    if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
    lastActivity = now;
    if (document.visibilityState === 'visible') controller.activity();
  };
  const onFocusChange = () => queueMicrotask(refreshConditions);

  const pageEvents: Array<[EventTarget, string, EventListener, AddEventListenerOptions]> = [
    [document, 'visibilitychange', refreshConditions, {}],
    [document, 'fullscreenchange', refreshConditions, {}],
    [document, 'enterpictureinpicture', refreshConditions, { capture: true }],
    [document, 'leavepictureinpicture', refreshConditions, { capture: true }],
    [document, 'focusin', onFocusChange, { capture: true }],
    [document, 'focusout', onFocusChange, { capture: true }],
  ];
  const activityEvents: Array<[EventTarget, string, EventListener, AddEventListenerOptions]> = [
    [window, 'pointermove', onActivity, { capture: true, passive: true }],
    [window, 'pointerdown', onActivity, { capture: true, passive: true }],
    [window, 'keydown', onActivity, { capture: true, passive: true }],
    [window, 'wheel', onActivity, { capture: true, passive: true }],
  ];
  const toggle = (list: typeof pageEvents, on: boolean) => {
    for (const [target, type, fn, opts] of list) {
      if (on) target.addEventListener(type, fn, opts);
      else target.removeEventListener(type, fn, opts);
    }
  };

  const observe = () => {
    observer?.disconnect();
    observer = null;
    if (!listening || !host) return;
    observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) controller.setConditions({ inViewport: entry.isIntersecting });
    });
    observer.observe(host);
  };

  /** 只在等待出現或卡片顯示中時監聽頁面事件。 */
  const syncListeners = (phase: ReminderPhase) => {
    const want = phase === 'waiting' || phase === 'card';
    if (want !== listening) {
      listening = want;
      toggle(pageEvents, want);
      observe();
      if (want) refreshConditions();
    }
    const wantActivity = phase === 'card';
    if (wantActivity !== activityListening) {
      activityListening = wantActivity;
      toggle(activityEvents, wantActivity);
    }
  };
  const unsubscribe = controller.state.subscribe(() => syncListeners(controller.state.get().phase));

  // 其他分頁、設定頁處理提醒，或其他分頁查詢到新版本時，重新讀取狀態。
  const unwatch = [updateReminder.watch(() => void request('updateStatus')), updateCheck.watch(() => void request('updateStatus'))];

  const act = (action: ReminderAction) => {
    const version = view?.latest?.version ?? null;
    if (!version) return;
    controller.handled();
    void send(action, version);
  };

  return {
    controller,
    check() {
      void request('updateCheck');
    },
    attach(next) {
      host = next;
      controller.setConditions({ mounted: !!next, inViewport: false });
      observe();
    },
    setToolbarBlocked(blocked) {
      controller.setConditions({ toolbarBlocked: blocked });
    },
    open() {
      const url = view?.latest?.url;
      // 只開啟通過檢查的版本頁面網址（plan 3.9）。
      if (!isReleaseUrl(url)) return;
      window.open(url, '_blank', 'noopener');
      act('open');
    },
    skip: () => act('skip'),
    disable: () => act('disable'),
    dismiss: () => controller.dismiss(),
    dispose() {
      disposed = true;
      unsubscribe();
      for (const u of unwatch) u();
      syncListeners('none');
      observer?.disconnect();
      controller.dispose();
    },
  };
}
