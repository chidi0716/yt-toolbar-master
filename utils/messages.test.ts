import { describe, expect, it } from 'vitest';
import { isBackgroundMessage, isContentMessage } from './messages';

describe('isContentMessage', () => {
  it('接受已定義的訊息', () => {
    expect(isContentMessage({ type: 'openOptions' })).toBe(true);
  });

  it('拒絕其他內容', () => {
    for (const value of [null, undefined, 'openOptions', 1, {}, { type: 'eval' }, { type: ['openOptions'] }]) {
      expect(isContentMessage(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('下載相關的訊息（階段 4a）', () => {
  const ID = 'jNQXAC9IVRw';
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const caption = { type: 'downloadCaption', videoId: ID, title: 'T', languageCode: 'en', url: 'https://www.youtube.com/api/timedtext?v=x', format: 'srt' };

  it('接受合法的縮圖、截圖、字幕訊息', () => {
    expect(isContentMessage({ type: 'getThumbnails', videoId: ID })).toBe(true);
    expect(isContentMessage({ type: 'downloadThumbnail', videoId: ID, title: 'T', key: 'maxresdefault' })).toBe(true);
    expect(isContentMessage({ type: 'saveScreenshot', videoId: ID, title: '標題', seconds: 62.5, dataUrl: PNG })).toBe(true);
    expect(isContentMessage(caption)).toBe(true);
    expect(isContentMessage({ ...caption, format: 'txt', languageCode: 'zh-TW' })).toBe(true);
  });

  it('拒絕不合法的影片 ID 與縮圖尺寸（縮圖網址由背景腳本組出，不接受任意網址）', () => {
    expect(isContentMessage({ type: 'getThumbnails', videoId: '../../x' })).toBe(false);
    expect(isContentMessage({ type: 'downloadThumbnail', videoId: ID, title: 'T', key: 'https://evil.example/a.jpg' })).toBe(false);
    expect(isContentMessage({ type: 'downloadThumbnail', videoId: ID, title: 'T', key: 'default' })).toBe(false);
    expect(isContentMessage({ type: 'downloadThumbnail', videoId: ID, title: 'x'.repeat(501), key: 'hqdefault' })).toBe(false);
  });

  it('截圖只接受 PNG 的 data URL', () => {
    for (const dataUrl of ['https://evil.example/a.png', 'data:text/html;base64,PGgxPg==', 'data:image/png;base64,<script>', 'javascript:1']) {
      expect(isContentMessage({ type: 'saveScreenshot', videoId: ID, title: 'T', seconds: 1, dataUrl }), dataUrl).toBe(false);
    }
    expect(isContentMessage({ type: 'saveScreenshot', videoId: ID, title: 'T', seconds: -1, dataUrl: PNG })).toBe(false);
    expect(isContentMessage({ type: 'saveScreenshot', videoId: ID, title: 'T', seconds: Number.NaN, dataUrl: PNG })).toBe(false);
  });

  it('字幕網址必須是 https 的 youtube.com，格式與語言代碼必須合法', () => {
    for (const url of ['https://evil.example/api/timedtext', 'http://www.youtube.com/api/timedtext', 'https://youtube.com.evil.example/', 'file:///etc/passwd']) {
      expect(isContentMessage({ ...caption, url }), url).toBe(false);
    }
    expect(isContentMessage({ ...caption, format: 'exe' })).toBe(false);
    expect(isContentMessage({ ...caption, languageCode: '../en' })).toBe(false);
  });
});

describe('經由橋接程式的訊息（階段 4）', () => {
  const ID = 'jNQXAC9IVRw';
  const video = { kind: 'video', videoId: ID, title: 'T', label: '1080p MP4', formatId: '137+140', container: 'mp4', section: null };
  const mp3 = { kind: 'mp3', videoId: ID, title: 'T', label: 'MP3 192 kbps', bitrate: 192, section: { start: 60, end: 90 } };
  const sub = { kind: 'subtitle', videoId: ID, title: 'T', label: 'English SRT', subLang: 'en', subFormat: 'srt', subAuto: false };

  it('接受合法的指令', () => {
    for (const m of [
      { type: 'hostStatus', refresh: false },
      { type: 'getInfo', videoId: ID },
      { type: 'startDownload', request: video },
      { type: 'startDownload', request: mp3 },
      { type: 'startDownload', request: sub },
      { type: 'startDownload', request: { ...sub, subLang: 'zh-TW', subFormat: 'txt', subAuto: true } },
      { type: 'cancelJob', jobId: 'j1a2b3c4' },
      { type: 'revealJob', jobId: 'abc_DEF-123' },
      { type: 'getJobs' },
      { type: 'pickFolder' },
      { type: 'updateYtDlp' },
      { type: 'quickDownload', videoId: ID, kind: 'video', title: 'T' },
      { type: 'quickDownload', videoId: ID, kind: 'mp3', title: '' },
    ]) {
      expect(isContentMessage(m), JSON.stringify(m)).toBe(true);
    }
  });

  it('拒絕不合法的參數', () => {
    for (const m of [
      { type: 'hostStatus' },
      { type: 'getInfo', videoId: 'x' },
      { type: 'cancelJob', jobId: '../x' },
      { type: 'revealJob', jobId: '' },
      { type: 'startDownload', request: { ...video, videoId: 'bad' } },
      { type: 'startDownload', request: { ...video, formatId: '-x' } },
      { type: 'startDownload', request: { ...video, formatId: '137+140+251' } },
      { type: 'startDownload', request: { ...video, formatId: 'bv*' } },
      { type: 'startDownload', request: { ...video, container: 'mkv' } },
      { type: 'startDownload', request: { ...video, section: { start: 10, end: 5 } } },
      { type: 'startDownload', request: { ...video, section: { start: 1.5, end: 5 } } },
      { type: 'startDownload', request: { ...video, section: { start: 0, end: 5, extra: 1 } } },
      { type: 'startDownload', request: { ...video, section: '0-5' } },
      { type: 'startDownload', request: { ...mp3, bitrate: 999 } },
      { type: 'startDownload', request: { ...sub, subLang: 'all' } },
      { type: 'startDownload', request: { ...sub, subLang: '-en' } },
      { type: 'startDownload', request: { ...sub, subFormat: 'ass' } },
      { type: 'startDownload', request: { ...sub, subAuto: 'yes' } },
      { type: 'startDownload', request: { ...sub, kind: 'exec' } },
      { type: 'startDownload', request: { ...sub, title: 'x'.repeat(1000) } },
      { type: 'startDownload', request: null },
      // 一鍵下載（009）：只接受影片與 MP3，格式由背景腳本選擇
      { type: 'quickDownload', videoId: ID, kind: 'subtitle', title: 'T' },
      { type: 'quickDownload', videoId: 'bad', kind: 'video', title: 'T' },
      { type: 'quickDownload', videoId: ID, kind: 'video' },
      { type: 'quickDownload', videoId: ID, kind: 'video', title: 'x'.repeat(1000) },
    ]) {
      expect(isContentMessage(m), JSON.stringify(m).slice(0, 120)).toBe(false);
    }
  });

  it('新版本提醒的訊息（008）：操作只接受白名單，版本號必須是正規化的格式', () => {
    for (const m of [
      { type: 'updateCheck' },
      { type: 'updateStatus' },
      { type: 'updateAction', action: 'open', version: '0.2.0' },
      { type: 'updateAction', action: 'skip', version: '0.10.1' },
      { type: 'updateAction', action: 'disable', version: null },
      { type: 'updateAction', action: 'enable', version: null },
      { type: 'updateAction', action: 'cardShown', version: '1.0.0' },
    ]) {
      expect(isContentMessage(m), JSON.stringify(m)).toBe(true);
    }
    for (const m of [
      { type: 'updateAction', action: 'open', version: 'v0.2.0' },
      { type: 'updateAction', action: 'open', version: '0.2.0-beta' },
      { type: 'updateAction', action: 'open' },
      { type: 'updateAction', action: 'fetch', version: '0.2.0' },
      { type: 'updateAction', action: 'open', version: 'https://evil.example/' },
    ]) {
      expect(isContentMessage(m), JSON.stringify(m)).toBe(false);
    }
  });

  it('isBackgroundMessage 只接受 jobsChanged', () => {
    expect(isBackgroundMessage({ type: 'jobsChanged', jobs: [] })).toBe(true);
    expect(isBackgroundMessage({ type: 'jobsChanged' })).toBe(false);
    expect(isBackgroundMessage({ type: 'other', jobs: [] })).toBe(false);
    expect(isBackgroundMessage(null)).toBe(false);
  });
});
