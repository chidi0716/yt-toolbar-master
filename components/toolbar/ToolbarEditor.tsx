// 工具列的編輯模式（006 FR-3 至 FR-5、FR-10 至 FR-14、外觀，tasks T33）。
// - 顯示所有工具（隱藏的半透明並有「隱藏」標記）與分隔點；每個工具上方有「眼睛」切換按鈕。
// - 拖曳（Pointer Events 自行實作）：拖曳中只更新插入位置的指示線，放開時才改變暫存的順序。
// - 鍵盤：Tab 聚焦工具或分隔點，←／→ 移動，空白鍵切換顯示／隱藏，Enter 等同「完成」；Esc 由 Toolbar 處理。
// - 右側為「重設為預設」「取消」「完成」；底部一行說明。
// 暫存的設定由 Toolbar 保管，「完成」時才寫入 storage。
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/utils/i18n';
import { dropIndex, moveItem, SEPARATOR, stepItem, toggleVisible, type LayoutItemId, type ToolbarLayout } from '@/utils/toolbar-layout';
import { Button } from '../controls/Button';
import { Icon } from '../icons';
import { TOOLS } from './buttons';

export interface ToolbarEditorProps {
  draft: ToolbarLayout;
  onChange: (layout: ToolbarLayout) => void;
  onDone: () => void;
  onCancel: () => void;
  onReset: () => void;
}

/** 移動超過這個距離（px）才開始拖曳，避免點擊時誤動。 */
const DRAG_THRESHOLD = 4;

interface DragState {
  id: LayoutItemId;
  pointerId: number;
  startX: number;
  dragging: boolean;
  /** moveItem 的插入位置。 */
  to: number | null;
}

export function ToolbarEditor({ draft, onChange, onDone, onCancel, onReset }: ToolbarEditorProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<LayoutItemId, HTMLElement>());
  const handleRefs = useRef(new Map<LayoutItemId, HTMLButtonElement>());
  const drag = useRef<DragState | null>(null);
  const [indicator, setIndicator] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<LayoutItemId | null>(null);
  const focusAfter = useRef<LayoutItemId | null>(null);
  const [announce, setAnnounce] = useState('');

  // 進入編輯模式時聚焦第一個工具；鍵盤移動後焦點留在原本的項目上。
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      handleRefs.current.get(draft.items[0]!.id)?.focus();
      return;
    }
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    handleRefs.current.get(id)?.focus();
  });

  const nameOf = (id: LayoutItemId) => (id === SEPARATOR ? t('editSeparator') : t(TOOLS[id].label));

  const moveBy = (id: LayoutItemId, delta: -1 | 1) => {
    const next = stepItem(draft, id, delta);
    if (next === draft || next.items.every((item, i) => item.id === draft.items[i]!.id)) return;
    focusAfter.current = id;
    onChange(next);
    const index = next.items.findIndex((i) => i.id === id);
    setAnnounce(t('editMoved', [nameOf(id), String(index + 1), String(next.items.length)]));
  };
  const toggle = (id: LayoutItemId) => {
    if (id === SEPARATOR) return;
    const next = toggleVisible(draft, id);
    onChange(next);
    const visible = next.items.find((i) => i.id === id)!.visible;
    setAnnounce(`${nameOf(id)}: ${visible ? t('editShown') : t('editHidden')}`);
  };

  const onKeyDown = (event: KeyboardEvent, id: LayoutItemId) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveBy(id, event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      toggle(id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onDone();
    }
  };

  // ---- 拖曳 ----
  /** 其他項目（不含被拖曳的）的中心點與位置，依順序。 */
  const others = (id: LayoutItemId) =>
    draft.items
      .filter((i) => i.id !== id)
      .map((i) => itemRefs.current.get(i.id)?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r);

  const onPointerDown = (event: PointerEvent, id: LayoutItemId) => {
    if (event.button !== 0 || drag.current) return;
    drag.current = { id, pointerId: event.pointerId, startX: event.clientX, dragging: false, to: null };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const dx = event.clientX - d.startX;
    if (!d.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      d.dragging = true;
      setDraggingId(d.id);
    }
    const el = itemRefs.current.get(d.id);
    if (el) el.style.transform = `translateX(${dx}px)`;
    const rects = others(d.id);
    const to = dropIndex(
      rects.map((r) => r.left + r.width / 2),
      event.clientX,
    );
    d.to = to;
    const row = rowRef.current?.getBoundingClientRect();
    if (!row) return;
    // 指示線：插在第 to 個項目之前（最後面時在最後一個項目之後）。
    const x = to < rects.length ? rects[to]!.left - 2 : rects.length ? rects[rects.length - 1]!.right + 2 : row.left;
    setIndicator(Math.round(x - row.left));
  };
  const endDrag = (event: PointerEvent, commit: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    drag.current = null;
    const el = itemRefs.current.get(d.id);
    if (el) el.style.transform = '';
    setIndicator(null);
    setDraggingId(null);
    if (!commit || !d.dragging || d.to === null) return;
    const from = draft.items.findIndex((i) => i.id === d.id);
    const next = moveItem(draft, from, d.to);
    if (next.items.some((item, i) => item.id !== draft.items[i]!.id)) onChange(next);
    focusAfter.current = d.id;
  };

  const sepIndex = draft.items.findIndex((i) => i.id === SEPARATOR);

  const renderItem = (id: LayoutItemId, index: number) => {
    const visible = draft.items[index]!.visible;
    const handlers = {
      onPointerDown: (e: PointerEvent) => onPointerDown(e, id),
      onPointerMove,
      onPointerUp: (e: PointerEvent) => endDrag(e, true),
      onPointerCancel: (e: PointerEvent) => endDrag(e, false),
      onKeyDown: (e: KeyboardEvent) => onKeyDown(e, id),
      ref: (el: HTMLButtonElement | null) => {
        if (el) handleRefs.current.set(id, el);
        else handleRefs.current.delete(id);
      },
    };
    const itemRef = (el: HTMLElement | null) => {
      if (el) itemRefs.current.set(id, el);
      else itemRefs.current.delete(id);
    };
    if (id === SEPARATOR) {
      return (
        <div key={id} ref={itemRef} class="ytm-edit-item ytm-edit-sep-item" data-item={id} data-dragging={draggingId === id ? '' : undefined}>
          <button
            type="button"
            class="ytm-edit-sep"
            aria-label={t('editSeparator')}
            aria-describedby="ytm-edit-keys"
            title={t('editSeparator')}
            {...handlers}
          >
            <span class="ytm-edit-sep-line" aria-hidden="true" />
          </button>
        </div>
      );
    }
    const def = TOOLS[id];
    const name = t(def.label);
    return (
      <div
        key={id}
        ref={itemRef}
        class="ytm-edit-item"
        data-item={id}
        data-hidden={visible ? undefined : ''}
        data-dragging={draggingId === id ? '' : undefined}
      >
        <button
          type="button"
          class="ytm-edit-eye"
          tabIndex={-1}
          aria-label={visible ? t('editHideTool', name) : t('editShowTool', name)}
          title={visible ? t('editHideTool', name) : t('editShowTool', name)}
          onClick={() => toggle(id)}
        >
          <Icon name={visible ? 'visibility' : 'visibility_off'} size={12} />
        </button>
        <button
          type="button"
          class="ytm-edit-tool"
          aria-label={`${name}, ${visible ? t('editShown') : t('editHidden')}`}
          aria-describedby="ytm-edit-keys"
          title={name}
          {...handlers}
        >
          <Icon name={def.icon} />
          {!visible && (
            <span class="ytm-edit-hidden-mark" aria-hidden="true">
              <Icon name="visibility_off" size={12} />
            </span>
          )}
        </button>
      </div>
    );
  };

  return (
    <>
      <div ref={rowRef} class="ytm-edit-row">
        {draft.items.slice(0, sepIndex + 1).map((item, i) => renderItem(item.id, i))}
        <span class="ytm-edit-spacer" aria-hidden="true" />
        {draft.items.slice(sepIndex + 1).map((item, i) => renderItem(item.id, sepIndex + 1 + i))}
        {indicator !== null && <span class="ytm-edit-indicator" style={{ left: `${indicator}px` }} aria-hidden="true" />}
      </div>
      <div class="ytm-edit-actions">
        <Button variant="secondary" onClick={onReset}>
          <Icon name="restart_alt" size={18} />
          <span>{t('editReset')}</span>
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          <span>{t('editCancel')}</span>
        </Button>
        <Button variant="primary" onClick={onDone}>
          <Icon name="check" size={18} />
          <span>{t('editDone')}</span>
        </Button>
      </div>
      <p class="ytm-edit-help">{t('editHelp')}</p>
      <span id="ytm-edit-keys" class="ytm-visually-hidden">
        {t('editKeys')}
      </span>
      <span class="ytm-visually-hidden" role="status" aria-live="polite">
        {announce}
      </span>
    </>
  );
}
