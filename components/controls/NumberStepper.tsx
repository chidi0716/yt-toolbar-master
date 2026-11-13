// 數字輸入框與兩側的「−」「＋」圓形按鈕（010 FR-30、FR-31）。瀏覽器內建的上下箭頭以樣式隱藏（controls.css）；
// 仍可直接輸入與使用鍵盤上下鍵（原生 type="number" 的行為）。按住按鈕時連續增減，到達最小或最大值時停用。
import { useEffect, useRef } from 'preact/hooks';
import { t } from '@/utils/i18n';
import { Icon } from '../icons';
import { stepperEnabled, stepValue } from './stepper-math';

/** 按住後開始連續增減前的等待時間與之後的間隔（ms）。 */
const HOLD_DELAY = 400;
const HOLD_INTERVAL = 80;

export interface NumberStepperProps {
  id?: string;
  /** 輸入框的文字（由外部保存，可以是不合法的輸入）。 */
  value: string;
  min: number;
  max: number;
  onChange: (text: string) => void;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
}

export function NumberStepper({ id, value, min, max, onChange, label, disabled, invalid }: NumberStepperProps) {
  // 按住期間由計時器連續呼叫，要讀到最新的值。
  const current = useRef(value);
  current.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);

  /** 增減一次；回傳是否還能繼續往同一個方向。 */
  const step = (delta: -1 | 1): boolean => {
    const next = String(stepValue(current.current, delta, min, max));
    if (next !== current.current) {
      current.current = next;
      onChange(next);
    }
    const enabled = stepperEnabled(next, min, max);
    return delta < 0 ? enabled.down : enabled.up;
  };

  const start = (event: PointerEvent, delta: -1 | 1) => {
    if (event.button !== 0 || disabled) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    stop();
    if (!step(delta)) return;
    const repeat = () => {
      timer.current = step(delta) ? setTimeout(repeat, HOLD_INTERVAL) : undefined;
    };
    timer.current = setTimeout(repeat, HOLD_DELAY);
  };

  const enabled = stepperEnabled(value, min, max);
  const stepButton = (delta: -1 | 1) => {
    const name = delta < 0 ? t('stepperDecrease') : t('stepperIncrease');
    return (
      <button
        type="button"
        class="ytm-stepper-btn"
        data-step={delta < 0 ? 'down' : 'up'}
        tabIndex={-1}
        aria-label={`${name}: ${label}`}
        title={name}
        disabled={disabled || !(delta < 0 ? enabled.down : enabled.up)}
        onPointerDown={(e) => start(e, delta)}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        // 滑鼠點擊已在 pointerdown 處理；這裡只處理沒有指標的點擊（例如輔助技術）。
        onClick={(e) => {
          if (e.detail === 0) step(delta);
        }}
      >
        <Icon name={delta < 0 ? 'remove' : 'add'} size={18} />
      </button>
    );
  };

  return (
    <span class="ytm-stepper" data-disabled={disabled ? '' : undefined}>
      {stepButton(-1)}
      <input
        id={id}
        class="ytm-input ytm-number-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        aria-label={label}
        aria-invalid={invalid ? 'true' : undefined}
        disabled={disabled}
        value={value}
        onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
      {stepButton(1)}
    </span>
  );
}
