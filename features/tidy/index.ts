// 頁面整理（005）與 CSS 開關機制（plan 3.7.2）的總控制。由 document_start 的內容腳本啟動，
// 在 YouTube 所有頁面作用（005 FR-5），不受工具列是否顯示影響（005 FR-6）。
//
// - 只靠樣式的選項：依設定在 <html> 加上 class（classes.ts、styles.ts）。
// - 需要程式的選項：設定開啟時才啟動，關閉時停止並移除所有監聽（005 NFR-2）。
// - 設定改變時立即生效，不需要重新整理（005 FR-3）。
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { enabled, hideComments } from '@/utils/settings';
import { applyPageClasses, pageClasses, PAGE_CLASS_TOGGLES, type ClassSource } from './classes';
import { TIDY_OPTIONS, type TidyOptionId } from './options';
import { ensureTidyStyles } from './styles';

const LOG_PREFIX = '[yt-toolbar-master]';

/** 需要程式的選項（005 NFR-2）。 */
export interface TidyScriptFeature {
  start(): void;
  stop(): void;
}

export function startPageTidy(ctx: ContentScriptContext, scripts: Partial<Record<TidyOptionId, TidyScriptFeature>> = {}): void {
  ensureTidyStyles();

  const values: Partial<Record<ClassSource, boolean>> = {};
  let toolbarEnabled = true;
  const running = new Set<TidyOptionId>();

  const sync = () => {
    applyPageClasses(document.documentElement, pageClasses(values, toolbarEnabled));
    for (const [id, feature] of Object.entries(scripts) as [TidyOptionId, TidyScriptFeature][]) {
      const on = values[id] === true;
      if (on === running.has(id)) continue;
      try {
        if (on) {
          running.add(id);
          feature.start();
        } else {
          running.delete(id);
          feature.stop();
        }
      } catch (err) {
        // 單一選項失效不得影響 YouTube（005 FR-7）。
        console.info(`${LOG_PREFIX} page tidy option ${id} failed`, err);
      }
    }
  };

  const items: Array<[ClassSource, (typeof TIDY_OPTIONS)[number]['item']]> = [
    ...TIDY_OPTIONS.map((o) => [o.id, o.item] as [ClassSource, typeof o.item]),
    ['hideComments', hideComments],
  ];
  // 只有 CSS 開關或程式選項用得到的設定才需要讀取。
  const used = new Set<ClassSource>([...PAGE_CLASS_TOGGLES.map((t) => t.source), ...(Object.keys(scripts) as TidyOptionId[])]);

  for (const [source, item] of items) {
    if (!used.has(source)) continue;
    ctx.onInvalidated(
      item.watch((value) => {
        values[source] = value === true;
        sync();
      }),
    );
  }
  ctx.onInvalidated(
    enabled.watch((value) => {
      toolbarEnabled = value !== false;
      sync();
    }),
  );
  ctx.onInvalidated(() => {
    for (const id of running) scripts[id]?.stop();
    running.clear();
    applyPageClasses(document.documentElement, []);
  });

  void Promise.all([
    enabled.getValue().then((value) => {
      toolbarEnabled = value !== false;
    }),
    ...items
      .filter(([source]) => used.has(source))
      .map(([source, item]) =>
        item.getValue().then((value) => {
          values[source] = value === true;
        }),
      ),
  ]).then(sync, (err: unknown) => console.info(`${LOG_PREFIX} page tidy: failed to read settings`, err));
}
