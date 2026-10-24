import type { Ref } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../icons';
import type { ButtonDef } from './buttons';

export interface ToolbarButtonProps {
  def: ButtonDef;
  label: string;
  /** 提示文字；平常是按鈕名稱，也可以暫時換成其他訊息（例如「即將推出」）。 */
  tooltip: string;
  /** 面板按鈕：對應的面板是否展開。 */
  expanded?: boolean;
  /** 切換按鈕：目前是否為開啟狀態（FR-9）。面板按鈕：背後的功能正在進行中（003 FR-52）。 */
  pressed?: boolean;
  /** 不能使用時的原因；按鈕仍可聚焦（才能看到提示文字），但點了沒有作用。 */
  disabledReason?: string;
  /** 對應面板元素的 id（面板按鈕）。 */
  controls?: string;
  /** 提示文字是暫時訊息（例如「即將推出」），要立即顯示。 */
  notice?: boolean;
  /** 提示文字對齊按鈕的哪一側，避免超出工具列。 */
  tooltipAlign: 'start' | 'center' | 'end';
  buttonRef: Ref<HTMLButtonElement>;
  onClick: () => void;
  /** 下載進度環（002 FR-3、FR-6b）。 */
  progress?: number | 'indeterminate' | null;
  /** 右上角的小圓點：隱藏的工具有進行中的狀態（006 FR-17，只用於「更多」）。 */
  dot?: boolean;
}

/** 按鈕外圍的圓形進度環：有百分比時畫出比例，沒有時為旋轉的不確定進度。 */
function ProgressRing({ value }: { value: number | 'indeterminate' }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const determinate = value !== 'indeterminate';
  return (
    <svg class="ytm-btn-progress" viewBox="0 0 40 40" aria-hidden="true" data-indeterminate={determinate ? undefined : ''}>
      <circle class="ytm-btn-progress-track" cx="20" cy="20" r={r} />
      <circle
        class="ytm-btn-progress-fill"
        cx="20"
        cy="20"
        r={r}
        stroke-dasharray={c}
        stroke-dashoffset={determinate ? c * (1 - Math.max(0, Math.min(100, value)) / 100) : c * 0.75}
      />
    </svg>
  );
}

export function ToolbarButton(props: ToolbarButtonProps) {
  const { def, label, tooltip, notice, expanded, pressed, disabledReason, controls, tooltipAlign, buttonRef, onClick, progress, dot } = props;
  const isOn = def.kind === 'panel' ? !!expanded || !!pressed : def.kind === 'toggle' ? !!pressed : false;
  // 暫時訊息結束時滑鼠仍在按鈕上：讓訊息留到滑鼠移開為止，避免讀到一半消失（003 FR-15）。
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastNotice = useRef<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  useEffect(() => {
    if (notice) {
      lastNotice.current = tooltip;
      setHeld(null);
      return;
    }
    if (lastNotice.current && wrapRef.current?.matches(':hover')) setHeld(lastNotice.current);
    lastNotice.current = null;
  }, [notice, tooltip]);
  const shownTooltip = held ?? tooltip;
  const showNotice = !!notice || held !== null;
  return (
    <div ref={wrapRef} class="ytm-btn-wrap" data-tooltip-align={tooltipAlign} onMouseLeave={() => setHeld(null)}>
      <button
        ref={buttonRef}
        type="button"
        class="ytm-btn"
        data-button={def.id}
        data-on={isOn ? '' : undefined}
        data-dot={dot ? '' : undefined}
        data-progress={progress === null || progress === undefined ? undefined : String(progress === 'indeterminate' ? 'indeterminate' : Math.round(progress))}
        aria-label={label}
        aria-description={disabledReason}
        aria-disabled={disabledReason ? 'true' : undefined}
        aria-haspopup={def.kind === 'panel' ? 'dialog' : undefined}
        aria-expanded={def.kind === 'panel' ? !!expanded : undefined}
        aria-controls={def.kind === 'panel' && expanded ? controls : undefined}
        aria-pressed={def.kind === 'toggle' ? !!pressed : undefined}
        onClick={onClick}
      >
        <Icon name={def.icon} />
        {progress !== null && progress !== undefined && <ProgressRing value={progress} />}
        {dot && <span class="ytm-btn-dot" aria-hidden="true" />}
      </button>
      {/* 提示文字只是視覺輔助，按鈕本身已有 aria-label。 */}
      <span
        class="ytm-tooltip"
        aria-hidden="true"
        data-notice={showNotice ? '' : undefined}
        data-hidden={expanded && !showNotice ? '' : undefined}
      >
        {shownTooltip}
      </span>
    </div>
  );
}
