// 009 FR-10a（tasks T57）：只快取可以下載的狀態；未安裝或缺少元件時每次打開面板都重新偵測。
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { parseStatus } from '@/utils/native-protocol';
import { getStatus } from './host-background';
import { component, createStatusCache, isCacheableStatus, STATUS_TTL_MS } from './host-status';

const tool = (name: string, found: boolean) => ({ name, found, version: found ? '1' : '', path: '', source: '', error: '' });
const raw = (p: { ready: boolean; complete?: boolean; ffmpeg?: boolean; deno?: boolean }) => ({
  hostVersion: '0.1.0',
  ready: p.ready,
  complete: p.complete ?? p.ready,
  components: [tool('helper', true), tool('yt-dlp', true), tool('ffmpeg', p.ffmpeg ?? p.ready), tool('deno', p.deno ?? true)],
  defaultDir: '/Users/me/Downloads',
  namePresets: [{ id: 'title-id' }],
});
const READY = parseStatus(raw({ ready: true }));
const NO_FFMPEG = parseStatus(raw({ ready: false, ffmpeg: false }));
const NO_DENO = parseStatus(raw({ ready: true, complete: false, deno: false }));

describe('isCacheableStatus', () => {
  it('只有可以下載而且元件齊全的結果可以快取', () => {
    expect(isCacheableStatus(READY)).toBe(true);
    expect(isCacheableStatus(NO_FFMPEG)).toBe(false);
    expect(isCacheableStatus(NO_DENO)).toBe(false);
  });
});

describe('createStatusCache', () => {
  it('可以下載的結果保留 60 秒', () => {
    let now = 1000;
    const cache = createStatusCache(() => now);
    cache.put(READY);
    now += STATUS_TTL_MS - 1;
    expect(cache.get()).toBe(READY);
    now += 1;
    expect(cache.get()).toBeNull();
  });

  it('缺少元件的結果不快取，並清除之前的快取', () => {
    const cache = createStatusCache(() => 0);
    cache.put(NO_FFMPEG);
    expect(cache.get()).toBeNull();
    cache.put(READY);
    cache.put(NO_DENO);
    expect(cache.get()).toBeNull();
  });

  it('clear 清除快取', () => {
    const cache = createStatusCache(() => 0);
    cache.put(READY);
    cache.clear();
    expect(cache.get()).toBeNull();
  });
});

describe('getStatus（背景腳本）', () => {
  /** 假的小幫手：每次 status 回傳 replies 的下一個；null 表示找不到小幫手（連線立即中斷）。 */
  let replies: Array<Record<string, unknown> | null>;
  let statusCalls: number;

  beforeEach(() => {
    fakeBrowser.reset();
    statusCalls = 0;
    (fakeBrowser.runtime as unknown as { connectNative: unknown }).connectNative = () => {
      const messageListeners: Array<(m: unknown) => void> = [];
      const disconnectListeners: Array<(p: unknown) => void> = [];
      return {
        postMessage(message: { id: string; cmd: string }) {
          if (message.cmd !== 'status') return;
          statusCalls++;
          const reply = replies.shift() ?? null;
          queueMicrotask(() => {
            if (reply === null) disconnectListeners.forEach((l) => l({}));
            else messageListeners.forEach((l) => l({ id: message.id, ok: true, result: reply }));
          });
        },
        disconnect() {},
        onMessage: { addListener: (fn: (m: unknown) => void) => messageListeners.push(fn) },
        onDisconnect: { addListener: (fn: (p: unknown) => void) => disconnectListeners.push(fn) },
      };
    };
  });
  // 背景腳本的快取是模組層級的：每個測試前以一次失敗的查詢清除。
  beforeEach(async () => {
    replies = [null];
    await getStatus(true).catch(() => {});
    statusCalls = 0;
  });

  it('未安裝 → 安裝後再打開面板：立即重新偵測，不使用「未安裝」的結果', async () => {
    replies = [null, raw({ ready: true })];
    await expect(getStatus(false)).rejects.toMatchObject({ code: 'HOST_UNREACHABLE' });
    expect((await getStatus(false)).ready).toBe(true);
    expect(statusCalls).toBe(2);
  });

  it('缺少 ffmpeg → 補裝後再打開面板：立即可以下載；可以下載的結果才會被重複使用', async () => {
    replies = [raw({ ready: false, ffmpeg: false }), raw({ ready: true })];
    expect((await getStatus(false)).ready).toBe(false);
    expect((await getStatus(false)).ready).toBe(true);
    expect((await getStatus(false)).ready).toBe(true);
    expect(statusCalls).toBe(2);
  });

  it('refresh 時一律重新查詢', async () => {
    replies = [raw({ ready: true }), raw({ ready: true })];
    await getStatus(true);
    await getStatus(true);
    expect(statusCalls).toBe(2);
  });
});

describe('component（status.components 為準）', () => {
  it('小幫手看能否連線；其他元件看 found 與 error；沒有回報或連不上時無法確認', () => {
    const connected = { state: 'connected', status: NO_FFMPEG } as const;
    expect(component({ state: 'unreachable' }, 'helper')).toEqual({ ok: false, version: null, info: null });
    expect(component({ state: 'unreachable' }, 'yt-dlp').ok).toBeNull();
    expect(component(connected, 'helper')).toMatchObject({ ok: true, version: '0.1.0' });
    expect(component(connected, 'yt-dlp')).toMatchObject({ ok: true, version: '1' });
    expect(component(connected, 'ffmpeg')).toMatchObject({ ok: false, version: null });
    const broken = parseStatus({ ready: false, components: [{ name: 'yt-dlp', found: true, version: '1', error: 'UNKNOWN' }] });
    expect(component({ state: 'connected', status: broken }, 'yt-dlp')).toMatchObject({ ok: false, version: '1' });
    expect(component({ state: 'connected', status: broken }, 'deno').ok).toBeNull();
  });
});
