// 操作 YouTube 外觀選單的流程（T06d，003 FR-10、FR-11、FR-15）：以假的頁面依賴測試。
import { describe, expect, it } from 'vitest';
import { APPEARANCE_MENU_TIMEOUT_MS, describeFailure, switchThemeWithMenu, type AppearanceMenuDeps, type ThemeChoice } from './appearance-menu';

interface FakeOptions {
  noMenuButton?: boolean;
  noAppearance?: boolean;
  /** 子選單中有哪些選項（橋接腳本標記的結果）。 */
  options?: { dark: boolean; light: boolean } | null;
  /** 選擇後的行為：套用主題、重新載入頁面、或沒有反應。 */
  onSelect?: 'apply' | 'reload' | 'nothing';
  /** 選單內容要幾毫秒才出現（模擬向伺服器載入）。 */
  loadDelay?: number;
  /** 選擇後選單是否自己關閉。 */
  autoClose?: boolean;
  start?: ThemeChoice;
}

function fakePage(o: FakeOptions = {}) {
  let time = 0;
  let theme: ThemeChoice = o.start ?? 'light';
  let open = false;
  let openedAt = 0;
  let submenu = false;
  let unloading = false;
  const log: string[] = [];
  const hidden: boolean[] = [];
  const loaded = () => open && time - openedAt >= (o.loadDelay ?? 0);
  const deps: AppearanceMenuDeps = {
    menuButton: () =>
      o.noMenuButton
        ? null
        : {
            click: () => {
              open = !open;
              submenu = false;
              openedAt = time;
              log.push(open ? 'open' : 'close');
            },
          },
    appearanceItem: () =>
      loaded() && !o.noAppearance && !submenu
        ? {
            click: () => {
              submenu = true;
              log.push('appearance');
            },
          }
        : null,
    markThemeOptions: async () => (open && submenu ? (o.options === undefined ? { dark: true, light: true } : o.options) : { dark: false, light: false }),
    themeOption: (t) => ({
      click: () => {
        log.push(`select:${t}`);
        if (o.onSelect === 'reload') unloading = true;
        else if (o.onSelect !== 'nothing') theme = t;
        if (o.autoClose) open = false;
      },
    }),
    isMenuOpen: () => open,
    currentTheme: () => theme,
    isUnloading: () => unloading,
    setMenuHidden: (h) => hidden.push(h),
    sleep: async (ms) => {
      time += ms;
    },
    now: () => time,
  };
  return { deps, log, hidden, theme: () => theme, isOpen: () => open, time: () => time };
}

describe('switchThemeWithMenu', () => {
  it('依序點選單按鈕、外觀、目標選項；完成後關閉選單並恢復可見', async () => {
    const page = fakePage({ loadDelay: 300 });
    const result = await switchThemeWithMenu('dark', page.deps);
    expect(result).toEqual({ ok: true, reloading: false });
    expect(page.theme()).toBe('dark');
    expect(page.log).toEqual(['open', 'appearance', 'select:dark', 'close']);
    expect(page.isOpen()).toBe(false);
    expect(page.hidden).toEqual([true, false]);
  });

  it('選擇後選單已自己關閉時不再點按鈕（不會重新打開選單）', async () => {
    const page = fakePage({ autoClose: true });
    await switchThemeWithMenu('light', { ...page.deps, currentTheme: () => 'light' });
    expect(page.log).toEqual(['open', 'appearance', 'select:light']);
    expect(page.hidden).toEqual([true, false]);
  });

  it('YouTube 選擇後重新載入頁面時：視為成功，不再碰選單，也不恢復可見（避免卸載前閃現）', async () => {
    const page = fakePage({ onSelect: 'reload' });
    const result = await switchThemeWithMenu('dark', page.deps);
    expect(result).toEqual({ ok: true, reloading: true });
    expect(page.log).toEqual(['open', 'appearance', 'select:dark']);
    expect(page.hidden).toEqual([true]);
  });

  it('找不到選單按鈕：不做任何修改（FR-15）', async () => {
    const page = fakePage({ noMenuButton: true });
    expect(await switchThemeWithMenu('dark', page.deps)).toEqual({ ok: false, reason: 'NO_MENU_BUTTON' });
    expect(page.theme()).toBe('light');
    expect(page.hidden).toEqual([true, false]);
  });

  it('找不到「外觀」項目：逾時後關閉選單，不做任何修改（FR-15）', async () => {
    const page = fakePage({ noAppearance: true });
    expect(await switchThemeWithMenu('dark', page.deps)).toEqual({ ok: false, reason: 'NO_APPEARANCE_ITEM' });
    expect(page.time()).toBeGreaterThanOrEqual(APPEARANCE_MENU_TIMEOUT_MS);
    expect(page.log).toEqual(['open', 'close']);
    expect(page.theme()).toBe('light');
    expect(page.hidden).toEqual([true, false]);
  });

  it('子選單中沒有目標選項（例如 YouTube 改了動作代號）：不點任何選項（FR-15）', async () => {
    const page = fakePage({ options: { dark: false, light: true } });
    expect(await switchThemeWithMenu('dark', page.deps)).toEqual({ ok: false, reason: 'NO_THEME_OPTION' });
    expect(page.log).toEqual(['open', 'appearance', 'close']);
  });

  it('選擇後主題沒有改變：回報失敗並關閉選單', async () => {
    const page = fakePage({ onSelect: 'nothing' });
    expect(await switchThemeWithMenu('dark', page.deps)).toEqual({ ok: false, reason: 'THEME_NOT_CHANGED' });
    expect(page.log).toEqual(['open', 'appearance', 'select:dark', 'close']);
  });
});

describe('describeFailure（003 FR-15：console 記錄失敗的步驟）', () => {
  it('說明是哪一個步驟失敗', () => {
    expect(describeFailure('NO_MENU_BUTTON', 'dark')).toContain('step 1/3 failed: the account/settings menu button');
    expect(describeFailure('NO_APPEARANCE_ITEM', 'dark')).toContain('step 2/3 failed: the Appearance item');
    expect(describeFailure('NO_THEME_OPTION', 'light')).toContain('step 3/3 failed: the light theme option');
    expect(describeFailure('THEME_NOT_CHANGED', 'dark')).toContain('another extension controls the theme');
  });
});
