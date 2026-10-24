import { describe, expect, it } from 'vitest';
import { pickQuality } from '@/features/viewing/quality-logic';
import { pickDefaultFormat, pickHeight } from './default-format';
import type { HostFormat } from './native-protocol';
import { QUALITY_HEIGHTS, type QualityCode } from './youtube/dom';

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

const M4A = f({ id: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 129, tbr: 129, filesize: 4_000_000 });
const OPUS = f({ id: '251', ext: 'webm', acodec: 'opus', abr: 135, tbr: 135, filesize: 4_100_000 });

// 4K 影片：H.264 到 1080p（含 60 幀）、VP9 到 2160p、AV1 2160p
const UHD: HostFormat[] = [
  M4A,
  OPUS,
  f({ id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', width: 640, height: 360, fps: 30, filesize: 15_000_000 }),
  f({ id: '135', ext: 'mp4', vcodec: 'avc1.4d401f', width: 854, height: 480, fps: 30, tbr: 900, filesize: 20_000_000 }),
  f({ id: '136', ext: 'mp4', vcodec: 'avc1.4d401f', width: 1280, height: 720, fps: 30, tbr: 1200, filesize: 36_000_000 }),
  f({ id: '137', ext: 'mp4', vcodec: 'avc1.640028', width: 1920, height: 1080, fps: 30, tbr: 4400, filesize: 134_000_000 }),
  f({ id: '299', ext: 'mp4', vcodec: 'avc1.64002a', width: 1920, height: 1080, fps: 60, tbr: 6000, filesize: 190_000_000 }),
  f({ id: '248', ext: 'webm', vcodec: 'vp9', width: 1920, height: 1080, fps: 30, tbr: 2600, filesize: 80_000_000 }),
  f({ id: '271', ext: 'webm', vcodec: 'vp9', width: 2560, height: 1440, fps: 30, tbr: 9000, filesize: 270_000_000 }),
  f({ id: '313', ext: 'webm', vcodec: 'vp9', width: 3840, height: 2160, fps: 30, tbr: 17000, filesize: 520_000_000 }),
  f({ id: '401', ext: 'mp4', vcodec: 'av01.0.12M.08', width: 3840, height: 2160, fps: 30, tbr: 12000, filesize: 367_000_000 }),
];

describe('pickHeight（009 FR-2）', () => {
  it('有這個畫質就用它；沒有時選比它低的最高畫質；全部都比它高時選最低的', () => {
    expect(pickHeight([2160, 1080, 720], 1080)).toBe(1080);
    expect(pickHeight([720, 480, 360], 1080)).toBe(720);
    expect(pickHeight([2160, 1440], 1080)).toBe(1440);
    expect(pickHeight([2160, 1440, 1080], 'best')).toBe(2160);
    expect(pickHeight([], 1080)).toBeNull();
  });

  it('與鎖定畫質（004 FR-2）是同一個規則', () => {
    const codes: QualityCode[] = ['hd2160', 'hd1440', 'hd720', 'large'];
    for (const target of [2160, 1440, 1080, 720, 480] as const) {
      const lock = pickQuality(String(target) as '1080', codes)!;
      expect(pickHeight(codes.map((c) => QUALITY_HEIGHTS[c]), target), String(target)).toBe(QUALITY_HEIGHTS[lock]);
    }
    expect(pickHeight([1440, 1080], 480)).toBe(QUALITY_HEIGHTS[pickQuality('480', ['hd1440', 'hd1080'])!]);
  });
});

describe('pickDefaultFormat（009 FR-2、plan 3.11）', () => {
  it('預設（1080p MP4）：1080p 有 30 與 60 幀時選 60 幀', () => {
    expect(pickDefaultFormat(UHD, { height: 1080, container: 'mp4' })).toMatchObject({ formatId: '299+140', container: 'mp4', resolution: '1080p60', limited: false });
  });

  it('只有 720p 的影片：得到 720p', () => {
    const formats = UHD.filter((x) => !x.height || x.height <= 720);
    expect(pickDefaultFormat(formats, { height: 1080, container: 'mp4' })).toMatchObject({ formatId: '136+140', resolution: '720p' });
  });

  it('只有比設定更高的畫質：選最低的', () => {
    const formats = [M4A, ...UHD.filter((x) => x.id === '137' || x.id === '401')];
    expect(pickDefaultFormat(formats, { height: 480, container: 'mp4' })).toMatchObject({ formatId: '137+140', resolution: '1080p' });
  });

  it('最高畫質＋MP4：2K 以上是 AV1（沒有才用 VP9）合併的 MP4', () => {
    expect(pickDefaultFormat(UHD, { height: 'best', container: 'mp4' })).toMatchObject({ formatId: '401+140', container: 'mp4', height: 2160, limited: true });
    expect(pickDefaultFormat(UHD, { height: 1440, container: 'mp4' })).toMatchObject({ formatId: '271+140', container: 'mp4', limited: true });
  });

  it('最高畫質＋不限格式：4K 影片得到 2160p（這部影片的 2160p 只有 WEBM 與 AV1 的 MP4，選 WEBM）', () => {
    expect(pickDefaultFormat(UHD, { height: 'best', container: 'any' })).toMatchObject({ formatId: '313+251', container: 'webm', height: 2160 });
  });

  it('不限格式時同畫質以 H.264 的 MP4 優先', () => {
    expect(pickDefaultFormat(UHD, { height: 1080, container: 'any' })).toMatchObject({ formatId: '299+140', container: 'mp4' });
  });

  it('只有已含聲音的格式（舊影片）', () => {
    const formats = [
      f({ id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', width: 320, height: 240, fps: 30, filesize: 800_000 }),
      f({ id: '17', ext: '3gp', vcodec: 'mp4v.20.3', acodec: 'mp4a.40.2', width: 176, height: 144, fps: 12 }),
    ];
    expect(pickDefaultFormat(formats, { height: 1080, container: 'mp4' })).toMatchObject({ formatId: '18', resolution: '240p' });
  });

  it('同畫質同幀率有 HDR 與 SDR 時選 SDR', () => {
    const formats = [
      M4A,
      f({ id: '303', ext: 'mp4', vcodec: 'avc1.64002a', width: 1920, height: 1080, fps: 60, tbr: 5000, filesize: 1000 }),
      f({ id: '699', ext: 'mp4', vcodec: 'avc1.64002a', width: 1920, height: 1080, fps: 60, tbr: 9000, dynamicRange: 'HDR10', filesize: 2000 }),
    ];
    expect(pickDefaultFormat(formats, { height: 1080, container: 'mp4' })).toMatchObject({ formatId: '303+140', hdr: false });
  });

  it('沒有 MP4 結果時改用其他格式；完全沒有可下載的格式時為 null', () => {
    const webmOnly = [OPUS, f({ id: '248', ext: 'webm', vcodec: 'vp9', width: 1920, height: 1080, fps: 30, filesize: 1000 })];
    expect(pickDefaultFormat(webmOnly, { height: 1080, container: 'mp4' })).toMatchObject({ formatId: '248+251', container: 'webm' });
    expect(pickDefaultFormat([M4A], { height: 1080, container: 'mp4' })).toBeNull();
    expect(pickDefaultFormat([], { height: 'best', container: 'any' })).toBeNull();
  });
});
