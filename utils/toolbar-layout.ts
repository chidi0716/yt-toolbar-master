// 自訂工具列的設定模型（006 FR-20、FR-23、FR-24、NFR-2，010 第一節，plan 3.7.3，tasks T32、T62）。純函式。
// 設定只存工具的識別字串、顯示與否與順序；分隔點（左右兩組的分界）也是清單中的一個項目。
// 「更多」與「關閉」是固定工具，不在設定中，永遠在工具列最右邊。
//
// 「更多」面板中的開關（010 FR-1 至 FR-3，DEFAULT_MORE）也是工具，預設隱藏。隱藏時不在「其他工具」，而是照舊在「更多」面板的
// 開關清單中；清單的順序固定，所以隱藏的這類工具一律排在最後面、依 DEFAULT_MORE 的順序（canonical）。

/** 可以自訂的工具（固定的識別字串，不使用顯示名稱）。 */
export const TOOL_IDS = [
  'video',
  'mp3',
  'thumbnail',
  'subtitles',
  'screenshot',
  'link',
  'darkMode',
  'cinema',
  'pip',
  'floating',
  'loop',
  'help',
  'smartPause',
  'autoplay',
  'audioOnly',
  'wheelVolume',
  'hideComments',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const SEPARATOR = 'separator';
export type LayoutItemId = ToolId | typeof SEPARATOR;

export interface LayoutItem {
  id: LayoutItemId;
  /** 分隔點永遠為 true。 */
  visible: boolean;
}

/** 版本 2（010）：加入「更多」中的開關。版本 1 的設定讀取時轉換（normalizeLayout）。 */
export const LAYOUT_VERSION = 2;
const READABLE_VERSIONS: readonly unknown[] = [1, 2];

export interface ToolbarLayout {
  version: typeof LAYOUT_VERSION;
  items: LayoutItem[];
}

/** 預設的左組與右組（006 FR-23）。 */
export const DEFAULT_LEFT: readonly ToolId[] = ['video', 'mp3', 'thumbnail', 'subtitles', 'screenshot', 'link'];
export const DEFAULT_RIGHT: readonly ToolId[] = ['darkMode', 'cinema', 'pip', 'floating', 'loop', 'help'];
/** 「更多」面板中的開關（010 FR-1），依面板中的順序；預設隱藏（FR-3）。 */
export const DEFAULT_MORE: readonly ToolId[] = ['smartPause', 'autoplay', 'audioOnly', 'wheelVolume', 'hideComments'];

export const isToolId = (v: unknown): v is ToolId => typeof v === 'string' && (TOOL_IDS as readonly string[]).includes(v);
export const isMoreTool = (id: LayoutItemId): boolean => DEFAULT_MORE.includes(id as ToolId);
/** 隱藏的「更多」開關：在「更多」面板中操作，不在工具列與「其他工具」。 */
export const isInMore = (item: LayoutItem): boolean => !item.visible && isMoreTool(item.id);

/** 隱藏的「更多」開關排到最後面，依 DEFAULT_MORE 的順序；其他項目的順序不變。 */
function canonical(items: readonly LayoutItem[]): LayoutItem[] {
  const more = new Set(items.filter(isInMore).map((i) => i.id));
  return [...items.filter((i) => !isInMore(i)), ...DEFAULT_MORE.filter((id) => more.has(id)).map((id) => ({ id, visible: false }))];
}

const withItems = (layout: ToolbarLayout, items: readonly LayoutItem[]): ToolbarLayout => ({ ...layout, version: LAYOUT_VERSION, items: canonical(items) });

export function defaultLayout(): ToolbarLayout {
  return {
    version: LAYOUT_VERSION,
    items: [
      ...DEFAULT_LEFT.map((id) => ({ id, visible: true })),
      { id: SEPARATOR, visible: true },
      ...DEFAULT_RIGHT.map((id) => ({ id, visible: true })),
      ...DEFAULT_MORE.map((id) => ({ id, visible: false })),
    ],
  };
}

/**
 * 讀取設定：驗證並與預設清單合併（006 FR-24、NFR-2）。
 * - 不是物件、版本號不認得：使用預設值。版本 1 與 2 的格式相同，版本 1 沒有「更多」中的開關。
 * - 不認得的工具（已移除）與重複的項目忽略；`visible` 不是布林值時使用該工具的預設（「更多」中的開關為隱藏，其他為顯示）。
 * - 沒有分隔點時加在最後面。
 * - 設定中沒有的工具（之後版本新增）加在其預設組的最後面：左組加在分隔點前，右組加在最後，「更多」中的開關以隱藏狀態加入。
 */
export function normalizeLayout(raw: unknown): ToolbarLayout {
  if (!raw || typeof raw !== 'object' || !READABLE_VERSIONS.includes((raw as { version?: unknown }).version)) return defaultLayout();
  const list = (raw as { items?: unknown }).items;
  if (!Array.isArray(list)) return defaultLayout();
  const seen = new Set<string>();
  const items: LayoutItem[] = [];
  for (const entry of list.slice(0, 100)) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    if (id !== SEPARATOR && !isToolId(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const visible = (entry as { visible?: unknown }).visible;
    items.push({ id, visible: id === SEPARATOR || (typeof visible === 'boolean' ? visible : !isMoreTool(id)) });
  }
  if (!seen.has(SEPARATOR)) items.push({ id: SEPARATOR, visible: true });
  for (const id of DEFAULT_LEFT) {
    if (seen.has(id)) continue;
    items.splice(
      items.findIndex((i) => i.id === SEPARATOR),
      0,
      { id, visible: true },
    );
  }
  for (const id of DEFAULT_RIGHT) {
    if (!seen.has(id)) items.push({ id, visible: true });
  }
  for (const id of DEFAULT_MORE) {
    if (!seen.has(id)) items.push({ id, visible: false });
  }
  return { version: LAYOUT_VERSION, items: canonical(items) };
}

export const separatorIndex = (layout: ToolbarLayout) => layout.items.findIndex((i) => i.id === SEPARATOR);

/** 工具列那一列（編輯模式與設定頁的主清單）的項目數：不含在「更多」中的開關，它們一律排在最後面。 */
export const rowLength = (layout: ToolbarLayout) => layout.items.filter((i) => !isInMore(i)).length;

/**
 * 工具列上實際顯示的左組、右組；隱藏的工具（在「其他工具」中使用，依設定的順序）；
 * 以及在「更多」面板中的開關（依 DEFAULT_MORE 的順序）。
 */
export function splitLayout(layout: ToolbarLayout): { left: ToolId[]; right: ToolId[]; hidden: ToolId[]; more: ToolId[] } {
  const sep = separatorIndex(layout);
  const left: ToolId[] = [];
  const right: ToolId[] = [];
  const hidden: ToolId[] = [];
  const more: ToolId[] = [];
  layout.items.forEach((item, index) => {
    if (item.id === SEPARATOR) return;
    if (isInMore(item)) more.push(item.id);
    else if (!item.visible) hidden.push(item.id);
    else if (index < sep) left.push(item.id);
    else right.push(item.id);
  });
  return { left, right, hidden, more };
}

/** 把 from 位置的項目移到 to 位置（to 為移除該項目後的插入位置）。在「更多」中的開關不能用這個移動（見 placeInToolbar）。 */
export function moveItem(layout: ToolbarLayout, from: number, to: number): ToolbarLayout {
  const items = [...layout.items];
  if (from < 0 || from >= items.length) return layout;
  const [item] = items.splice(from, 1);
  const target = Math.max(0, Math.min(items.length, to));
  items.splice(target, 0, item!);
  return withItems(layout, items);
}

/** 把「更多」中的開關（或工具列上的任一項目）放到工具列的 to 位置並顯示（010 FR-1：從「更多」拖到工具列）。 */
export function placeInToolbar(layout: ToolbarLayout, id: LayoutItemId, to: number): ToolbarLayout {
  const from = layout.items.findIndex((i) => i.id === id);
  if (from < 0) return layout;
  const items = layout.items.filter((_, i) => i !== from);
  const rest = items.filter((i) => !isInMore(i)).length;
  items.splice(Math.max(0, Math.min(rest, to)), 0, { id, visible: true });
  return withItems(layout, items);
}

/** 把工具列上的「更多」開關放回「更多」面板（隱藏）。其他工具不變。 */
export function moveToMore(layout: ToolbarLayout, id: LayoutItemId): ToolbarLayout {
  if (!isMoreTool(id)) return layout;
  return withItems(
    layout,
    layout.items.map((i) => (i.id === id ? { ...i, visible: false } : i)),
  );
}

/** 把項目往左（-1）或往右（+1）移一格（鍵盤操作、設定頁的上移／下移）；只在工具列那一列中移動。 */
export function stepItem(layout: ToolbarLayout, id: LayoutItemId, delta: -1 | 1): ToolbarLayout {
  const from = layout.items.findIndex((i) => i.id === id);
  if (from < 0 || isInMore(layout.items[from]!)) return layout;
  const to = from + delta;
  if (to < 0 || to >= rowLength(layout)) return layout;
  return moveItem(layout, from, to);
}

/**
 * 切換工具的顯示／隱藏；分隔點不能隱藏。
 * 「更多」中的開關：顯示時加在工具列那一列的最後面，隱藏時回到「更多」面板。
 */
export function toggleVisible(layout: ToolbarLayout, id: LayoutItemId): ToolbarLayout {
  if (id === SEPARATOR) return layout;
  return withItems(
    layout,
    layout.items.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)),
  );
}

export function sameLayout(a: ToolbarLayout, b: ToolbarLayout): boolean {
  return a.items.length === b.items.length && a.items.every((item, i) => item.id === b.items[i]!.id && item.visible === b.items[i]!.visible);
}

export const isDefaultLayout = (layout: ToolbarLayout) => sameLayout(layout, defaultLayout());

/**
 * 拖曳時的插入位置：pointerX 與其他項目（不含被拖曳的項目）的中點比較。
 * centers 為其他項目中心點的 x 座標（依順序）。回傳 moveItem 的 to。
 */
export function dropIndex(centers: readonly number[], pointerX: number): number {
  let index = 0;
  while (index < centers.length && pointerX > centers[index]!) index++;
  return index;
}
