import type { ComponentChildren, Ref } from 'preact';
import { t } from '@/utils/i18n';
import { Icon } from '../icons';

export interface PanelProps {
  id: string;
  title: string;
  pinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  panelRef: Ref<HTMLDivElement>;
  /** 由 PanelHost 計算出的位置；null 表示還沒量好尺寸，先隱藏。 */
  left: number | null;
  maxWidth: number | null;
  children: ComponentChildren;
}

/** 面板外框：標題、釘選按鈕與內容（001 面板外觀）。 */
export function Panel({ id, title, pinned, onPin, onUnpin, panelRef, left, maxWidth, children }: PanelProps) {
  const titleId = `${id}-title`;
  const pinLabel = pinned ? t('panelUnpin') : t('panelPin');
  return (
    <div
      ref={panelRef}
      id={id}
      class="ytm-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-pinned={pinned ? '' : undefined}
      style={{
        left: left === null ? 0 : `${left}px`,
        maxWidth: maxWidth === null ? undefined : `${maxWidth}px`,
        visibility: left === null ? 'hidden' : undefined,
      }}
    >
      <div class="ytm-panel-header">
        <h2 id={titleId} class="ytm-panel-title">
          {title}
        </h2>
        <button
          type="button"
          class="ytm-icon-btn"
          aria-pressed={pinned}
          aria-label={pinLabel}
          title={pinLabel}
          onClick={pinned ? onUnpin : onPin}
        >
          <Icon name={pinned ? 'keep_off' : 'keep'} size={20} />
        </button>
      </div>
      <div class="ytm-panel-body">{children}</div>
    </div>
  );
}
