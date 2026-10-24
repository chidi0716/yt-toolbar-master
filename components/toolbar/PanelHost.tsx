// 展開中面板的定位、焦點與「點外面／Esc 收起」（001 FR-10 至 FR-13、FR-19，plan 3.6）。
import { createContext, type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { LAYER_LEVEL, pushLayer } from '@/utils/layers';
import { Panel } from './Panel';
import { maxPanelWidth, placePanel, type HorizontalRange } from './position';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 面板內容可以使用的釘選操作（例如 MP3 面板底部的「釘選面板」按鈕，002 FR-20、FR-24）。 */
export const PanelPinContext = createContext<{ pinned: boolean; pin: () => void; unpin: () => void } | null>(null);

export interface PanelHostProps {
  panelId: string;
  title: string;
  pinned: boolean;
  /** 工具列根元素：面板以它為定位基準（position: relative）。 */
  container: HTMLElement;
  /** 展開這個面板的按鈕。 */
  button: HTMLElement;
  /** Shadow DOM 的宿主元素：用來判斷點擊是否在工具列或面板內。 */
  host: HTMLElement;
  /** 播放器左右緣（視窗座標）；找不到播放器時用工具列本身。 */
  getBounds: () => HorizontalRange | null;
  onPin: () => void;
  onUnpin: () => void;
  onEscape: () => void;
  onOutside: () => void;
  children: ComponentChildren;
}

export function PanelHost(props: PanelHostProps) {
  const { panelId, title, pinned, container, button, host, getBounds, onPin, onUnpin, onEscape, onOutside } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ left: number; maxWidth: number } | null>(null);

  // 定位：先套用最大寬度，量出面板寬度後計算左緣（FR-11）。
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const bounds = getBounds() ?? { left: containerRect.left, right: containerRect.right };
      const maxWidth = maxPanelWidth(bounds);
      panel.style.maxWidth = `${maxWidth}px`;
      const buttonRect = button.getBoundingClientRect();
      const { left } = placePanel({
        button: { left: buttonRect.left, right: buttonRect.right },
        panelWidth: Math.min(panel.offsetWidth, maxWidth),
        bounds,
      });
      const next = { left: Math.round(left - containerRect.left), maxWidth };
      setLayout((prev) => (prev && prev.left === next.left && prev.maxWidth === next.maxWidth ? prev : next));
    };
    measure();
    // 面板內容或視窗尺寸改變時重新定位；只在面板展開期間監聽（NFR-3）。
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(panel);
    resizeObserver.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [panelId, container, button, getBounds]);

  // 展開時焦點移到面板內第一個可操作的元素（FR-19）。
  const positioned = layout !== null;
  useEffect(() => {
    if (!positioned) return;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [panelId, positioned]);

  // 點面板與工具列以外的地方、按 Esc 收起；釘選時不收起（FR-12、FR-13）。
  useEffect(() => {
    if (pinned) return;
    return pushLayer({ level: LAYER_LEVEL.toolbar, onEscape, outside: { inside: (path) => path.includes(host), close: onOutside } });
  }, [pinned, host, onOutside, onEscape]);

  return (
    <Panel
      id={panelId}
      title={title}
      pinned={pinned}
      onPin={onPin}
      onUnpin={onUnpin}
      panelRef={panelRef}
      left={layout?.left ?? null}
      maxWidth={layout?.maxWidth ?? null}
    >
      <PanelPinContext.Provider value={{ pinned, pin: onPin, unpin: onUnpin }}>{props.children}</PanelPinContext.Provider>
    </Panel>
  );
}
