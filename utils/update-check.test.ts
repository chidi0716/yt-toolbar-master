import { describe, expect, it, vi } from 'vitest';
import {
  applyReminderAction,
  CHECK_INTERVAL_MS,
  compareVersions,
  EMPTY_CHECK,
  EMPTY_REMINDER,
  fetchLatestRelease,
  isNewer,
  isReleaseUrl,
  isReminderEligible,
  LATEST_RELEASE_API,
  localDayKey,
  normalizeCheckState,
  normalizeReminderState,
  normalizeVersion,
  parseRelease,
  reminderView,
  shouldCheck,
  type UpdateCheckState,
  type UpdateReminderState,
} from './update-check';

const URL_020 = 'https://github.com/chidi0716/yt-toolbar-master/releases/tag/v0.2.0';
const release = (version = '0.2.0') => ({ version, title: `v${version} title`, url: `https://github.com/chidi0716/yt-toolbar-master/releases/tag/v${version}` });
/** 本機時間（測試在任何時區都以本機的日期判斷「隔天」）。 */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

describe('版本比較（plan 3.9）', () => {
  it('依數字比較，不是字串比較：0.10.0 > 0.9.0', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.10', '0.1.9')).toBe(true);
  });

  it('開頭的 v 與缺少的部分', () => {
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('0.2', '0.2.0')).toBe(0);
    expect(compareVersions('0.2.1', '0.2')).toBe(1);
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeVersion(' V1.2 ')).toBe('1.2');
  });

  it('格式不對（預先發行、文字、空白）時無法比較，也不算比較新', () => {
    for (const bad of ['0.2.0-beta.1', 'latest', '', '1..2', '1.2.3.4.5', '-1.0', null, 3]) {
      expect(normalizeVersion(bad), String(bad)).toBeNull();
      expect(compareVersions(bad, '0.1.0'), String(bad)).toBeNull();
      expect(isNewer(bad, '0.1.0'), String(bad)).toBe(false);
    }
  });
});

describe('版本頁面網址檢查', () => {
  it('只接受本專案 GitHub 的版本頁面', () => {
    expect(isReleaseUrl(URL_020)).toBe(true);
    expect(isReleaseUrl('https://github.com/chidi0716/yt-toolbar-master/releases/latest')).toBe(true);
  });

  it('其他網址一律拒絕', () => {
    for (const bad of [
      'http://github.com/chidi0716/yt-toolbar-master/releases/tag/v0.2.0',
      'https://github.com/someone/yt-toolbar-master/releases/tag/v0.2.0',
      'https://github.com/chidi0716/yt-toolbar-master/issues/1',
      'https://github.com/chidi0716/yt-toolbar-master/releases',
      'https://github.com.evil.example/chidi0716/yt-toolbar-master/releases/tag/v1',
      'https://github.com/chidi0716/yt-toolbar-master/releases/../../evil/x',
      'https://user@github.com/chidi0716/yt-toolbar-master/releases/tag/v1',
      'javascript:alert(1)//https://github.com/chidi0716/yt-toolbar-master/releases/',
      `https://github.com/chidi0716/yt-toolbar-master/releases/${'x'.repeat(400)}`,
      undefined,
      42,
    ]) {
      expect(isReleaseUrl(bad), String(bad)).toBe(false);
    }
  });
});

describe('GitHub 回應的整理', () => {
  it('只取 tag_name（去掉 v）、name、html_url', () => {
    expect(parseRelease({ tag_name: 'v0.2.0', name: 'Version 0.2.0', html_url: URL_020, body: 'ignored', assets: [] })).toEqual({
      version: '0.2.0',
      title: 'Version 0.2.0',
      url: URL_020,
    });
  });

  it('標題整理成一行，過長時截斷；沒有標題時用版本號', () => {
    expect(parseRelease({ tag_name: 'v0.2.0', name: '  Line 1\nLine\t2  ', html_url: URL_020 })?.title).toBe('Line 1 Line 2');
    expect(parseRelease({ tag_name: 'v0.2.0', name: 'x'.repeat(500), html_url: URL_020 })?.title).toHaveLength(120);
    expect(parseRelease({ tag_name: 'v0.2.0', name: null, html_url: URL_020 })?.title).toBe('v0.2.0');
  });

  it('網址不合格、版本號不合格、預先發行或草稿時丟棄', () => {
    expect(parseRelease({ tag_name: 'v0.2.0', name: 'x', html_url: 'https://evil.example/' })).toBeNull();
    expect(parseRelease({ tag_name: 'v0.2.0-beta.1', name: 'x', html_url: URL_020 })).toBeNull();
    expect(parseRelease({ tag_name: 'v0.2.0', name: 'x', html_url: URL_020, prerelease: true })).toBeNull();
    expect(parseRelease({ tag_name: 'v0.2.0', name: 'x', html_url: URL_020, draft: true })).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease([])).toBeNull();
  });

  it('storage 中被竄改或舊格式的值補上預設值', () => {
    expect(normalizeCheckState(undefined)).toEqual(EMPTY_CHECK);
    expect(normalizeCheckState({ lastCheckedAt: 'x', latest: { version: '0.2.0', url: 'https://evil.example/' } })).toEqual(EMPTY_CHECK);
    expect(normalizeCheckState({ lastCheckedAt: 5, latest: release(), lastResult: 'ok' })).toEqual({ lastCheckedAt: 5, latest: release(), lastResult: 'ok' });
    expect(normalizeReminderState('x')).toEqual(EMPTY_REMINDER);
    expect(normalizeReminderState({ dismissedVersion: 'v0.2.0', disabled: 'yes', lastCardShownAt: { version: '0.2.0', at: 7 } })).toEqual({
      dismissedVersion: '0.2.0',
      disabled: false,
      lastCardShownAt: { version: '0.2.0', at: 7 },
    });
    expect(normalizeReminderState({ dismissedVersion: 'bad' }).dismissedVersion).toBeNull();
  });
});

describe('是否查詢（FR-26、FR-27）', () => {
  const base = { eligible: true, reminder: EMPTY_REMINDER, check: EMPTY_CHECK, now: at(23, 12) };

  it('只有開發模式的安裝（Chrome 未封裝、Firefox 臨時附加元件）才查詢', () => {
    expect(isReminderEligible('development')).toBe(true);
    for (const type of ['normal', 'sideload', 'admin', 'other', undefined, null]) expect(isReminderEligible(type)).toBe(false);
    expect(shouldCheck({ ...base, eligible: false })).toBe(false);
  });

  it('從未查詢過時查詢；24 小時內不再查詢；超過 24 小時再查詢', () => {
    expect(shouldCheck(base)).toBe(true);
    const checked = (lastCheckedAt: number): UpdateCheckState => ({ ...EMPTY_CHECK, lastCheckedAt });
    expect(shouldCheck({ ...base, check: checked(base.now - 60_000) })).toBe(false);
    expect(shouldCheck({ ...base, check: checked(base.now - CHECK_INTERVAL_MS + 1) })).toBe(false);
    expect(shouldCheck({ ...base, check: checked(base.now - CHECK_INTERVAL_MS) })).toBe(true);
  });

  it('時鐘倒退（上次查詢時間在未來）時重新查詢，不會永遠不查', () => {
    expect(shouldCheck({ ...base, check: { ...EMPTY_CHECK, lastCheckedAt: base.now + 60_000 } })).toBe(true);
  });

  it('選了「不再提醒」後完全停止查詢', () => {
    expect(shouldCheck({ ...base, reminder: { ...EMPTY_REMINDER, disabled: true } })).toBe(false);
  });
});

describe('是否提醒、是否以卡片出現（FR-28、FR-29、FR-29a）', () => {
  const check: UpdateCheckState = { lastCheckedAt: at(23, 9), latest: release('0.2.0'), lastResult: 'ok' };
  const view = (reminder: Partial<UpdateReminderState> = {}, now = at(23, 12), currentVersion = '0.1.0', eligible = true) =>
    reminderView({ currentVersion, eligible, check, reminder: { ...EMPTY_REMINDER, ...reminder }, now });

  it('有比目前版本新的版本：提醒，今天第一次以卡片出現', () => {
    expect(view()).toMatchObject({ pending: true, showCard: true, latest: release('0.2.0'), currentVersion: '0.1.0' });
  });

  it('已經是最新版本（或更新）時不提醒（更新後圖示標記消失）', () => {
    expect(view({}, at(23, 12), '0.2.0')).toMatchObject({ pending: false, showCard: false });
    expect(view({}, at(23, 12), '0.3.0')).toMatchObject({ pending: false, showCard: false });
  });

  it('不是開發模式的安裝不提醒', () => {
    expect(view({}, at(23, 12), '0.1.0', false).pending).toBe(false);
  });

  it('同一個版本每天最多以卡片出現一次；只按 ✕ 或自動收合時隔天再出現一次', () => {
    const shown = { lastCardShownAt: { version: '0.2.0', at: at(23, 10) } };
    expect(view(shown, at(23, 23, 59))).toMatchObject({ pending: true, showCard: false });
    expect(view(shown, at(24, 0, 1))).toMatchObject({ pending: true, showCard: true });
    expect(localDayKey(at(23, 23, 59))).not.toBe(localDayKey(at(24, 0, 1)));
  });

  it('出現過的是舊版本時，新的版本當天也可以出現卡片', () => {
    expect(view({ lastCardShownAt: { version: '0.1.5', at: at(23, 10) } }).showCard).toBe(true);
  });

  it('跳過這個版本：同版本不再提醒，更新的版本出現時再提醒', () => {
    expect(view({ dismissedVersion: '0.2.0' })).toMatchObject({ pending: false, showCard: false });
    const newer = reminderView({
      currentVersion: '0.1.0',
      eligible: true,
      check: { ...check, latest: release('0.2.1') },
      reminder: { ...EMPTY_REMINDER, dismissedVersion: '0.2.0' },
      now: at(23, 12),
    });
    expect(newer).toMatchObject({ pending: true, showCard: true });
  });

  it('前往下載後（已處理）這個版本不再提醒；更新的版本出現時再提醒', () => {
    expect(view({ dismissedVersion: '0.2.0' }).pending).toBe(false);
    expect(
      reminderView({ currentVersion: '0.1.0', eligible: true, check: { ...check, latest: release('0.3.0') }, reminder: { ...EMPTY_REMINDER, dismissedVersion: '0.2.0' }, now: at(23, 12) }).pending,
    ).toBe(true);
  });

  it('不再提醒：不提醒', () => {
    expect(view({ disabled: true })).toMatchObject({ pending: false, showCard: false, disabled: true });
  });

  it('沒有查詢結果時不提醒', () => {
    expect(reminderView({ currentVersion: '0.1.0', eligible: true, check: EMPTY_CHECK, reminder: EMPTY_REMINDER, now: 0 }).pending).toBe(false);
  });

  it('操作的結果', () => {
    const now = at(23, 12);
    expect(applyReminderAction(EMPTY_REMINDER, 'open', '0.2.0', now).dismissedVersion).toBe('0.2.0');
    expect(applyReminderAction(EMPTY_REMINDER, 'skip', '0.2.0', now).dismissedVersion).toBe('0.2.0');
    // 已處理過更新的版本時不往回改。
    expect(applyReminderAction({ ...EMPTY_REMINDER, dismissedVersion: '0.3.0' }, 'open', '0.2.0', now).dismissedVersion).toBe('0.3.0');
    expect(applyReminderAction(EMPTY_REMINDER, 'disable', null, now).disabled).toBe(true);
    expect(applyReminderAction({ ...EMPTY_REMINDER, disabled: true }, 'enable', null, now).disabled).toBe(false);
    expect(applyReminderAction(EMPTY_REMINDER, 'cardShown', '0.2.0', now).lastCardShownAt).toEqual({ version: '0.2.0', at: now });
    expect(applyReminderAction(EMPTY_REMINDER, 'skip', null, now)).toEqual(EMPTY_REMINDER);
  });
});

describe('查詢（plan 3.9）', () => {
  it('只查詢本專案的最新正式版本，不帶 cookie、referrer 或自訂標頭', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v0.2.0', name: 'v0.2.0', html_url: URL_020 }), { status: 200 }));
    expect(await fetchLatestRelease(fetchFn as unknown as typeof fetch)).toEqual({ version: '0.2.0', title: 'v0.2.0', url: URL_020 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LATEST_RELEASE_API);
    expect(LATEST_RELEASE_API).toBe('https://api.github.com/repos/chidi0716/yt-toolbar-master/releases/latest');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.headers).toBeUndefined();
    expect(init.method).toBe('GET');
  });

  it('HTTP 錯誤、網路錯誤、格式不對時安靜地回傳 null', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await fetchLatestRelease((async () => new Response('', { status: 403 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLatestRelease((async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLatestRelease((async () => new Response('not json', { status: 200 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLatestRelease((async () => new Response('{"tag_name":"v1"}', { status: 200 })) as unknown as typeof fetch)).toBeNull();
    info.mockRestore();
  });
});
