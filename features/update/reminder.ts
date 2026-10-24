// 工具列上的新版本提醒卡片（008 FR-28、FR-29b，constitution 第 7c 點，plan 3.9）：何時出現、何時收合。
// 不依賴 DOM：顯示條件與使用者操作由內容腳本（features/update/content.ts）回報，計時器可以注入（單元測試用假計時器）。
//
// - 出現：有今天還沒出現過的提醒（view.showCard），且分頁在前景、工具列在畫面中、沒有任何阻擋條件
//   （展開的面板、編輯工具列、全螢幕、子母畫面、正在輸入）。條件不符時等待，符合時才出現。
// - 收合：卡片出現後，分頁在前景且使用者有移動滑鼠、捲動或按鍵後才開始計時；累計 15 秒沒有處理就收合成「更多」上的小圓點。
//   滑鼠停在卡片上、分頁在背景、卡片暫時被阻擋（例如展開面板）時暫停；使用者一段時間沒有任何操作時也暫停，
//   回來操作後才繼續，所以離開電腦時卡片不會自己消失。
// - 小圓點保留到使用者處理（前往下載、跳過、不再提醒）為止；只按 ✕ 等同收合。
import { createStore, type Store } from '@/features/viewing/store';
import type { ReminderView } from '@/utils/update-check';

/** 累計多久沒有處理就收合（FR-28）。 */
export const COLLAPSE_AFTER_MS = 15_000;
/** 最後一次操作後，還算「使用者在場」的時間；超過就暫停計時，等下一次操作。 */
export const PRESENCE_MS = 5_000;

export type ReminderPhase =
  /** 沒有需要提醒的新版本。 */
  | 'none'
  /** 今天還沒以卡片出現：等顯示條件符合。 */
  | 'waiting'
  /** 卡片顯示中（暫時被阻擋時看不到）。 */
  | 'card'
  /** 收合成「更多」上的小圓點。 */
  | 'collapsed';

export interface ReminderState {
  phase: ReminderPhase;
  view: ReminderView | null;
  /** 卡片目前實際畫在畫面上（phase 為 card 且沒有被阻擋）。 */
  cardVisible: boolean;
}

export interface ReminderConditions {
  /** document.visibilityState === 'visible'。 */
  pageVisible: boolean;
  /** 工具列在畫面中。 */
  inViewport: boolean;
  /** 全螢幕、子母畫面、正在輸入等頁面狀態。 */
  pageBlocked: boolean;
  /** 工具列本身的狀態：展開的面板、編輯工具列。 */
  toolbarBlocked: boolean;
  /** 工具列已掛載（工具列被關閉時不顯示卡片，FR-29b）。 */
  mounted: boolean;
}

export interface ReminderTimers {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

export interface ReminderController {
  readonly state: Store<ReminderState>;
  /** 背景腳本回報的提醒狀態（查詢後、其他分頁或設定頁處理後）。 */
  setView(view: ReminderView | null): void;
  setConditions(partial: Partial<ReminderConditions>): void;
  /** 使用者移動滑鼠、捲動或按鍵（只在分頁在前景時呼叫）。 */
  activity(): void;
  /** 滑鼠移入／移出卡片。 */
  hover(inside: boolean): void;
  /** ✕：只關閉這次，收合成小圓點。 */
  dismiss(): void;
  /** 前往下載、跳過、不再提醒：立即移除（背景腳本隨後回報新的狀態）。 */
  handled(): void;
  /** 目前累計的計時（測試用）。 */
  elapsed(): number;
  dispose(): void;
}

const defaultTimers: ReminderTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

export function createReminderController(options: {
  /** 卡片實際出現時呼叫（背景腳本記下「今天已經出現過」）。 */
  onCardShown: (version: string) => void;
  timers?: ReminderTimers;
}): ReminderController {
  const timers = options.timers ?? defaultTimers;
  const state = createStore<ReminderState>({ phase: 'none', view: null, cardVisible: false });
  const cond: ReminderConditions = { pageVisible: true, inViewport: false, pageBlocked: false, toolbarBlocked: false, mounted: false };
  let phase: ReminderPhase = 'none';
  let view: ReminderView | null = null;
  let cardVersion: string | null = null;
  let hovered = false;
  /** 累計的計時（毫秒）。 */
  let elapsed = 0;
  /** 正在計時的起點；null 表示暫停。 */
  let runningSince: number | null = null;
  /** 最後一次操作的時間；null 表示卡片出現（或分頁回到前景）後還沒有操作。 */
  let lastActivity: number | null = null;
  let timer: unknown = null;

  const canShow = () => cond.mounted && cond.pageVisible && cond.inViewport && !cond.pageBlocked && !cond.toolbarBlocked;
  const cardVisible = () => phase === 'card' && cond.mounted && !cond.pageBlocked && !cond.toolbarBlocked;

  const publish = () => {
    const next = { phase, view, cardVisible: cardVisible() };
    const prev = state.get();
    if (prev.phase !== next.phase || prev.view !== next.view || prev.cardVisible !== next.cardVisible) state.set(next);
  };

  const stopTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };

  /** 停止計時並把已經過的時間加進累計。 */
  const pause = () => {
    if (runningSince !== null) {
      const now = timers.now();
      const until = lastActivity !== null ? Math.min(now, lastActivity + PRESENCE_MS) : now;
      elapsed += Math.max(0, until - runningSince);
      runningSince = null;
    }
    stopTimer();
  };

  const collapse = () => {
    pause();
    phase = 'collapsed';
    publish();
  };

  /** 依目前條件決定是否計時，並排定下一次檢查。 */
  const schedule = () => {
    pause();
    if (phase !== 'card') return;
    const now = timers.now();
    const present = lastActivity !== null && now - lastActivity < PRESENCE_MS;
    if (!(canShow() && !hovered && present)) return;
    runningSince = now;
    const remaining = COLLAPSE_AFTER_MS - elapsed;
    if (remaining <= 0) {
      collapse();
      return;
    }
    const untilAway = lastActivity! + PRESENCE_MS - now;
    timer = timers.setTimeout(() => {
      timer = null;
      pause();
      if (elapsed >= COLLAPSE_AFTER_MS) collapse();
      else schedule();
    }, Math.max(0, Math.min(remaining, untilAway)));
  };

  const showCardIfPossible = () => {
    if (phase !== 'waiting' || !view?.latest || !canShow()) return;
    phase = 'card';
    cardVersion = view.latest.version;
    elapsed = 0;
    lastActivity = null;
    hovered = false;
    options.onCardShown(cardVersion);
  };

  const update = () => {
    showCardIfPossible();
    schedule();
    publish();
  };

  return {
    state,
    setView(next) {
      view = next;
      const version = next?.latest?.version ?? null;
      if (!next?.pending || !version) {
        pause();
        phase = 'none';
        cardVersion = null;
      } else if ((phase === 'card' || phase === 'collapsed') && cardVersion === version) {
        // 同一個版本：維持目前的卡片或小圓點（卡片出現後 showCard 會變成 false）。
      } else if (next.showCard) {
        pause();
        phase = 'waiting';
      } else {
        pause();
        phase = 'collapsed';
        cardVersion = version;
      }
      update();
    },
    setConditions(partial) {
      const wasVisible = cond.pageVisible;
      Object.assign(cond, partial);
      // 分頁從背景回到前景：要等使用者再次操作才繼續計時。
      if (!wasVisible && cond.pageVisible) lastActivity = null;
      if (!cond.pageVisible) lastActivity = null;
      update();
    },
    activity() {
      if (phase !== 'card' || !cond.pageVisible) return;
      pause();
      lastActivity = timers.now();
      update();
    },
    hover(inside) {
      if (hovered === inside) return;
      pause();
      hovered = inside;
      // 滑鼠離開卡片也算一次操作。
      if (!inside && phase === 'card' && cond.pageVisible) lastActivity = timers.now();
      update();
    },
    dismiss() {
      if (phase === 'card' || phase === 'waiting') collapse();
    },
    handled() {
      pause();
      phase = 'none';
      publish();
    },
    elapsed() {
      if (runningSince === null) return elapsed;
      const now = timers.now();
      const until = lastActivity !== null ? Math.min(now, lastActivity + PRESENCE_MS) : now;
      return elapsed + Math.max(0, until - runningSince);
    },
    dispose() {
      pause();
    },
  };
}
