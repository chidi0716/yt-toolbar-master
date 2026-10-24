export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 無障礙標籤；畫面上已有文字標籤時改用 labelledBy。 */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  id?: string;
}

/** 膠囊形開關，開啟時為藍色（001 表單元件）。 */
export function Switch({ checked, onChange, label, labelledBy, describedBy, disabled, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      class="ytm-switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span class="ytm-switch-thumb" aria-hidden="true" />
    </button>
  );
}
