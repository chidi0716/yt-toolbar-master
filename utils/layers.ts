// 可以用 Esc（以及點外面）關閉的層：劇院模式、展開的面板、編輯工具列（001 FR-12、003 FR-21、006 FR-4）。
// Esc 只關閉最上面的一層：工具列的面板與編輯模式在劇院模式之上，同一層級時後開的在上面；
// 點外面也只交給最上面的一層。只在有層開著時監聽（001 NFR-3）。工具列內的按鍵在 Shadow DOM 邊界被停止冒泡，
// 所以在 window 的捕獲階段監聽。

export const LAYER_LEVEL = { cinema: 0, toolbar: 1 } as const;

export interface Layer {
  level: number;
  onEscape(event: KeyboardEvent): void;
  /** 點這一層以外的地方時收起；inside 以 composedPath 判斷是否點在這一層。 */
  outside?: { inside(path: EventTarget[]): boolean; close(): void };
}

const layers: Layer[] = [];
/** 最近一次按下滑鼠時最上面的一層（在收起之前記下）。 */
let pointerTop: Layer | null = null;

const top = (): Layer | null => layers.reduce<Layer | null>((best, layer) => (!best || layer.level >= best.level ? layer : best), null);

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') top()?.onEscape(event);
}

function onPointerDown(event: PointerEvent) {
  const layer = top();
  pointerTop = layer;
  if (layer?.outside && !layer.outside.inside(event.composedPath())) layer.outside.close();
}

/**
 * 這次按下滑鼠時，這一層是不是最上面的一層（一次點擊只處理最上面的一層）。在 window 捕獲階段的 pointerdown
 * 之後呼叫：這裡的監聽在有層開著時最先加上，所以比之後才加上的監聽先執行。
 */
export const wasTopAtPointerDown = (layer: Layer): boolean => pointerTop === layer;

/** 開啟一層；回傳關閉時呼叫的函式（重複呼叫沒有作用）。 */
export function pushLayer(layer: Layer): () => void {
  layers.push(layer);
  if (layers.length === 1) {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
  }
  return () => {
    const index = layers.indexOf(layer);
    if (index === -1) return;
    layers.splice(index, 1);
    if (layers.length === 0) {
      pointerTop = null;
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    }
  };
}
