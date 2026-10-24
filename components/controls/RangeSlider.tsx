import { useRef } from 'preact/hooks';
import { moveThumb, nearestThumb, percentOf, valueForKey, valueFromPosition, type RangeValue, type Thumb } from './range-math';

export interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: RangeValue;
  /** 拖動或按鍵時呼叫，thumb 為正在移動的把手（0 開始、1 結束）。 */
  onChange: (value: RangeValue, thumb: Thumb) => void;
  /** 放開把手或按鍵完成時呼叫（例如讓播放器跳到該時間點，002 FR-23）。 */
  onCommit?: (value: RangeValue, thumb: Thumb) => void;
  /** 數值的文字表示（例如 01:30），用於 aria-valuetext。 */
  formatValue?: (value: number) => string;
  startLabel: string;
  endLabel: string;
  disabled?: boolean;
}

/** 雙把手區間滑桿：藍色軌道與白色圓形把手（001 表單元件、002 FR-20、003 FR-50）。 */
export function RangeSlider(props: RangeSliderProps) {
  const { min, max, step = 1, value, onChange, onCommit, formatValue = String, startLabel, endLabel, disabled } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<Thumb | null>(null);
  const latest = useRef(value);
  latest.current = value;

  const valueAt = (clientX: number) => {
    // 數值以軌道內的 rail（與把手的移動範圍相同）換算。
    const rail = trackRef.current!.querySelector('.ytm-range-rail') ?? trackRef.current!;
    const rect = rail.getBoundingClientRect();
    return valueFromPosition(clientX, { left: rect.left, width: rect.width }, min, max, step);
  };

  const update = (thumb: Thumb, v: number) => {
    const next = moveThumb(latest.current, thumb, v, min, max, step);
    if (next[0] !== latest.current[0] || next[1] !== latest.current[1]) {
      latest.current = next;
      onChange(next, thumb);
    }
  };

  const onPointerDown = (event: PointerEvent, thumb?: Thumb) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const v = valueAt(event.clientX);
    const which = thumb ?? nearestThumb(latest.current, v);
    dragging.current = which;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    // 焦點移到正在拖動的把手，方便接著用鍵盤微調。
    trackRef.current?.parentElement?.querySelectorAll<HTMLElement>('[role="slider"]')[which]?.focus();
    if (thumb === undefined) update(which, v);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (dragging.current === null) return;
    update(dragging.current, valueAt(event.clientX));
  };

  const onPointerUp = () => {
    if (dragging.current === null) return;
    const thumb = dragging.current;
    dragging.current = null;
    onCommit?.(latest.current, thumb);
  };

  const onKeyDown = (event: KeyboardEvent, thumb: Thumb) => {
    if (disabled) return;
    const v = valueForKey(event.key, latest.current[thumb], min, max, step);
    if (v === null) return;
    event.preventDefault();
    update(thumb, v);
    onCommit?.(latest.current, thumb);
  };

  const startPct = percentOf(value[0], min, max);
  const endPct = percentOf(value[1], min, max);

  const thumbEl = (thumb: Thumb) => {
    const pct = thumb === 0 ? startPct : endPct;
    return (
      <div
        class="ytm-range-thumb"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={thumb === 0 ? startLabel : endLabel}
        aria-valuemin={thumb === 0 ? min : value[0]}
        aria-valuemax={thumb === 0 ? value[1] : max}
        aria-valuenow={value[thumb]}
        aria-valuetext={formatValue(value[thumb])}
        aria-disabled={disabled ? 'true' : undefined}
        style={{ left: `${pct}%`, zIndex: thumb === 0 && startPct > 50 ? 2 : 1 }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e, thumb);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => onKeyDown(e, thumb)}
      />
    );
  };

  return (
    <div class="ytm-range" data-disabled={disabled ? '' : undefined}>
      <div
        ref={trackRef}
        class="ytm-range-track"
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div class="ytm-range-rail">
          <div class="ytm-range-fill" style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }} />
        </div>
      </div>
      {thumbEl(0)}
      {thumbEl(1)}
    </div>
  );
}
