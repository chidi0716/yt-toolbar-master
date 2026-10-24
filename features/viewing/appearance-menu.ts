// 由程式操作 YouTube 自己的「外觀」選單（003 FR-10、FR-11、FR-15，plan 3.7，T06d）。
// 依序：讓選單不可見 → 點帳號／設定選單按鈕 → 點「外觀」→ 點深色或淺色選項 → 等主題改變
// （或 YouTube 自己重新載入頁面）→ 關閉選單 → 恢復可見。
// 與 DOM 的互動都透過 AppearanceMenuDeps 傳入，流程本身可以用假的依賴做單元測試。

export type ThemeChoice = 'dark' | 'light';

export interface Clickable {
  click(): void;
}

export interface AppearanceMenuDeps {
  /** 帳號（已登入）或設定（未登入）選單的按鈕。 */
  menuButton(): Clickable | null;
  /** 顯示中的「外觀」項目。 */
  appearanceItem(): Clickable | null;
  /** 請頁面橋接腳本標記外觀子選單中的深色／淺色選項；失敗時回傳 null。 */
  markThemeOptions(): Promise<{ dark: boolean; light: boolean } | null>;
  /** 已標記、顯示中的選項。 */
  themeOption(theme: ThemeChoice): Clickable | null;
  /** 彈出選單是否仍然打開。 */
  isMenuOpen(): boolean;
  /** 頁面目前實際顯示的主題。 */
  currentTheme(): ThemeChoice;
  /** 頁面是否已開始卸載（YouTube 選單在未登入時會重新載入頁面）。 */
  isUnloading(): boolean;
  /** 讓 YouTube 的彈出選單不可見（true）或恢復（false）。 */
  setMenuHidden(hidden: boolean): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type AppearanceSwitchResult =
  | { ok: true; reloading: boolean }
  | { ok: false; reason: 'NO_MENU_BUTTON' | 'NO_APPEARANCE_ITEM' | 'NO_THEME_OPTION' | 'THEME_NOT_CHANGED' };

/** 整個操作的時間上限（含已登入時選單向伺服器載入的時間）。 */
export const APPEARANCE_MENU_TIMEOUT_MS = 5000;
/** 等待選單出現或主題改變時的檢查間隔（只在操作期間，最多 APPEARANCE_MENU_TIMEOUT_MS）。 */
export const APPEARANCE_MENU_POLL_MS = 50;
/** 關閉選單後等它收起的時間上限，之後才恢復可見，避免收起動畫被看見。 */
export const APPEARANCE_MENU_CLOSE_MS = 1000;

async function waitFor<T>(deps: AppearanceMenuDeps, deadline: number, probe: () => T | null | Promise<T | null>): Promise<T | null> {
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (deps.now() >= deadline) return null;
    await deps.sleep(APPEARANCE_MENU_POLL_MS);
  }
}

/** 操作 YouTube 外觀選單切換到指定主題。 */
export async function switchThemeWithMenu(target: ThemeChoice, deps: AppearanceMenuDeps): Promise<AppearanceSwitchResult> {
  const deadline = deps.now() + APPEARANCE_MENU_TIMEOUT_MS;
  deps.setMenuHidden(true);
  let result: AppearanceSwitchResult = { ok: false, reason: 'NO_MENU_BUTTON' };
  const button = deps.menuButton();
  try {
    if (!button) return result;
    button.click();

    const appearance = await waitFor(deps, deadline, () => deps.appearanceItem());
    if (!appearance) return (result = { ok: false, reason: 'NO_APPEARANCE_ITEM' });
    appearance.click();

    const option = await waitFor(deps, deadline, async () => {
      const marked = await deps.markThemeOptions();
      return marked?.[target] ? deps.themeOption(target) : null;
    });
    if (!option) return (result = { ok: false, reason: 'NO_THEME_OPTION' });
    option.click();

    const done = await waitFor(deps, deadline, () => deps.isUnloading() || deps.currentTheme() === target);
    result = done ? { ok: true, reloading: deps.isUnloading() } : { ok: false, reason: 'THEME_NOT_CHANGED' };
    return result;
  } finally {
    // YouTube 正在重新載入頁面時不再碰選單（重新點按鈕會讓選單再打開）。
    if (!deps.isUnloading()) {
      if (button && deps.isMenuOpen()) {
        button.click();
        const closeDeadline = deps.now() + APPEARANCE_MENU_CLOSE_MS;
        await waitFor(deps, closeDeadline, () => !deps.isMenuOpen());
      }
      deps.setMenuHidden(false);
    }
  }
}

/** 失敗時記錄在 console 的說明：哪一個步驟失敗（003 FR-15）。 */
export function describeFailure(reason: Extract<AppearanceSwitchResult, { ok: false }>['reason'], target: ThemeChoice): string {
  switch (reason) {
    case 'NO_MENU_BUTTON':
      return 'step 1/3 failed: the account/settings menu button was not found in the top bar';
    case 'NO_APPEARANCE_ITEM':
      return 'step 2/3 failed: the Appearance item was not found in the account/settings menu';
    case 'NO_THEME_OPTION':
      return `step 3/3 failed: the ${target} theme option was not found in the Appearance menu`;
    case 'THEME_NOT_CHANGED':
      return `the ${target} theme option was selected, but the page theme did not change (check whether another extension controls the theme)`;
  }
}
