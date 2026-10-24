import { Icon } from '../icons';

export interface SelectOption<V extends string> {
  value: V;
  label: string;
}

export interface SelectProps<V extends string> {
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  id?: string;
  /** 無障礙標籤；畫面上已有 <label for> 時可省略。 */
  label?: string;
  disabled?: boolean;
}

/** 下拉選單：深色背景、細邊框、圓角，右側有向下箭頭（001 表單元件）。使用原生 <select>。 */
export function Select<V extends string>({ value, options, onChange, id, label, disabled }: SelectProps<V>) {
  return (
    <span class="ytm-select">
      <select
        id={id}
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value as V)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span class="ytm-select-arrow" aria-hidden="true">
        <Icon name="arrow_drop_down" />
      </span>
    </span>
  );
}
