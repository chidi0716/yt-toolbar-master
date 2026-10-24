// 008（T46）：小幫手通訊協定的新增部分（plan 4.9）——status 的 components、update，新錯誤代碼，
// 自動更新 yt-dlp 的 stage 事件，以及下載面板的「自動更新連續失敗」提示。以假的 status 回應測試，不依賴小幫手的實作。
import { describe, expect, it } from 'vitest';
import { isContentMessage } from '@/utils/messages';
import { HostRequestError, NativeClient, REQUEST_TIMEOUT_MS, type PortLike } from '@/utils/native';
import { parseHostMessage, parseStatus, parseTime, toErrorCode } from '@/utils/native-protocol';
import { showUpdateFailureHint, UPDATE_FAILURE_HINT_AT, type HostState } from './host-status';
import { applyEvent, errorInfo, newJob, type DownloadRequest, type JobRecord } from './jobs';

const VID = 'jNQXAC9IVRw';
/** 依 plan 4.9 的通訊協定表格做出的假 status 回應。 */
const FAKE_STATUS = {
  hostVersion: '0.2.0',
  os: 'darwin',
  ready: true,
  complete: true,
  missing: [],
  ytDlp: { found: true, version: '2026.10.21' },
  ffmpeg: { found: true, version: '7.1' },
  deno: { found: true, version: '2.5.4' },
  defaultDir: '/Users/me/Downloads',
  namePresets: [{ id: 'title-id', example: 'x' }],
  installDir: '/Users/me/Library/Application Support/yt-toolbar-master',
  components: [
    { name: 'ffprobe', version: '7.1', path: '/usr/local/bin/ffprobe', source: 'path' },
    { name: 'helper', version: '0.2.0', path: '/x/ytm-host', source: 'bundled' },
    { name: 'yt-dlp', version: '2026.10.21', path: '/x/bin/yt-dlp', source: 'bundled' },
    { name: 'deno', version: '2.5.4', path: '/opt/homebrew/bin/deno', source: 'homebrew' },
    { name: 'ffmpeg', version: '7.1', path: 'C:\\ffmpeg.exe', source: 'winget' },
    { name: 'rm -rf', version: '1', path: '/', source: 'bundled' },
    { name: 'deno', version: 'dup', path: '/dup', source: 'path' },
  ],
  update: { auto: false, lastCheck: '2026-10-23T05:00:00Z', lastResult: 'updated', consecutiveFailures: 0, running: true },
};

describe('status 的新增欄位（plan 4.9、008 FR-24）', () => {
  it('components：只接受已知的元件名稱與來源，依固定順序，不重複', () => {
    const s = parseStatus(FAKE_STATUS);
    expect(s.installDir).toBe(FAKE_STATUS.installDir);
    expect(s.components?.map((c) => `${c.name}:${c.source}:${c.version}`)).toEqual([
      'helper:bundled:0.2.0',
      'yt-dlp:bundled:2026.10.21',
      'deno:homebrew:2.5.4',
      'ffmpeg:winget:7.1',
      'ffprobe:path:7.1',
    ]);
    expect(parseStatus({ ...FAKE_STATUS, components: [{ name: 'helper', version: 1, path: null, source: 'evil' }] }).components).toEqual([
      { name: 'helper', version: null, path: null, source: null },
    ]);
  });

  it('update：開關、最近一次檢查、結果、連續失敗次數、是否執行中', () => {
    expect(parseStatus(FAKE_STATUS).update).toEqual({ auto: false, lastCheck: Date.parse('2026-10-23T05:00:00Z'), lastResult: 'updated', consecutiveFailures: 0, running: true });
    expect(parseStatus({ ...FAKE_STATUS, update: { consecutiveFailures: -2, lastResult: 'boom' } }).update).toEqual({
      auto: true,
      lastCheck: null,
      lastResult: null,
      consecutiveFailures: 0,
      running: false,
    });
  });

  it('舊版小幫手（沒有這些欄位）：為 null，設定頁顯示「不會自動更新」', () => {
    const s = parseStatus({ hostVersion: '0.1.0', ready: true });
    expect(s).toMatchObject({ installDir: null, components: null, update: null });
  });

  it('時間格式：ISO 字串、毫秒或秒', () => {
    expect(parseTime('2026-10-23T05:00:00Z')).toBe(Date.UTC(2026, 9, 23, 5));
    expect(parseTime(Date.UTC(2026, 9, 23, 5))).toBe(Date.UTC(2026, 9, 23, 5));
    expect(parseTime(Date.UTC(2026, 9, 23, 5) / 1000)).toBe(Date.UTC(2026, 9, 23, 5));
    for (const bad of ['', 'yesterday', 0, -1, null, NaN]) expect(parseTime(bad)).toBeNull();
  });
});

describe('新指令與錯誤代碼（plan 4.9）', () => {
  it('JOBS_RUNNING、MANIFEST_INVALID、CHECKSUM_MISMATCH 是已知代碼，並有易懂的訊息', () => {
    expect(toErrorCode('JOBS_RUNNING')).toBe('JOBS_RUNNING');
    expect(toErrorCode('MANIFEST_INVALID')).toBe('MANIFEST_INVALID');
    expect(toErrorCode('SIGNATURE_INVALID')).toBe('UNKNOWN');
    expect(toErrorCode('CHECKSUM_MISMATCH')).toBe('CHECKSUM_MISMATCH');
    expect(errorInfo('JOBS_RUNNING').message).toBe('errJobsRunning');
    expect(errorInfo('MANIFEST_INVALID').message).toBe('errVerifyFailed');
    expect(errorInfo('CHECKSUM_MISMATCH').message).toBe('errVerifyFailed');
  });

  it('setAutoUpdate、checkUpdates、uninstall 都有逾時', () => {
    expect(REQUEST_TIMEOUT_MS.setAutoUpdate).toBeGreaterThan(0);
    expect(REQUEST_TIMEOUT_MS.checkUpdates).toBeGreaterThan(0);
    expect(REQUEST_TIMEOUT_MS.uninstall).toBeGreaterThan(0);
  });

  it('設定頁送給背景腳本的訊息：setAutoUpdate 只接受布林值', () => {
    expect(isContentMessage({ type: 'hostSetAutoUpdate', enabled: false })).toBe(true);
    expect(isContentMessage({ type: 'hostSetAutoUpdate', enabled: 'no' })).toBe(false);
    expect(isContentMessage({ type: 'hostSetAutoUpdate' })).toBe(false);
    expect(isContentMessage({ type: 'hostCheckUpdates' })).toBe(true);
    expect(isContentMessage({ type: 'hostUninstall' })).toBe(true);
    expect(isContentMessage({ type: 'platformInfo' })).toBe(true);
  });

  it('經由 NativeClient 送出指令並收到 JOBS_RUNNING（假的連接埠）', async () => {
    const listeners: Array<(m: unknown) => void> = [];
    const sent: Array<{ id: string; cmd: string; args?: unknown }> = [];
    const port: PortLike = {
      postMessage: (m) => {
        const req = m as { id: string; cmd: string; args?: unknown };
        sent.push(req);
        const reply =
          req.cmd === 'uninstall'
            ? { id: req.id, ok: false, error: { code: 'JOBS_RUNNING', message: 'jobs running' } }
            : req.cmd === 'checkUpdates'
              ? { id: req.id, ok: true, result: { started: true } }
              : { id: req.id, ok: true, result: { auto: false } };
        queueMicrotask(() => listeners.forEach((l) => l(reply)));
      },
      disconnect: () => {},
      onMessage: { addListener: (fn) => void listeners.push(fn) },
      onDisconnect: { addListener: () => {} },
    };
    const client = new NativeClient({ connect: () => port });
    await expect(client.request('setAutoUpdate', { enabled: false })).resolves.toEqual({ auto: false });
    await expect(client.request('checkUpdates')).resolves.toEqual({ started: true });
    await expect(client.request('uninstall')).rejects.toEqual(new HostRequestError('JOBS_RUNNING', 'jobs running'));
    expect(sent.map((r) => [r.cmd, r.args])).toEqual([
      ['setAutoUpdate', { enabled: false }],
      ['checkUpdates', undefined],
      ['uninstall', undefined],
    ]);
  });
});

describe('自動更新 yt-dlp 後重試（008 FR-22）', () => {
  const req: DownloadRequest = { kind: 'video', videoId: VID, title: 'T', label: '1080p', formatId: '137', container: 'mp4', section: null };

  it('只帶 jobId 與 stage 的進度事件：顯示「正在更新 yt-dlp…」與不確定進度', () => {
    const ev = parseHostMessage({ event: 'progress', jobId: 'j1', stage: 'updating-ytdlp' });
    expect(ev).toEqual({ kind: 'stage', jobId: 'j1', stage: 'updating-ytdlp' });
    let jobs: JobRecord[] = [{ ...newJob('j1', req, 1), state: 'downloading', percent: 30 }];
    jobs = applyEvent(jobs, { kind: 'stage', jobId: 'j1', stage: 'updating-ytdlp' }, 2);
    expect(jobs[0]).toMatchObject({ stage: 'updating-ytdlp', percent: null, state: 'downloading' });
    // 重新下載的進度事件清除 stage
    const progress = parseHostMessage({ event: 'progress', jobId: 'j1', videoId: VID, kind: 'video', state: 'downloading', percent: 5 });
    expect(progress?.kind).toBe('progress');
    if (progress?.kind !== 'progress') return;
    jobs = applyEvent(jobs, progress, 3);
    expect(jobs[0]).toMatchObject({ stage: null, percent: 5 });
  });

  it('完整的進度事件也可以帶 stage；未知的 stage 忽略', () => {
    expect(parseHostMessage({ event: 'progress', jobId: 'j1', videoId: VID, kind: 'video', stage: 'updating-ytdlp' })).toMatchObject({ kind: 'progress', stage: 'updating-ytdlp' });
    expect(parseHostMessage({ event: 'progress', jobId: 'j1', videoId: VID, kind: 'video', stage: 'rm' })).toMatchObject({ kind: 'progress', stage: null });
    expect(parseHostMessage({ event: 'progress', jobId: 'j1', stage: 'rm' })).toBeNull();
    expect(parseHostMessage({ event: 'progress', jobId: '../x', stage: 'updating-ytdlp' })).toBeNull();
  });

  it('未知或已結束的工作不受 stage 事件影響', () => {
    expect(applyEvent([], { kind: 'stage', jobId: 'j9', stage: 'updating-ytdlp' }, 1)).toEqual([]);
    const done = [{ ...newJob('j1', req, 1), state: 'done' as const }];
    expect(applyEvent(done, { kind: 'stage', jobId: 'j1', stage: 'updating-ytdlp' }, 2)[0]!.stage).toBeUndefined();
  });
});

describe('自動更新連續失敗的提示（008 FR-25、FR-29c）', () => {
  const T1 = Date.UTC(2026, 9, 21);
  const T2 = Date.UTC(2026, 9, 22);
  const state = (consecutiveFailures: number, lastCheck: number | null = T1): HostState => ({
    state: 'connected',
    status: parseStatus({ ...FAKE_STATUS, update: { auto: true, lastCheck, lastResult: 'failed', consecutiveFailures } }),
  });

  it('連續失敗 3 次以上才顯示', () => {
    expect(UPDATE_FAILURE_HINT_AT).toBe(3);
    expect(showUpdateFailureHint(state(2), null)).toBe(false);
    expect(showUpdateFailureHint(state(3), null)).toBe(true);
    expect(showUpdateFailureHint({ state: 'unreachable' }, null)).toBe(false);
    expect(showUpdateFailureHint({ state: 'connected', status: parseStatus({ ready: true }) }, null)).toBe(false);
  });

  it('關閉後同一次失敗不再顯示；之後再失敗（檢查時間改變）時再顯示', () => {
    expect(showUpdateFailureHint(state(3, T1), T1)).toBe(false);
    expect(showUpdateFailureHint(state(4, T2), T1)).toBe(true);
  });
});
