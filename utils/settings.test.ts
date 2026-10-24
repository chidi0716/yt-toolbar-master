import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { downloadDir, enabled, mp3Bitrate, readSettings, watchSettings } from './settings';

describe('settings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('enabled 預設為 true', async () => {
    expect(await enabled.getValue()).toBe(true);
  });

  it('enabled 會記住設定的值', async () => {
    await enabled.setValue(false);
    expect(await enabled.getValue()).toBe(false);
  });
});

describe('readSettings／watchSettings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('一次讀取多個設定，沒有存過的用預設值', async () => {
    await mp3Bitrate.setValue(320);
    expect(await readSettings([enabled, mp3Bitrate, downloadDir] as const)).toEqual([true, 320, null]);
  });

  it('讀到時與之後每次改變時以全部的目前值通知；釋放後不再通知', async () => {
    const calls: unknown[][] = [];
    const release = watchSettings([enabled, mp3Bitrate] as const, (values) => calls.push(values));
    await new Promise((r) => setTimeout(r, 0));
    await mp3Bitrate.setValue(64);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await enabled.setValue(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([
      [true, 192],
      [true, 64],
    ]);
  });
});
