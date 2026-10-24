import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/utils/i18n';
import type { HostFormat, HostInfo } from '@/utils/native-protocol';
import { newJob, type JobRecord } from './jobs';
import { activeJobFor, existingQuickJob, mp3SpecLabel, planQuickDownload, quickSummary, quickTooltip, toQuickDefaults, videoSpecLabel } from './quick';

const ID = 'jNQXAC9IVRw';
const f = (p: Partial<HostFormat> & { id: string }): HostFormat => ({
  ext: 'mp4',
  vcodec: 'none',
  acodec: 'none',
  width: null,
  height: null,
  fps: null,
  tbr: null,
  abr: null,
  filesize: null,
  filesizeApprox: null,
  protocol: 'https',
  dynamicRange: 'SDR',
  language: '',
  note: '',
  ...p,
});
const info = (p: Partial<HostInfo> = {}): HostInfo => ({
  id: ID,
  title: 'Me at the zoo',
  channel: 'jawed',
  duration: 19,
  liveStatus: 'not_live',
  isLive: false,
  formats: [
    f({ id: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 129, filesize: 4_000_000 }),
    f({ id: '136', ext: 'mp4', vcodec: 'avc1.4d401f', width: 1280, height: 720, fps: 30, filesize: 36_000_000 }),
    f({ id: '299', ext: 'mp4', vcodec: 'avc1.64002a', width: 1920, height: 1080, fps: 60, filesizeApprox: 316_000_000 }),
  ],
  subtitles: [],
  autoCaptions: [],
  ...p,
});
const defaults = toQuickDefaults(1080, 'mp4', 192);

afterEach(() => setLocale('en'));

describe('文字（009 FR-7、FR-20）', () => {
  it('預設畫質與格式的說明（兩種語言）', () => {
    setLocale('en');
    expect(videoSpecLabel(1080, 'mp4')).toBe('1080p MP4');
    expect(videoSpecLabel('best', 'any')).toBe('Best quality, any format');
    expect(quickTooltip('video', defaults)).toBe('One-click download: 1080p MP4');
    expect(quickTooltip('mp3', defaults)).toBe('One-click download: MP3 192 kbps');
    setLocale('zh_TW');
    expect(videoSpecLabel(2160, 'mp4')).toBe('2160p MP4');
    expect(videoSpecLabel('best', 'any')).toBe('最高畫質 不限格式');
    expect(quickTooltip('video', defaults)).toBe('一鍵下載：1080p MP4');
    expect(quickTooltip('mp3', toQuickDefaults(1080, 'mp4', 320))).toBe('一鍵下載：MP3 320 kbps');
  });

  it('面板中的說明加上大小（FR-4）', () => {
    setLocale('zh_TW');
    expect(quickSummary({ label: '1080p60 MP4', estimate: { size: 320_000_000, approx: true } })).toBe('1080p60 MP4，約 320.0 MB');
    expect(quickSummary({ label: 'MP3 192 kbps', estimate: null })).toBe('MP3 192 kbps');
    setLocale('en');
    expect(quickSummary({ label: '720p MP4', estimate: { size: 36_000_000, approx: false } })).toBe('720p MP4, 36.0 MB');
  });

  it('不合法的設定值改用預設值', () => {
    expect(toQuickDefaults('9999', 'mkv', 999)).toEqual({ height: 1080, container: 'mp4', bitrate: 192 });
    expect(toQuickDefaults('best', 'any', 320)).toEqual({ height: 'best', container: 'any', bitrate: 320 });
    expect(mp3SpecLabel(64)).toBe('MP3 64 kbps');
  });
});

describe('planQuickDownload（009 FR-2、FR-3、FR-6）', () => {
  it('影片：依預設值選格式，標籤與大小', () => {
    const plan = planQuickDownload(ID, info(), 'video', defaults);
    expect(plan).toEqual({
      ok: true,
      request: { kind: 'video', videoId: ID, title: 'Me at the zoo', label: '1080p60 MP4', formatId: '299+140', container: 'mp4', section: null },
      estimate: { size: 320_000_000, approx: true },
    });
  });

  it('MP3：使用設定的位元率，不裁切', () => {
    expect(planQuickDownload(ID, info(), 'mp3', toQuickDefaults(1080, 'mp4', 320))).toEqual({
      ok: true,
      request: { kind: 'mp3', videoId: ID, title: 'Me at the zoo', label: 'MP3 320 kbps', bitrate: 320, section: null },
      estimate: null,
    });
  });

  it('影片資訊沒有標題時用頁面上的標題；影片 ID 一律用請求的', () => {
    const plan = planQuickDownload(ID, info({ title: '', id: '' }), 'mp3', defaults, 'Page title');
    expect(plan.ok && plan.request).toMatchObject({ videoId: ID, title: 'Page title' });
  });

  it('直播中、首播尚未開始：不自動開始', () => {
    expect(planQuickDownload(ID, info({ isLive: true }), 'video', defaults)).toEqual({ ok: false, error: 'LIVE_NOT_SUPPORTED' });
    expect(planQuickDownload(ID, info({ liveStatus: 'is_upcoming' }), 'mp3', defaults)).toEqual({ ok: false, error: 'LIVE_NOT_SUPPORTED' });
    expect(planQuickDownload(ID, info({ liveStatus: 'is_live' }), 'video', defaults)).toEqual({ ok: false, error: 'LIVE_NOT_SUPPORTED' });
  });

  it('沒有可下載的影片格式', () => {
    expect(planQuickDownload(ID, info({ formats: [] }), 'video', defaults)).toEqual({ ok: false, error: 'FORMAT_UNAVAILABLE' });
  });
});

describe('重複下載（009 FR-5）', () => {
  const job = (jobId: string, state: JobRecord['state'], kind: 'video' | 'mp3' = 'video', videoId = ID): JobRecord => ({
    ...newJob(jobId, kind === 'video' ? { kind, videoId, title: 'T', label: 'L', formatId: '18', container: 'mp4', section: null } : { kind, videoId, title: 'T', label: 'L', bitrate: 192, section: null }, 1),
    state,
  });

  it('進行中的同一個下載：顯示它', () => {
    const jobs = [job('b', 'downloading'), job('a', 'done')];
    expect(existingQuickJob(jobs, ID, 'video')?.jobId).toBe('b');
    expect(activeJobFor(jobs, ID, 'video')?.jobId).toBe('b');
  });

  it('最近一次已完成：顯示完成狀態（不自動再下載）', () => {
    expect(existingQuickJob([job('a', 'done')], ID, 'video')?.jobId).toBe('a');
    expect(activeJobFor([job('a', 'done')], ID, 'video')).toBeNull();
  });

  it('最近一次失敗或取消、或沒有：開始新的下載', () => {
    expect(existingQuickJob([job('b', 'failed'), job('a', 'done')], ID, 'video')).toBeNull();
    expect(existingQuickJob([job('b', 'cancelled')], ID, 'video')).toBeNull();
    expect(existingQuickJob([], ID, 'video')).toBeNull();
  });

  it('不同的影片或種類不算重複', () => {
    const jobs = [job('a', 'downloading', 'mp3'), job('b', 'downloading', 'video', 'bbbbbbbbbbb')];
    expect(existingQuickJob(jobs, ID, 'video')).toBeNull();
    expect(existingQuickJob(jobs, ID, 'mp3')?.jobId).toBe('a');
  });
});
