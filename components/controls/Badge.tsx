import type { ComponentChildren } from 'preact';

/** 灰底圓角小方塊、白色粗體小字（例如畫質標籤「4K」「HD」，001 清單列）。 */
export function Badge({ children }: { children: ComponentChildren }) {
  return <span class="ytm-badge">{children}</span>;
}
