// 觀看輔助功能共用的小型狀態容器：功能模組改變狀態時通知工具列重新繪製。

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 只讀的 store（元件以 useStore 訂閱）。 */
export type ReadStore<T> = Pick<Store<T>, 'get' | 'subscribe'>;

const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

/**
 * 由幾個 store 算出的值。來源沒變時不重新計算；算出的結果與上次淺層相同時回傳同一個物件，
 * 訂閱的元件因此只在結果真的改變時重新繪製。
 */
export function derive<const S extends readonly ReadStore<unknown>[], T>(
  sources: S,
  fn: (...values: { [K in keyof S]: S[K] extends ReadStore<infer V> ? V : never }) => T,
): ReadStore<T> {
  let inputs: unknown[] | null = null;
  let output: T;
  return {
    get() {
      const next = sources.map((s) => s.get());
      if (inputs && next.every((v, i) => Object.is(v, inputs![i]))) return output;
      const value = (fn as (...values: unknown[]) => T)(...next);
      if (!inputs || !shallowEqual(value, output)) output = value;
      inputs = next;
      return output;
    },
    subscribe(listener) {
      const offs = sources.map((s) => s.subscribe(listener));
      return () => offs.forEach((off) => off());
    },
  };
}

/** 工具列上切換按鈕的狀態（001 FR-9、003 FR-2）。 */
export interface ToggleState {
  active: boolean;
  /** 不能使用時的原因（顯示在提示文字中，例如 003 FR-32）；undefined 表示可以使用。 */
  disabledReason?: string;
  /** 短暫顯示在按鈕提示中的訊息（例如 003 FR-15 無法切換時）；undefined 表示沒有。 */
  notice?: string;
}

/** 每個觀看輔助功能的共同介面。 */
export interface ViewingFeature {
  /** 啟用本功能（工具列啟用、且在支援的網域時）。 */
  start(): void;
  /** 停用本功能，還原對 YouTube 頁面的所有修改。 */
  stop(): void;
  /** YouTube 換頁（含換到另一部影片）時呼叫。 */
  navigate?(): void;
}
