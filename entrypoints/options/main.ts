// 連線狀態區掛載面板的元件，使用相同的樣式；設定頁自己的樣式在後面，可以覆寫。
import '@/components/controls/controls.css';
import '@/components/panels/panels.css';
import './style.css';
import { TIDY_CATEGORIES } from '@/features/tidy/options';
import { applyI18n, initI18n, onLocaleChange, resolveLocale, setLocale, t, UI_LANGUAGES } from '@/utils/i18n';
import { applyPageTheme, PAGE_THEME_VALUES, type PageThemePreference } from '@/utils/page-theme';
import { pageTheme, UI_LANGUAGE_VALUES, uiLanguage, type UiLanguagePreference } from '@/utils/settings';
import { renderAbout } from './about';
import { group, selectRow, switchRow } from './dom';
import { renderDownloads } from './downloads';
import { renderToolbarSettings } from './toolbar';

// 設定頁：偏好設定依類別分組，每個選項一個開關、附一行說明（constitution 第 7a 點、005 FR-1）。
// 開關後立即寫入 sync 設定；已開啟的 YouTube 分頁由內容腳本監聽設定變更而立即生效（005 FR-3）。

/** 介面語言選單（007 FR-1、FR-5）。 */
const PAGE_THEME_LABELS = {
  youtube: 'optionsAppearanceYouTube',
  system: 'optionsAppearanceSystem',
  dark: 'optionsAppearanceDark',
  light: 'optionsAppearanceLight',
} as const satisfies Record<PageThemePreference, string>;

/** 外觀選單（007 FR-20 至 FR-22）：選擇後立即寫入設定，applyPageTheme 監聽設定而立即套用。 */
function appearanceRow(focus: boolean): HTMLElement {
  const { row, select } = selectRow(
    'page-theme',
    'optionsAppearance',
    'optionsAppearanceDesc',
    PAGE_THEME_VALUES.map((value) => ({ value, label: t(PAGE_THEME_LABELS[value]) })),
  );
  void pageTheme.getValue().then((value) => {
    select.value = PAGE_THEME_VALUES.includes(value) ? value : 'youtube';
    select.disabled = false;
    if (focus) select.focus();
  });
  select.addEventListener('change', () => void pageTheme.setValue(select.value as PageThemePreference));
  return row;
}

/** 介面語言（007 FR-1、FR-5）與外觀。 */
function renderLanguage(root: HTMLElement, focus: string | undefined): () => void {
  const fieldset = group('language', null);
  const { row, select } = selectRow(
    'ui-language',
    'optionsLanguage',
    'optionsLanguageNote',
    // 語言名稱以該語言本身顯示，「跟隨瀏覽器」以目前的介面語言顯示。
    UI_LANGUAGES.map((option) => ({
      value: option.value,
      label: option.label ? t(option.label) : (option.native ?? option.value),
      lang: option.native ? (option.value === 'zh_TW' ? 'zh-TW' : option.value) : undefined,
    })),
  );
  void uiLanguage.getValue().then((value) => {
    select.value = UI_LANGUAGE_VALUES.includes(value) ? value : 'auto';
    select.disabled = false;
    if (focus === 'ui-language') select.focus();
  });
  select.addEventListener('change', async () => {
    const value = select.value as UiLanguagePreference;
    // 寫入設定（已開啟的 YouTube 分頁跟著改變），再立即以新語言重新繪製設定頁（007 FR-3）。
    await uiLanguage.setValue(value);
    setLocale(resolveLocale(value));
  });
  fieldset.append(row, appearanceRow(focus === 'page-theme'));
  root.append(fieldset);
  return () => {};
}

/** 繪製整個設定頁；介面語言改變時以新語言重新繪製（007 FR-3）。回傳取消監聽的函式。 */
function renderPage(focusId?: string): () => void {
  applyI18n(document);
  document.title = t('optionsTitle');
  const cleanups: Array<() => void> = [];
  const container = (id: string) => {
    const el = document.querySelector<HTMLElement>(id)!;
    el.replaceChildren();
    return el;
  };
  cleanups.push(renderLanguage(container('#language-groups'), focusId));
  // 工具列（T34）
  cleanups.push(renderToolbarSettings(container('#toolbar-groups')));
  const groups = container('#tidy-groups');
  for (const category of TIDY_CATEGORIES) {
    const fieldset = group(category.id, category.title);
    fieldset.append(...category.options.map((o) => switchRow(`option-${o.id}`, o.label, o.description, o.item, cleanups, o.id)));
    groups.append(fieldset);
  }
  // 下載（T23）
  cleanups.push(renderDownloads(container('#downloads-groups')));
  // 關於（T44）
  cleanups.push(renderAbout(container('#about-groups')));
  return () => cleanups.forEach((c) => c());
}

await Promise.all([initI18n(), applyPageTheme()]);
let dispose = renderPage();
// 從通知打開時（例如 #downloads，009 FR-24）：內容繪製完成後捲到該區。
if (location.hash) {
  try {
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  } catch {
    // 不合法的位置：停在頁首。
  }
}
onLocaleChange(() => {
  const focusedId = (document.activeElement as HTMLElement | null)?.id;
  dispose();
  dispose = renderPage(focusedId);
  if (focusedId && focusedId !== 'ui-language' && focusedId !== 'page-theme') document.getElementById(focusedId)?.focus();
});
