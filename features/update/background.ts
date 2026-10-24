// 背景腳本端的新版本提醒（008 FR-26 至 FR-29a，plan 3.9）：
// - 內容腳本在影片頁載入、距上次查詢 24 小時以上時送 updateCheck；可以提醒、沒有選「不再提醒」、到期才查詢；
// - 依結果更新擴充功能圖示的 NEW 標記（沒變時不重設）；
// - 處理卡片與設定頁的操作（前往下載、跳過這個版本、不再提醒、重新開啟、卡片出現過）。
// 相依的瀏覽器 API 由外部注入，單元測試以假的實作代替。
import {
  applyReminderAction,
  BADGE_TEXT,
  fetchLatestRelease,
  isReminderEligible,
  normalizeCheckState,
  normalizeReminderState,
  reminderView,
  shouldCheck,
  type LatestRelease,
  type ReminderAction,
  type ReminderView,
} from '@/utils/update-check';
import { readSettings, updateCheck, updateReminder } from '@/utils/settings';

export interface UpdateServiceDeps {
  /** management.getSelf().installType（不需要 management 權限）。 */
  installType: () => Promise<string | null>;
  currentVersion: () => string;
  fetchRelease: () => Promise<LatestRelease | null>;
  setBadge: (text: string) => Promise<void> | void;
  now: () => number;
}

export interface UpdateService {
  /** 目前的狀態（不查詢）。 */
  status(): Promise<ReminderView>;
  /** 到了該查詢的時間就查詢，回傳查詢後的狀態。 */
  checkIfDue(): Promise<ReminderView>;
  act(action: ReminderAction, version: string | null): Promise<ReminderView>;
  /** 依目前狀態設定圖示標記（背景腳本啟動時、擴充功能更新後）。 */
  refreshBadge(): Promise<void>;
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  let eligibleCache: Promise<boolean> | null = null;
  let running: Promise<void> | null = null;

  const eligible = () => {
    eligibleCache ??= deps.installType().then(isReminderEligible, (err: unknown) => {
      console.info('[yt-toolbar-master] update check: cannot read the install type', err);
      return false;
    });
    return eligibleCache;
  };

  const read = async () => {
    const [check, reminder] = await readSettings([updateCheck, updateReminder] as const);
    return { check: normalizeCheckState(check), reminder: normalizeReminderState(reminder) };
  };

  const status = async (): Promise<ReminderView> => {
    const { check, reminder } = await read();
    return reminderView({ currentVersion: deps.currentVersion(), eligible: await eligible(), check, reminder, now: deps.now() });
  };

  /** 目前的圖示標記；背景腳本重新啟動後為 null（一定設定一次）。 */
  let badge: string | null = null;
  const applyBadge = async (view: ReminderView) => {
    const text = view.pending ? BADGE_TEXT : '';
    if (text === badge) return;
    try {
      await deps.setBadge(text);
      badge = text;
    } catch (err) {
      console.info('[yt-toolbar-master] failed to set the badge', err);
    }
  };

  const runCheck = async () => {
    const { check, reminder } = await read();
    const now = deps.now();
    if (!shouldCheck({ eligible: await eligible(), reminder, check, now })) return;
    // 先記下查詢時間：同時開啟的分頁不會重複查詢；失敗時也要等 24 小時後才再試（每 24 小時最多一次）。
    await updateCheck.setValue({ ...check, lastCheckedAt: now });
    const latest = await deps.fetchRelease();
    const after = normalizeCheckState(await updateCheck.getValue());
    await updateCheck.setValue(latest ? { ...after, latest, lastResult: 'ok' } : { ...after, lastResult: 'failed' });
  };

  return {
    status,
    async checkIfDue() {
      running ??= runCheck().finally(() => {
        running = null;
      });
      await running;
      const view = await status();
      await applyBadge(view);
      return view;
    },
    async act(action, version) {
      const { reminder } = await read();
      await updateReminder.setValue(applyReminderAction(reminder, action, version, deps.now()));
      const view = await status();
      await applyBadge(view);
      return view;
    },
    async refreshBadge() {
      await applyBadge(await status());
    },
  };
}

/** 背景腳本使用的實例。 */
export function browserUpdateService(): UpdateService {
  return createUpdateService({
    installType: async () => {
      const self = await browser.management?.getSelf?.();
      return self?.installType ?? null;
    },
    currentVersion: () => browser.runtime.getManifest().version,
    fetchRelease: () => fetchLatestRelease(),
    setBadge: (text) => browser.action.setBadgeText({ text }),
    now: () => Date.now(),
  });
}
