import { describe, expect, it, vi } from 'vitest';
import { createStore, derive } from './store';

describe('createStore', () => {
  it('值改變時通知所有監聽者，相同的值不通知', () => {
    const store = createStore(1);
    const a = vi.fn();
    const off = store.subscribe(a);
    store.set(2);
    store.set((v) => v + 1);
    store.set(3);
    expect(store.get()).toBe(3);
    expect(a).toHaveBeenCalledTimes(2);
    off();
    store.set(4);
    expect(a).toHaveBeenCalledTimes(2);
  });
});

describe('derive', () => {
  it('結果淺層相同時回傳同一個物件（訂閱的按鈕不重新繪製）', () => {
    const jobs = createStore<number[]>([10]);
    const other = createStore('a');
    const progress = derive([jobs, other], (list, o) => ({ progress: list[0] ?? null, tooltip: o }));
    const first = progress.get();
    expect(first).toEqual({ progress: 10, tooltip: 'a' });
    jobs.set([10]);
    expect(progress.get()).toBe(first);
    jobs.set([20]);
    expect(progress.get()).toEqual({ progress: 20, tooltip: 'a' });
    const listener = vi.fn();
    const off = progress.subscribe(listener);
    other.set('b');
    jobs.set([30]);
    off();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
