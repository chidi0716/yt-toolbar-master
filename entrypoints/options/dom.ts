// 設定頁共用的 DOM 輔助：元素、分組、開關列、下拉選單列、狀態列與日期時間。設定頁的各區以 DOM API 建立
// （連線狀態區除外，見 connection.tsx）。
import { currentLocaleTag, t, type MessageKey } from '@/utils/i18n';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

/** 一個分組（fieldset，title 為 null 時沒有標題）。 */
export function group(id: string, title: MessageKey | null): HTMLFieldSetElement {
  const fieldset = el('fieldset', { className: 'group', dataset: { category: id } });
  if (title) fieldset.append(el('legend', { textContent: t(title) }));
  return fieldset;
}

/** 名稱與一行說明（說明的 id 為 `${id}-desc`）。 */
function optionText(id: string, name: MessageKey, desc: MessageKey | null): HTMLLabelElement {
  const label = el('label', { className: 'option-text', htmlFor: id }, el('span', { className: 'option-name', textContent: t(name) }));
  if (desc) label.append(el('span', { className: 'option-desc', id: `${id}-desc`, textContent: t(desc) }));
  return label;
}

interface BooleanItem {
  getValue(): Promise<boolean>;
  setValue(v: boolean): Promise<void>;
  watch(cb: (v: boolean) => void): () => void;
}

/**
 * 開關一列：名稱、一行說明與開關。讀到設定前先停用，避免在讀取完成前切換造成覆蓋；
 * 其他分頁或其他裝置（同步）改變設定時更新。取消監聽的函式加入 cleanups。
 */
export function switchRow(id: string, name: MessageKey, desc: MessageKey, item: BooleanItem, cleanups: Array<() => void>, option = id): HTMLElement {
  const input = el('input', { type: 'checkbox', id, className: 'switch', disabled: true });
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-describedby', `${id}-desc`);
  void item.getValue().then((v) => {
    input.checked = v !== false;
    input.disabled = false;
  });
  input.addEventListener('change', () => void item.setValue(input.checked));
  cleanups.push(item.watch((v) => (input.checked = v !== false)));
  return el('div', { className: 'option', dataset: { option } }, optionText(id, name, desc), input);
}

/** 下拉選單一列（讀到設定前先停用）。 */
export function selectRow(id: string, name: MessageKey, desc: MessageKey | null, options: Array<{ value: string; label: string; lang?: string }>) {
  const select = el('select', { id, className: 'select', disabled: true });
  select.append(...options.map((o) => el('option', { value: o.value, textContent: o.label, ...(o.lang ? { lang: o.lang } : {}) })));
  if (desc) select.setAttribute('aria-describedby', `${id}-desc`);
  return { row: el('div', { className: 'option', dataset: { option: id } }, optionText(id, name, desc), select), select };
}

/** 狀態一列：名稱與數值（例如「目前版本 0.1.0」）。 */
export function statusRow(label: string, value: string, id: string): HTMLElement {
  return el('div', { className: 'status-row' }, el('span', { textContent: label }), el('span', { className: 'option-desc', id, textContent: value }));
}

export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}
