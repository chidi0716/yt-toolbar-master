import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { updateCheck, updateReminder } from '@/utils/settings';
import { CHECK_INTERVAL_MS, type LatestRelease } from '@/utils/update-check';
import { createUpdateService, type UpdateServiceDeps } from './background';

const RELEASE: LatestRelease = { version: '0.2.0', title: 'v0.2.0', url: 'https://github.com/chidi0716/yt-toolbar-master/releases/tag/v0.2.0' };

describe('背景腳本的新版本查詢（008 FR-26、FR-27、FR-29a）', () => {
  let now: number;
  let badge: string | null;
  let deps: UpdateServiceDeps;
  let fetchRelease: ReturnType<typeof vi.fn<() => Promise<LatestRelease | null>>>;

  const make = (patch: Partial<UpdateServiceDeps> = {}) => createUpdateService({ ...deps, ...patch });

  beforeEach(() => {
    fakeBrowser.reset();
    now = new Date(2026, 9, 23, 12).getTime();
    badge = null;
    fetchRelease = vi.fn(async () => RELEASE);
    deps = {
      installType: async () => 'development',
      currentVersion: () => '0.1.0',
      fetchRelease,
      setBadge: (text) => {
        badge = text;
      },
      now: () => now,
    };
  });

  it('開發模式：查詢後顯示提醒與圖示的 NEW 標記', async () => {
    const view = await make().checkIfDue();
    expect(fetchRelease).toHaveBeenCalledTimes(1);
    expect(view).toMatchObject({ pending: true, showCard: true, latest: RELEASE, lastCheckedAt: now, lastResult: 'ok' });
    expect(badge).toBe('NEW');
  });

  it('不是開發模式（Firefox／Zen 簽署版）：不查詢、不提醒', async () => {
    for (const type of ['normal', null]) {
      const view = await make({ installType: async () => type }).checkIfDue();
      expect(view.eligible).toBe(false);
      expect(view.pending).toBe(false);
    }
    expect(fetchRelease).not.toHaveBeenCalled();
    expect(badge).toBe('');
  });

  it('讀不到安裝類型時視為不需要提醒', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const view = await make({ installType: async () => Promise.reject(new Error('no management')) }).checkIfDue();
    expect(view.eligible).toBe(false);
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it('24 小時內只查詢一次；同時開啟的分頁不會重複查詢', async () => {
    const service = make();
    await Promise.all([service.checkIfDue(), service.checkIfDue(), service.checkIfDue()]);
    now += CHECK_INTERVAL_MS - 1;
    await service.checkIfDue();
    expect(fetchRelease).toHaveBeenCalledTimes(1);
    now += 1;
    await service.checkIfDue();
    expect(fetchRelease).toHaveBeenCalledTimes(2);
  });

  it('查詢失敗：安靜略過，記下時間與結果，24 小時內不再試，保留上次的結果', async () => {
    await make().checkIfDue();
    now += CHECK_INTERVAL_MS;
    fetchRelease.mockResolvedValueOnce(null);
    const view = await make().checkIfDue();
    expect(view).toMatchObject({ lastResult: 'failed', lastCheckedAt: now, latest: RELEASE, pending: true });
    now += 60_000;
    await make().checkIfDue();
    expect(fetchRelease).toHaveBeenCalledTimes(2);
  });

  it('不再提醒：停止查詢、清除標記；重新開啟後恢復', async () => {
    const service = make();
    await service.checkIfDue();
    let view = await service.act('disable', null);
    expect(view).toMatchObject({ disabled: true, pending: false });
    expect(badge).toBe('');
    now += 2 * CHECK_INTERVAL_MS;
    await service.checkIfDue();
    expect(fetchRelease).toHaveBeenCalledTimes(1);
    view = await service.act('enable', null);
    expect(view.pending).toBe(true);
    await service.checkIfDue();
    expect(fetchRelease).toHaveBeenCalledTimes(2);
  });

  it('前往下載：清除標記；跳過這個版本：不再提醒同版本', async () => {
    const service = make();
    await service.checkIfDue();
    expect((await service.act('open', '0.2.0')).pending).toBe(false);
    expect(badge).toBe('');
    await updateReminder.setValue(null);
    expect((await service.status()).pending).toBe(true);
    expect((await service.act('skip', '0.2.0')).pending).toBe(false);
  });

  it('卡片出現過：當天不再以卡片出現，隔天再出現', async () => {
    const service = make();
    await service.checkIfDue();
    await service.act('cardShown', '0.2.0');
    expect((await service.status()).showCard).toBe(false);
    now = new Date(2026, 9, 24, 8).getTime();
    expect((await service.status()).showCard).toBe(true);
  });

  it('更新到最新版本後標記消失（背景腳本啟動時重新設定）', async () => {
    await make().checkIfDue();
    expect(badge).toBe('NEW');
    await make({ currentVersion: () => '0.2.0' }).refreshBadge();
    expect(badge).toBe('');
  });

  it('只寫入本機（local），不同步', async () => {
    await make().checkIfDue();
    expect(await updateCheck.getValue()).toMatchObject({ latest: RELEASE });
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
  });
});
