import { useEffect, useState } from 'preact/hooks';
import { formatTime, parseTime } from '@/utils/time';

export interface TimeInputProps {
  /** 目前的秒數（由外部控制，例如與滑桿同步）。 */
  value: number;
  /** 使用者輸入時呼叫；格式不合法時 seconds 為 null，text 為輸入的文字。 */
  onInput: (seconds: number | null, text: string) => void;
  /** 由外部判斷的錯誤（格式、超出長度、開始晚於結束），顯示錯誤樣式。 */
  invalid?: boolean;
  /** 錯誤說明元素的 id（aria-describedby）。 */
  errorId?: string;
  id?: string;
  label?: string;
  disabled?: boolean;
}

/** 時:分:秒 輸入框（002 FR-20）。外部值改變時更新文字；失去焦點時把合法的輸入整理成標準格式。 */
export function TimeInput({ value, onInput, invalid, errorId, id, label, disabled }: TimeInputProps) {
  const [text, setText] = useState(() => formatTime(value, true));
  const [focused, setFocused] = useState(false);

  // 外部（例如滑桿）改變數值時同步文字；正在輸入且文字代表同一個秒數時不打斷使用者。
  useEffect(() => {
    if (focused && parseTime(text) === value) return;
    setText(formatTime(value, true));
  }, [value]);

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellcheck={false}
      class="ytm-input ytm-time-input"
      aria-label={label}
      aria-invalid={invalid ? 'true' : undefined}
      aria-describedby={invalid ? errorId : undefined}
      placeholder="00:00:00"
      disabled={disabled}
      value={text}
      onFocus={() => setFocused(true)}
      onInput={(e) => {
        const next = (e.currentTarget as HTMLInputElement).value;
        setText(next);
        onInput(parseTime(next), next);
      }}
      onBlur={() => {
        setFocused(false);
        const seconds = parseTime(text);
        if (seconds !== null) setText(formatTime(seconds, true));
      }}
    />
  );
}
