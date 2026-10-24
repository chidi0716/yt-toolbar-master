// 深色模式（003 FR-10 至 FR-16，plan 3.7，T06d）：由擴充功能代替使用者操作 YouTube 自己的「外觀」選單
// （已登入：頭像選單；未登入：設定選單）選擇深色或淺色主題，效果與使用者自己選擇完全相同，
// 已登入時帳號的外觀設定也跟著改變。操作期間 YouTube 的彈出選單不可見。
// 擴充功能不另外記住狀態，也不修改主題 cookie 或頁面主題屬性；按鈕只反映 <html dark> 的實際狀態。
// 找不到選單或選項時（例如 YouTube 改版，或其他擴充功能接管了主題）不做任何修改、不重試（FR-91），
// 按鈕提示說明可能原因，console 記錄失敗的步驟（FR-15）。
import { t } from '@/utils/i18n';
import {
  DARK_THEME_ATTRIBUTE,
  findAccountMenuButton,
  findAppearanceItem,
  findOpenPopup,
  findThemeOption,
  isDarkTheme,
} from '@/utils/youtube/dom';
import { appearanceMenu } from '@/utils/youtube/player';
import { describeFailure, switchThemeWithMenu, type AppearanceMenuDeps, type ThemeChoice } from './appearance-menu';
import { THEME_MENU_BUSY_CLASS, ensurePageStyles } from './page-styles';
import { createStore, type ToggleState, type ViewingFeature } from './store';

const LOG_PREFIX = '[yt-toolbar-master]';
/**
 * 無法切換時，按鈕提示顯示說明的時間（003 FR-15，約 6 秒）。時間到時滑鼠仍在按鈕上，
 * 工具列會讓提示留到滑鼠移開為止。一次性的計時器（001 NFR-3）。
 */
const NOTICE_MS = 6000;

export interface DarkModeFeature extends ViewingFeature {
  state: ReturnType<typeof createStore<ToggleState>>;
  toggle(): void;
}

/** 實際操作頁面的依賴。 */
function pageDeps(isUnloading: () => boolean): AppearanceMenuDeps {
  return {
    menuButton: () => findAccountMenuButton(),
    appearanceItem: () => findAppearanceItem(),
    markThemeOptions: () => appearanceMenu.markThemeOptions().catch(() => null),
    themeOption: (theme) => findThemeOption(theme),
    isMenuOpen: () => findOpenPopup() !== null,
    currentTheme: () => (isDarkTheme() ? 'dark' : 'light'),
    isUnloading,
    setMenuHidden: (hidden) => {
      if (hidden) ensurePageStyles();
      document.documentElement.classList.toggle(THEME_MENU_BUSY_CLASS, hidden);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

export function createDarkMode(): DarkModeFeature {
  const state = createStore<ToggleState>({ active: isDarkTheme() });
  let observer: MutationObserver | null = null;
  let busy = false;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  // 使用者從 YouTube 選單切換主題時，按鈕跟著更新（FR-12）。
  const sync = () => state.set((prev) => (prev.active === isDarkTheme() ? prev : { ...prev, active: isDarkTheme() }));

  const showNotice = () => {
    clearTimeout(noticeTimer);
    state.set((prev) => ({ ...prev, notice: t('darkModeUnavailableHint') }));
    noticeTimer = setTimeout(() => state.set((prev) => ({ active: prev.active })), NOTICE_MS);
  };

  return {
    state,
    start() {
      observer ??= new MutationObserver(sync);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: [DARK_THEME_ATTRIBUTE] });
      sync();
    },
    stop() {
      // 工具列關閉時不改變 YouTube 的主題（FR-14），只停止更新按鈕。
      observer?.disconnect();
      observer = null;
    },
    toggle() {
      if (busy) return;
      busy = true;
      // 依目前實際顯示的主題切換；「使用裝置主題」時改為明確的深色或淺色（FR-13）。
      const target: ThemeChoice = isDarkTheme() ? 'light' : 'dark';
      const focused = document.activeElement as HTMLElement | null;
      let unloading = false;
      const onUnload = () => (unloading = true);
      addEventListener('beforeunload', onUnload);
      addEventListener('pagehide', onUnload);
      void switchThemeWithMenu(target, pageDeps(() => unloading))
        .then((result) => {
          if (!result.ok) {
            console.info(
              `${LOG_PREFIX} dark mode: could not use YouTube's appearance menu (${result.reason}): ${describeFailure(result.reason, target)}; nothing changed`,
            );
            showNotice();
          }
        })
        .catch((err: unknown) => {
          console.info(`${LOG_PREFIX} dark mode: appearance menu failed`, err);
          showNotice();
        })
        .finally(() => {
          busy = false;
          removeEventListener('beforeunload', onUnload);
          removeEventListener('pagehide', onUnload);
          // 焦點回到原本的位置（工具列按鈕），不留在 YouTube 的選單按鈕上。
          if (!unloading && focused?.isConnected) focused.focus({ preventScroll: true });
          sync();
        });
    },
  };
}
