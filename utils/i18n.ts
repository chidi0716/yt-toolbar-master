// 介面文字（constitution 第 8 點、007，plan 3.7.4）：自己的翻譯層。
// browser.i18n.getMessage 只會依瀏覽器語言回傳、無法在執行中切換，所以兩份語言檔在建置時打包成模組，
// 執行時依設定 sync:uiLanguage（auto／zh_TW／en）選用。public/_locales 仍保留給 manifest 的名稱與說明（007 FR-5）。
// 新增語言時只需要新增語言檔、在 LOCALES 與 UI_LANGUAGES 加一項（007 FR-8）。
import en from '../public/_locales/en/messages.json';
import zhTW from '../public/_locales/zh_TW/messages.json';
import type { UiLanguagePreference } from './settings';

interface MessageEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}
type Messages = Record<string, MessageEntry>;

/** 語言檔中定義的訊息名稱（以英文語言檔為準；兩份語言檔的鍵一致由測試保證，007 NFR-2）。 */
export type MessageKey = keyof typeof en;

export type UiLocale = 'en' | 'zh_TW';

const LOCALES: Record<UiLocale, Messages> = { en, zh_TW: zhTW };

/** 設定頁語言選單的選項（007 FR-1）；名稱以各自的語言顯示。 */
export const UI_LANGUAGES: readonly { value: UiLanguagePreference; label: MessageKey | null; native?: string }[] = [
  { value: 'auto', label: 'optionsLanguageAuto' },
  { value: 'zh_TW', label: null, native: '繁體中文' },
  { value: 'en', label: null, native: 'English' },
];

/** Intl 使用的語言標籤。 */
export const LOCALE_TAGS: Record<UiLocale, string> = { en: 'en', zh_TW: 'zh-TW' };

function browserLanguage(): string {
  try {
    const lang = browser.i18n?.getUILanguage?.();
    if (lang) return lang;
  } catch {
    // 測試環境或不支援時改用 navigator。
  }
  return typeof navigator !== 'undefined' ? navigator.language : 'en';
}

/** 「跟隨瀏覽器」：中文（任何地區）用繁體中文，其他語言用英文（007 FR-2）。 */
export function resolveLocale(pref: unknown, browserLang = browserLanguage()): UiLocale {
  if (pref === 'zh_TW' || pref === 'en') return pref;
  return /^zh\b/i.test(browserLang.replace('_', '-')) ? 'zh_TW' : 'en';
}

let current: UiLocale = resolveLocale('auto');
const listeners = new Set<(locale: UiLocale) => void>();

export const currentLocale = (): UiLocale => current;
export const currentLocaleTag = (): string => LOCALE_TAGS[current];

/** 直接設定語言（測試用，以及讀到設定時）。 */
export function setLocale(locale: UiLocale): void {
  if (locale === current) return;
  current = locale;
  for (const listener of [...listeners]) listener(locale);
}

/** 語言改變時通知；回傳取消訂閱的函式。 */
export function onLocaleChange(listener: (locale: UiLocale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let ready: Promise<void> | null = null;

/** sync:uiLanguage 的 storage 鍵（utils/settings.ts 的 uiLanguage）。 */
const STORAGE_KEY = 'uiLanguage';

/**
 * 讀取 sync:uiLanguage 並監聽變更（每個執行環境呼叫一次；之後的呼叫回傳同一個 Promise）。
 * 直接使用 browser.storage，不在模組載入時定義 storage 項目：頁面橋接腳本（MAIN world）也會間接載入本模組，
 * 那裡沒有擴充功能的 API。
 */
export function initI18n(): Promise<void> {
  ready ??= (async () => {
    try {
      const stored = await browser.storage.sync.get(STORAGE_KEY);
      setLocale(resolveLocale(stored[STORAGE_KEY]));
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && STORAGE_KEY in changes) setLocale(resolveLocale(changes[STORAGE_KEY]!.newValue));
      });
    } catch (err) {
      console.info('[yt-toolbar-master] failed to read the interface language', err);
    }
  })();
  return ready;
}

/** 代換訊息中的 $NAME$ 佔位符（依 placeholders 的 $1、$2…）與 $$。 */
export function formatMessage(entry: MessageEntry, fallback: MessageEntry | undefined, substitutions?: string | string[]): string {
  const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  const placeholders = entry.placeholders ?? fallback?.placeholders ?? {};
  const fill = (content: string) => content.replace(/\$(\d)/g, (_, n: string) => subs[Number(n) - 1] ?? '');
  return entry.message.replace(/\$\$|\$([A-Za-z0-9_@]+)\$/g, (match, name?: string) => {
    if (match === '$$') return '$';
    const p = placeholders[name!.toLowerCase()];
    return p ? fill(p.content) : '';
  });
}

/** 取得目前語言的介面文字；找不到時退回英文，再找不到時回傳名稱本身，避免畫面出現空白。 */
export function t(key: MessageKey, substitutions?: string | string[]): string {
  const entry = LOCALES[current][key] ?? LOCALES.en[key];
  if (!entry) return key;
  return formatMessage(entry, LOCALES.en[key], substitutions);
}

/** 數字（例如檔案大小）依介面語言格式化（007 FR-6）。 */
export function formatNumber(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat(currentLocaleTag(), { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value);
}

/** 把擴充功能頁面（彈出視窗、設定頁）中帶 data-i18n 的元素換成對應的文字。 */
export function applyI18n(root: ParentNode): void {
  if (root instanceof Document) root.documentElement.lang = currentLocaleTag();
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
}
