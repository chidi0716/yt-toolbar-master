import { describe, expect, it } from 'vitest';
import { buildQualityList, formatSize, qualityBadge, resolutionLabel, sizeForSection, visibleRows } from './format-list';
import type { HostFormat } from './native-protocol';

/** 以 getInfo 回傳的欄位建立一個格式（未指定的欄位為空）。 */
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

// 範例 1：一般的 4K 影片（格式組合依 YouTube 常見的格式：H.264 最高 1080p、VP9／AV1 到 2160p、DRC 聲音）
const UHD: HostFormat[] = [
  f({ id: 'sb0', ext: 'mhtml', protocol: 'mhtml', vcodec: 'none' }),
  f({ id: '139-drc', ext: 'm4a', acodec: 'mp4a.40.5', abr: 48, tbr: 48, filesize: 1_500_000, note: 'low, DRC' }),
  f({ id: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 129, tbr: 129, filesize: 3_970_000 }),
  f({ id: '140-drc', ext: 'm4a', acodec: 'mp4a.40.2', abr: 130, tbr: 130, filesize: 4_000_000, note: 'medium, DRC' }),
  f({ id: '251', ext: 'webm', acodec: 'opus', abr: 135, tbr: 135, filesizeApprox: 4_100_000 }),
  f({ id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', width: 640, height: 360, fps: 30, tbr: 500, filesizeApprox: 15_300_000 }),
  f({ id: '134', ext: 'mp4', vcodec: 'avc1.4d401e', width: 640, height: 360, fps: 30, tbr: 300, filesize: 9_000_000 }),
  f({ id: '136', ext: 'mp4', vcodec: 'avc1.4d401f', width: 1280, height: 720, fps: 30, tbr: 1200, filesize: 36_700_000 }),
  f({ id: '137', ext: 'mp4', vcodec: 'avc1.640028', width: 1920, height: 1080, fps: 30, tbr: 4400, filesize: 134_800_000 }),
  f({ id: '299', ext: 'mp4', vcodec: 'avc1.64002a', width: 1920, height: 1080, fps: 60, tbr: 6000, filesize: 190_000_000 }),
  f({ id: '248', ext: 'webm', vcodec: 'vp9', width: 1920, height: 1080, fps: 30, tbr: 2600, filesizeApprox: 79_600_000 }),
  f({ id: '271', ext: 'webm', vcodec: 'vp9', width: 2560, height: 1440, fps: 30, tbr: 9000, filesize: 270_000_000 }),
  f({ id: '313', ext: 'webm', vcodec: 'vp9', width: 3840, height: 2160, fps: 30, tbr: 17000, filesizeApprox: 520_000_000 }),
  f({ id: '401', ext: 'mp4', vcodec: 'av01.0.12M.08', width: 3840, height: 2160, fps: 30, tbr: 12000, filesize: 367_000_000 }),
  f({ id: '999', ext: 'mp4', vcodec: 'avc1.640028', width: 1920, height: 1080, fps: 30, tbr: null }),
];

describe('qualityBadge／resolutionLabel（002 FR-11）', () => {
  it('2160p 以上 4K（4320p 為 8K）、1440p 2K、1080p 1080、720p HD，其餘沒有標籤', () => {
    expect([4320, 2160, 1440, 1080, 720, 480, 144].map(qualityBadge)).toEqual(['8K', '4K', '2K', '1080', 'HD', null, null]);
  });
  it('幀率超過 30 時加在解析度後面', () => {
    expect(resolutionLabel(1080, 60)).toBe('1080p60');
    expect(resolutionLabel(1080, 30)).toBe('1080p');
    expect(resolutionLabel(720, 25)).toBe('720p');
    expect(resolutionLabel(2160, 59.94)).toBe('2160p60');
  });
});

describe('buildQualityList（002 FR-10 至 FR-13、plan 3.8）', () => {
  const rows = buildQualityList(UHD);
  const byKey = Object.fromEntries(rows.map((r) => [`${r.container} ${r.resolution}`, r]));

  it('由高到低排列，同解析度 MP4 在前', () => {
    expect(rows.map((r) => `${r.container} ${r.resolution}`)).toEqual([
      'mp4 2160p',
      'webm 2160p',
      'mp4 1440p',
      'webm 1440p',
      'mp4 1080p60',
      'mp4 1080p',
      'webm 1080p',
      'mp4 720p',
      'mp4 360p',
    ]);
  });

  it('只有影像的格式搭配最佳聲音：MP4 用非 DRC 的 M4A，WEBM 用 Opus', () => {
    expect(byKey['mp4 1080p']!.formatId).toBe('137+140');
    expect(byKey['mp4 1080p60']!.formatId).toBe('299+140');
    expect(byKey['webm 2160p']!.formatId).toBe('313+251');
  });

  it('1080p 以下的 MP4 只有 H.264；WEBM 組為 VP9／AV1＋Opus，同組取位元率最高', () => {
    // 2160p 的 VP9（17000）位元率高於 AV1（12000）
    expect(byKey['webm 2160p']!.formatId).toBe('313+251');
    expect(rows.filter((r) => r.container === 'mp4' && r.height <= 1080).every((r) => !r.limited)).toBe(true);
  });

  it('2K 以上沒有 H.264 時，以 AV1（否則 VP9）＋M4A 合併成 MP4 並標記 limited（FR-13、Q43）', () => {
    // 2160p 有 AV1（401）也有 VP9（313）：MP4 用 AV1，即使 VP9 的位元率較高
    expect(byKey['mp4 2160p']).toMatchObject({ formatId: '401+140', limited: true, size: 367_000_000 + 3_970_000, approx: false, badge: '4K' });
    // 1440p 只有 VP9
    expect(byKey['mp4 1440p']).toMatchObject({ formatId: '271+140', limited: true, badge: '2K' });
    // 說明中標明編碼（constitution 第 8a 點：「AV1：部分播放器不支援」）
    expect(byKey['mp4 2160p']!.limitedCodec).toBe('AV1');
    expect(byKey['mp4 1440p']!.limitedCodec).toBe('VP9');
    expect(byKey['mp4 1080p']!.limitedCodec).toBeUndefined();
    // 1080p 有 H.264，不另外產生
    expect(rows.filter((r) => r.container === 'mp4' && r.height === 1080).map((r) => r.formatId)).toEqual(['299+140', '137+140']);
  });

  it('同解析度有合併格式時，已含聲音的單一格式不重複列出', () => {
    expect(byKey['mp4 360p']!.formatId).toBe('134+140');
    expect(rows.filter((r) => r.resolution === '360p')).toHaveLength(1);
  });

  it('大小為影像與聲音相加；任一方只有估計值時標記約', () => {
    expect(byKey['mp4 1080p']).toMatchObject({ size: 134_800_000 + 3_970_000, approx: false });
    expect(byKey['webm 2160p']).toMatchObject({ size: 520_000_000 + 4_100_000, approx: true });
  });

  it('標籤', () => {
    expect(rows.map((r) => r.badge)).toEqual(['4K', '4K', '2K', '2K', '1080', '1080', '1080', 'HD', null]);
  });

  it('預設只列出 MP4（FR-13）', () => {
    expect(visibleRows(rows, false).map((r) => r.resolution)).toEqual(['2160p', '1440p', '1080p60', '1080p', '720p', '360p']);
    expect(visibleRows(rows, true)).toHaveLength(rows.length);
  });
});

describe('其他範例', () => {
  it('只有已含聲音的格式（舊影片）：直接列出', () => {
    const rows = buildQualityList([
      f({ id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', width: 320, height: 240, fps: 30, filesize: 800_000 }),
      f({ id: '17', ext: '3gp', vcodec: 'mp4v.20.3', acodec: 'mp4a.40.2', width: 176, height: 144, fps: 12 }),
    ]);
    expect(rows).toEqual([expect.objectContaining({ formatId: '18', resolution: '240p', size: 800_000, approx: false, container: 'mp4' })]);
  });

  it('直式影片（Shorts）以短邊表示解析度', () => {
    const rows = buildQualityList([
      f({ id: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 128, filesize: 1000 }),
      f({ id: '137', ext: 'mp4', vcodec: 'avc1.640028', width: 1080, height: 1920, fps: 30, filesize: 5000 }),
    ]);
    expect(rows[0]).toMatchObject({ resolution: '1080p', badge: '1080', formatId: '137+140', size: 6000 });
  });

  it('大小未知時為 null（顯示「—」）', () => {
    const rows = buildQualityList([
      f({ id: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 128 }),
      f({ id: '137', ext: 'mp4', vcodec: 'avc1.640028', width: 1920, height: 1080, fps: 30, filesize: 5000 }),
    ]);
    expect(rows[0]).toMatchObject({ size: null, approx: false });
  });

  it('8K、HDR 分開列出', () => {
    const rows = buildQualityList([
      f({ id: '251', ext: 'webm', acodec: 'opus', abr: 130, filesize: 10 }),
      f({ id: '571', ext: 'mp4', vcodec: 'av01.0.16M.08', width: 7680, height: 4320, fps: 30, filesize: 100 }),
      f({ id: '337', ext: 'webm', vcodec: 'vp9.2', width: 3840, height: 2160, fps: 60, dynamicRange: 'HDR10', filesize: 50 }),
      f({ id: '315', ext: 'webm', vcodec: 'vp9', width: 3840, height: 2160, fps: 60, filesize: 40 }),
    ]);
    expect(rows.map((r) => [r.badge, r.resolution, r.hdr])).toEqual([
      ['8K', '4320p', false],
      ['4K', '2160p60', false],
      ['4K', '2160p60', true],
    ]);
  });

  it('8K、HDR 也以 AV1／VP9＋M4A 合併成 MP4（各自一列）', () => {
    const rows = buildQualityList([
      f({ id: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 128, filesize: 10 }),
      f({ id: '251', ext: 'webm', acodec: 'opus', abr: 130, filesize: 10 }),
      f({ id: '571', ext: 'mp4', vcodec: 'av01.0.16M.08', width: 7680, height: 4320, fps: 30, filesize: 100 }),
      f({ id: '337', ext: 'webm', vcodec: 'vp9.2', width: 3840, height: 2160, fps: 60, dynamicRange: 'HDR10', filesize: 50 }),
      f({ id: '701', ext: 'mp4', vcodec: 'av01.0.13M.10.0.110.09.16.09.0', width: 3840, height: 2160, fps: 60, dynamicRange: 'HDR10', filesize: 45 }),
      f({ id: '315', ext: 'webm', vcodec: 'vp9', width: 3840, height: 2160, fps: 60, filesize: 40 }),
    ]);
    expect(visibleRows(rows, false).map((r) => [r.resolution, r.hdr, r.formatId, r.limited])).toEqual([
      ['4320p', false, '571+140', true],
      ['2160p60', false, '315+140', true],
      ['2160p60', true, '701+140', true],
    ]);
  });

  it('沒有 M4A 時不產生 AV1／VP9 的 MP4', () => {
    const rows = buildQualityList([
      f({ id: '251', ext: 'webm', acodec: 'opus', abr: 130 }),
      f({ id: '313', ext: 'webm', vcodec: 'vp9', width: 3840, height: 2160, fps: 30 }),
    ]);
    expect(rows.map((r) => r.container)).toEqual(['webm']);
  });

  it('1080p 以下沒有 H.264 時不產生 AV1／VP9 的 MP4', () => {
    const rows = buildQualityList([
      f({ id: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 128 }),
      f({ id: '251', ext: 'webm', acodec: 'opus', abr: 130 }),
      f({ id: '248', ext: 'webm', vcodec: 'vp9', width: 1920, height: 1080, fps: 30 }),
    ]);
    expect(rows.map((r) => r.container)).toEqual(['webm']);
  });

  it('沒有對應的聲音時不列出只有影像的格式', () => {
    expect(buildQualityList([f({ id: '137', ext: 'mp4', vcodec: 'avc1.640028', width: 1920, height: 1080 })])).toEqual([]);
  });

  it('格式 ID 不符合橋接程式驗證規則的格式不列出', () => {
    const rows = buildQualityList([
      f({ id: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 128 }),
      f({ id: '-x', ext: 'mp4', vcodec: 'avc1', width: 1920, height: 1080 }),
      f({ id: 'hls-1080p-extra-long', ext: 'mp4', vcodec: 'avc1', width: 1920, height: 1080 }),
    ]);
    expect(rows).toEqual([]);
  });
});

describe('時間範圍與大小（004 FR-22）', () => {
  const row = buildQualityList(UHD).find((r) => r.formatId === '137+140')!;
  it('時間範圍不是整部影片時依比例估算並標記約', () => {
    expect(sizeForSection(row, { start: 60, end: 90 }, 300)).toEqual({ size: Math.round((row.size! * 30) / 300), approx: true });
    expect(sizeForSection(row, null, 300)).toEqual({ size: row.size, approx: false });
  });
  it('formatSize', () => {
    expect(formatSize(147_100_000, false, '約 ')).toBe('147.1 MB');
    expect(formatSize(1_234_567_890, true, '~')).toBe('~1.2 GB');
    expect(formatSize(950, false, '')).toBe('950 B');
    expect(formatSize(null, true, '約')).toBe('—');
  });
});
