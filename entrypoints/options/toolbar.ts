// 設定頁的「工具列」區（006 FR-2、FR-22，tasks T34）：以清單顯示所有工具與分隔點，每列有拖曳把手、圖示、名稱、
// 顯示／隱藏開關、「上移」「下移」；另有「重設為預設」。與編輯模式共用設定模型（utils/toolbar-layout.ts）。
// 變更立即寫入 sync:toolbarLayout；已開啟的 YouTube 分頁監聽設定變更而立即套用（FR-21、FR-22）。
import { createIconElement } from '@/components/icon-data';
import { group } from './dom';
import { TOOLS } from '@/components/toolbar/buttons';
import { t } from '@/utils/i18n';
import { toolbarLayout } from '@/utils/settings';
import {
  defaultLayout,
  dropIndex,
  isDefaultLayout,
  moveItem,
  normalizeLayout,
  SEPARATOR,
  stepItem,
  toggleVisible,
  type LayoutItemId,
  type ToolbarLayout,
} from '@/utils/toolbar-layout';

const DRAG_THRESHOLD = 4;

/** 繪製工具列區；回傳的函式取消監聽（介面語言改變時重新繪製，007 FR-3）。 */
export function renderToolbarSettings(root: HTMLElement): () => void {
  let layout: ToolbarLayout = defaultLayout();
  let loaded = false;
  let dragging = false;

  const fieldset = group('toolbar', 'optionsToolbarTools');
  const list = document.createElement('ol');
  list.className = 'toolbar-list';
  list.id = 'toolbar-list';
  const indicator = document.createElement('div');
  indicator.className = 'toolbar-indicator';
  indicator.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button';
  reset.id = 'toolbar-reset';
  reset.textContent = t('optionsToolbarReset');
  actions.append(reset);
  fieldset.append(list, indicator, actions);
  root.append(fieldset);

  const nameOf = (id: LayoutItemId) => (id === SEPARATOR ? t('optionsToolbarDivider') : t(TOOLS[id].label));

  const save = (next: ToolbarLayout) => {
    layout = next;
    render();
    void toolbarLayout.setValue(next);
  };

  const iconButton = (icon: Parameters<typeof createIconElement>[0], label: string, focusKey: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.dataset.focusKey = focusKey;
    b.append(createIconElement(icon, 20));
    return b;
  };

  function row(id: LayoutItemId, index: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'toolbar-row';
    li.dataset.item = id;
    const visible = layout.items[index]!.visible;
    if (!visible) li.dataset.hidden = '';

    const handle = iconButton('drag_indicator', `${t('optionsToolbarDrag')}: ${nameOf(id)}`, `${id}:drag`);
    handle.classList.add('toolbar-handle');
    handle.addEventListener('pointerdown', (event) => startDrag(event, id, li));
    handle.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        save(stepItem(layout, id, event.key === 'ArrowUp' ? -1 : 1));
        refocus(`${id}:drag`);
      }
    });

    const text = document.createElement('label');
    text.className = 'toolbar-name';
    if (id === SEPARATOR) {
      const line = document.createElement('span');
      line.className = 'toolbar-divider-line';
      line.setAttribute('aria-hidden', 'true');
      text.append(line, document.createTextNode(nameOf(id)));
    } else {
      text.append(createIconElement(TOOLS[id].icon, 22), document.createTextNode(nameOf(id)));
    }

    const up = iconButton('arrow_upward', t('optionsToolbarMoveUp', nameOf(id)), `${id}:up`);
    up.disabled = index === 0;
    up.addEventListener('click', () => {
      save(stepItem(layout, id, -1));
      refocus(index - 1 === 0 ? `${id}:down` : `${id}:up`);
    });
    const down = iconButton('arrow_downward', t('optionsToolbarMoveDown', nameOf(id)), `${id}:down`);
    down.disabled = index === layout.items.length - 1;
    down.addEventListener('click', () => {
      save(stepItem(layout, id, 1));
      refocus(index + 1 === layout.items.length - 1 ? `${id}:up` : `${id}:down`);
    });

    li.append(handle, text);
    if (id !== SEPARATOR) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'switch';
      input.setAttribute('role', 'switch');
      input.id = `toolbar-visible-${id}`;
      input.checked = visible;
      input.dataset.focusKey = `${id}:visible`;
      text.htmlFor = input.id;
      input.addEventListener('change', () => {
        save(toggleVisible(layout, id));
        refocus(`${id}:visible`);
      });
      li.append(input);
    } else {
      li.append(document.createElement('span'));
    }
    li.append(up, down);
    return li;
  }

  function render() {
    list.replaceChildren(...layout.items.map((item, i) => row(item.id, i)));
    reset.disabled = !loaded || isDefaultLayout(layout);
    list.toggleAttribute('aria-busy', !loaded);
  }

  function refocus(key: string) {
    list.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
  }

  // ---- 拖曳（Pointer Events，上下方向） ----
  function startDrag(event: PointerEvent, id: LayoutItemId, li: HTMLLIElement) {
    if (event.button !== 0 || !loaded) return;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    const startY = event.clientY;
    let active = false;
    let to: number | null = null;
    const others = () =>
      [...list.children].filter((el) => el !== li).map((el) => (el as HTMLElement).getBoundingClientRect());
    const move = (e: PointerEvent) => {
      const dy = e.clientY - startY;
      if (!active) {
        if (Math.abs(dy) < DRAG_THRESHOLD) return;
        active = true;
        dragging = true;
        li.dataset.dragging = '';
      }
      li.style.transform = `translateY(${dy}px)`;
      const rects = others();
      to = dropIndex(
        rects.map((r) => r.top + r.height / 2),
        e.clientY,
      );
      const box = fieldset.getBoundingClientRect();
      const y = to < rects.length ? rects[to]!.top : rects.length ? rects[rects.length - 1]!.bottom : box.top;
      indicator.hidden = false;
      indicator.style.top = `${Math.round(y - box.top - 1)}px`;
    };
    const end = (commit: boolean) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      li.style.transform = '';
      delete li.dataset.dragging;
      indicator.hidden = true;
      dragging = false;
      if (commit && active && to !== null) {
        const from = layout.items.findIndex((i) => i.id === id);
        save(moveItem(layout, from, to));
        refocus(`${id}:drag`);
      }
    };
    const up = () => end(true);
    const cancel = () => end(false);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
  }

  reset.addEventListener('click', () => {
    save(defaultLayout());
    reset.focus();
  });

  render();
  void toolbarLayout.getValue().then((value) => {
    layout = normalizeLayout(value);
    loaded = true;
    render();
  });
  // 在 YouTube 上編輯或其他裝置同步時更新（拖曳中不打斷）。
  return toolbarLayout.watch((value) => {
    if (dragging) return;
    const active = document.activeElement as HTMLElement | null;
    const key = active?.dataset.focusKey;
    layout = normalizeLayout(value);
    render();
    if (key) refocus(key);
  });
}
