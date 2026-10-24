// 「會被記住的開關」型功能的共用骨架（003 FR-1）：讀取設定、切換時寫回設定，
// 並在啟用、停用、換頁時呼叫功能本身的處理。
import type { WxtStorageItem } from 'wxt/utils/storage';
import { readSettings } from '@/utils/settings';
import { createStore, type Store, type ToggleState, type ViewingFeature } from './store';

export interface SettingFeatureHooks {
  /** 套用開或關；停用整組功能時會以 false 呼叫，必須還原所有修改。 */
  apply(on: boolean): void;
  /** 換頁時呼叫（只在整組功能啟用時）。 */
  navigate?(on: boolean): void;
}

export interface SettingFeature extends ViewingFeature {
  state: Store<ToggleState>;
  toggle(): void;
}

export function createSettingFeature(item: WxtStorageItem<boolean, Record<string, unknown>>, hooks: SettingFeatureHooks): SettingFeature {
  const state = createStore<ToggleState>({ active: false });
  let running = false;
  let on = false;

  const set = (value: boolean) => {
    on = value;
    state.set({ active: value });
    if (running) hooks.apply(value);
  };

  return {
    state,
    start() {
      if (running) return;
      running = true;
      void readSettings([item] as const).then(([value]) => {
        if (running) set(value);
      });
    },
    stop() {
      if (!running) return;
      running = false;
      hooks.apply(false);
    },
    navigate() {
      if (running) hooks.navigate?.(on);
    },
    toggle() {
      const next = !on;
      void item.setValue(next);
      set(next);
    },
  };
}
