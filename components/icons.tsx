// 工具列與面板使用的圖示元件。圖示資料（Material Symbols 的 path）在 icon-data.ts。
import { PARSED, type IconName } from './icon-data';

export { createIconElement, parseSymbolSvg, type IconName } from './icon-data';

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const { viewBox, paths } = PARSED[name];
  return (
    <svg
      class="ytm-icon"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
