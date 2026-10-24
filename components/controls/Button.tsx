import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'class' | 'className' | 'type'> {
  /** 主要按鈕：藍色背景、白字；次要按鈕：透明背景、細邊框（001 表單元件）。 */
  variant?: 'primary' | 'secondary';
  children: ComponentChildren;
}

export function Button({ variant = 'secondary', children, ...rest }: ButtonProps) {
  return (
    <button type="button" class={`ytm-button ytm-button-${variant}`} {...rest}>
      {children}
    </button>
  );
}
