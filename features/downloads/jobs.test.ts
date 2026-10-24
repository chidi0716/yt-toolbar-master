import { describe, expect, it } from 'vitest';
import { formatSpeed } from '@/utils/format-list';
import type { HostJob } from '@/utils/native-protocol';
import {
  applyEvent,
  buttonProgress,
  errorInfo,
  formatEta,
  markMissing,
  mergeHostJobs,
  newJob,
  pruneJobs,
  FINISHED_TTL_MS,
  type DownloadRequest,
} from './jobs';

const VID = 'jNQXAC9IVRw';
const req: DownloadRequest = { kind: 'video', videoId: VID, title: 'T', label: '1080p MP4', formatId: '137+140', container: 'mp4', section: null };
const ev = (p: Record<string, unknown>) => ({ jobId: 'j1', videoId: VID, jobKind: 'video' as const, ...p });

describe('工作紀錄（002 FR-3、FR-4）', () => {
  it('進度、完成事件更新工作', () => {
    let jobs = [newJob('j1', req, 1)];
    jobs = applyEvent(jobs, { kind: 'progress', ...ev({}), state: 'downloading', percent: 40, speed: 1e6, eta: 12, part: 1, parts: 2 }, 2);
    expect(jobs[0]).toMatchObject({ state: 'downloading', percent: 40, speed: 1e6, eta: 12, label: '1080p MP4', request: req });
    jobs = applyEvent(jobs, { kind: 'done', ...ev({}), path: '/d/a.mp4', fileName: 'a.mp4' }, 3);
    expect(jobs[0]).toMatchObject({ state: 'done', percent: 100, fileName: 'a.mp4', speed: null });
  });

  it('失敗事件記錄錯誤代碼', () => {
    const jobs = applyEvent([newJob('j1', req, 1)], { kind: 'failed', ...ev({}), error: { code: 'DISK_FULL', message: '' } }, 2);
    expect(jobs[0]).toMatchObject({ state: 'failed', error: 'DISK_FULL' });
  });

  it('結束後延遲送達的進度事件不會把工作改回進行中', () => {
    let jobs = applyEvent([newJob('j1', req, 1)], { kind: 'done', ...ev({}), path: '/a', fileName: 'a' }, 2);
    jobs = applyEvent(jobs, { kind: 'progress', ...ev({}), state: 'downloading', percent: 90, speed: null, eta: null, part: null, parts: null }, 3);
    expect(jobs[0]!.state).toBe('done');
  });

  it('未知工作的事件加入清單（瀏覽器重新啟動後由橋接程式繼續推送）', () => {
    const jobs = applyEvent([], { kind: 'progress', ...ev({ jobId: 'j9' }), state: 'processing', percent: null, speed: null, eta: null, part: null, parts: null }, 5);
    expect(jobs).toEqual([expect.objectContaining({ jobId: 'j9', state: 'processing', percent: null, request: null })]);
  });

  it('以 jobs 結果同步：狀態以橋接程式為準，補報的工作（missed）加入，其他已結束的舊工作不加入', () => {
    const host: HostJob[] = [
      { jobId: 'j1', videoId: VID, kind: 'video', state: 'done', percent: 100, speed: null, eta: null, fileName: 'a.mp4', error: null, missed: true },
      { jobId: 'j2', videoId: VID, kind: 'mp3', state: 'failed', percent: null, speed: null, eta: null, fileName: null, error: { code: 'NETWORK', message: '' }, missed: true },
      { jobId: 'j3', videoId: VID, kind: 'mp3', state: 'done', percent: 100, speed: null, eta: null, fileName: 'old.mp3', error: null, missed: false },
    ];
    const jobs = mergeHostJobs([newJob('j1', req, 1)], host, 9);
    expect(jobs.map((j) => [j.jobId, j.state, j.error])).toEqual([
      ['j2', 'failed', 'NETWORK'],
      ['j1', 'done', null],
    ]);
    expect(jobs.find((j) => j.jobId === 'j1')!.request).toEqual(req);
  });

  it('橋接程式中不存在的進行中工作標記為中斷', () => {
    const jobs = markMissing([newJob('j1', req, 1)], [], 5);
    expect(jobs[0]).toMatchObject({ state: 'failed', error: 'INTERRUPTED' });
  });

  it('只保留進行中與最近結束的工作', () => {
    const active = newJob('a', req, 0);
    const old = { ...newJob('b', req, 0), state: 'done' as const, updatedAt: 0 };
    const recent = { ...newJob('c', req, 0), state: 'done' as const, updatedAt: FINISHED_TTL_MS };
    expect(pruneJobs([active, old, recent], FINISHED_TTL_MS + 10).map((j) => j.jobId)).toEqual(['a', 'c']);
  });
});

describe('errorInfo（002 FR-6a）', () => {
  it('缺少元件：顯示安裝說明', () => {
    for (const code of ['YTDLP_NOT_FOUND', 'FFMPEG_NOT_FOUND', 'HOST_UNREACHABLE'] as const) expect(errorInfo(code).action).toBe('install');
  });
  it('YouTube 有變動：附更新按鈕', () => {
    expect(errorInfo('YTDLP_OUTDATED')).toEqual({ message: 'errOutdated', action: 'update', retry: true });
    expect(errorInfo('VERIFICATION_REQUIRED').action).toBe('update');
  });
  it('需要登入、不存在、直播、沒有字幕：不提供重試', () => {
    expect(errorInfo('LOGIN_REQUIRED')).toEqual({ message: 'errLoginRequired', action: null, retry: false });
    expect(errorInfo('VIDEO_UNAVAILABLE').retry).toBe(false);
    expect(errorInfo('LIVE_NOT_SUPPORTED').message).toBe('liveUnavailable');
    expect(errorInfo('NO_SUBTITLES').message).toBe('errNoSubtitles');
    expect(errorInfo('FORMAT_UNAVAILABLE').message).toBe('errFormatUnavailable');
  });
  it('網路、逾時：請重試', () => {
    expect(errorInfo('NETWORK')).toEqual({ message: 'errNetwork', action: null, retry: true });
    expect(errorInfo('TIMEOUT').message).toBe('errNetwork');
  });
  it('無法寫入：附開啟設定頁', () => {
    expect(errorInfo('DISK_FULL')).toEqual({ message: 'errCannotWrite', action: 'settings', retry: true });
    expect(errorInfo('PERMISSION_DENIED').action).toBe('settings');
  });
  it('同時下載數上限、其他：下載失敗並可重試', () => {
    expect(errorInfo('TOO_MANY_JOBS').message).toBe('errTooManyJobs');
    for (const code of ['INTERRUPTED', 'UNKNOWN', 'INVALID_ARGS', null] as const) expect(errorInfo(code)).toEqual({ message: 'errDownloadFailed', action: null, retry: true });
  });
});

describe('進度文字（002 FR-3、FR-6b）', () => {
  it('速度與剩餘時間', () => {
    expect(formatSpeed(1_234_567)).toBe('1.2 MB/s');
    expect(formatSpeed(800)).toBe('800 B/s');
    expect(formatSpeed(null)).toBe('');
    expect(formatEta(83)).toBe('01:23');
    expect(formatEta(3723)).toBe('1:02:03');
    expect(formatEta(null)).toBe('');
  });

  it('按鈕的進度環：最慢的一個；有沒有百分比的工作時為不確定', () => {
    const a = { ...newJob('a', req, 0), state: 'downloading' as const, percent: 70 };
    const b = { ...newJob('b', req, 0), state: 'downloading' as const, percent: 20 };
    const c = { ...newJob('c', req, 0), state: 'processing' as const, percent: null };
    expect(buttonProgress([a, b], VID, 'video')).toBe(20);
    expect(buttonProgress([a, c], VID, 'video')).toBe('indeterminate');
    expect(buttonProgress([a], VID, 'mp3')).toBeNull();
    expect(buttonProgress([{ ...a, state: 'done' }], VID, 'video')).toBeNull();
  });
});
