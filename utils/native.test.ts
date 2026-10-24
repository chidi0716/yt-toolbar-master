import { describe, expect, it, vi } from 'vitest';
import { HostRequestError, NativeClient, reconnectDelay, type PortLike } from './native';
import { parseHostMessage, parseInfo, parseJobs, parseStatus, toErrorCode } from './native-protocol';

const VID = 'jNQXAC9IVRw';

describe('parseHostMessage（plan 4.2）', () => {
  it('成功與失敗的回應', () => {
    expect(parseHostMessage({ id: 'a', ok: true, result: { x: 1 } })).toEqual({ kind: 'response', id: 'a', ok: true, result: { x: 1 } });
    expect(parseHostMessage({ id: 'a', ok: false, error: { code: 'NETWORK', message: 'boom' } })).toEqual({
      kind: 'response',
      id: 'a',
      ok: false,
      error: { code: 'NETWORK', message: 'boom' },
    });
    expect(parseHostMessage({ id: null, ok: false, error: { code: 'INVALID_REQUEST' } })).toMatchObject({ id: null, ok: false });
  });

  it('不認得的錯誤代碼視為 UNKNOWN', () => {
    expect(parseHostMessage({ id: 'a', ok: false, error: { code: 'HACKED' } })).toMatchObject({ error: { code: 'UNKNOWN' } });
    expect(toErrorCode('DISK_FULL')).toBe('DISK_FULL');
    expect(toErrorCode(42)).toBe('UNKNOWN');
  });

  it('進度、完成、失敗事件', () => {
    expect(parseHostMessage({ event: 'progress', jobId: 'j1', videoId: VID, kind: 'video', state: 'downloading', percent: 42.5, speed: 1000, eta: 3, part: 1, parts: 2 })).toEqual({
      kind: 'progress',
      jobId: 'j1',
      videoId: VID,
      jobKind: 'video',
      state: 'downloading',
      percent: 42.5,
      speed: 1000,
      eta: 3,
      part: 1,
      parts: 2,
      stage: null,
    });
    // 沒有百分比（裁切由 ffmpeg 處理時，002 FR-6b）
    expect(parseHostMessage({ event: 'progress', jobId: 'j1', videoId: VID, kind: 'mp3', state: 'processing' })).toMatchObject({ percent: null, state: 'processing' });
    expect(parseHostMessage({ event: 'done', jobId: 'j1', videoId: VID, kind: 'mp3', path: '/d/a.mp3', fileName: 'a.mp3' })).toMatchObject({ kind: 'done', fileName: 'a.mp3' });
    expect(parseHostMessage({ event: 'failed', jobId: 'j1', videoId: VID, kind: 'subtitle', error: { code: 'NO_SUBTITLES' } })).toMatchObject({
      kind: 'failed',
      error: { code: 'NO_SUBTITLES' },
    });
  });

  it('百分比限制在 0–100', () => {
    expect(parseHostMessage({ event: 'progress', jobId: 'j', videoId: VID, kind: 'video', percent: 250 })).toMatchObject({ percent: 100 });
  });

  it('拒絕格式不對的訊息', () => {
    for (const raw of [
      null,
      'x',
      [],
      { id: 'a' },
      { id: 'a', ok: true, result: 'x' },
      { event: 'progress', jobId: '../x', videoId: VID, kind: 'video' },
      { event: 'progress', jobId: 'j', videoId: 'bad', kind: 'video' },
      { event: 'progress', jobId: 'j', videoId: VID, kind: 'exe' },
      { event: 'done', jobId: 'j', videoId: VID, kind: 'video' },
      { event: 'other', jobId: 'j', videoId: VID, kind: 'video' },
    ]) {
      expect(parseHostMessage(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe('結果整理', () => {
  it('status：components 是各元件狀態的唯一來源（stage 11 格式）', () => {
    const s = parseStatus({
      hostVersion: '1.0.0',
      ready: true,
      complete: false,
      components: [
        { name: 'helper', found: true, version: '1.0.0', path: '/x/ytm-host', source: 'bundled', error: '' },
        { name: 'yt-dlp', found: true, version: '2026.10.21', path: '/opt/homebrew/bin/yt-dlp', source: 'homebrew', error: '' },
        { name: 'ffmpeg', found: true, version: '', path: '/usr/local/bin/ffmpeg', source: 'path', error: 'UNKNOWN' },
        { name: 'deno', found: false, version: '', path: '', source: '', error: '' },
      ],
      defaultDir: '/Users/a/Downloads',
      namePresets: [{ id: 'title-id', example: 'Title [x]' }, { id: 'BAD ID', example: 'x' }],
    });
    expect(s).toMatchObject({ hostVersion: '1.0.0', ready: true, complete: false, defaultDir: '/Users/a/Downloads' });
    expect(s.components).toEqual([
      { name: 'helper', found: true, version: '1.0.0', path: '/x/ytm-host', source: 'bundled', error: null },
      { name: 'yt-dlp', found: true, version: '2026.10.21', path: '/opt/homebrew/bin/yt-dlp', source: 'homebrew', error: null },
      { name: 'deno', found: false, version: null, path: null, source: null, error: null },
      { name: 'ffmpeg', found: true, version: null, path: '/usr/local/bin/ffmpeg', source: 'path', error: 'UNKNOWN' },
    ]);
    expect(s.namePresets).toEqual([{ id: 'title-id', example: 'Title [x]' }]);
    expect(parseStatus({})).toMatchObject({ ready: false, complete: false, components: [], update: null });
    // complete 只在 ready 時成立。
    expect(parseStatus({ ready: false, complete: true }).complete).toBe(false);
  });

  it('getInfo：只取用到的欄位', () => {
    const info = parseInfo({ id: VID, title: 'T', duration: 19, formats: [{ id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360 }, { ext: 'x' }], subtitles: [{ lang: 'en', name: 'English' }] });
    expect(info.formats).toHaveLength(1);
    expect(info.formats[0]).toMatchObject({ id: '18', height: 360, filesize: null });
    expect(Object.keys(info).sort()).toEqual(['duration', 'formats', 'isLive', 'liveStatus', 'title']);
  });

  it('jobs：略過格式不對的工作', () => {
    const jobs = parseJobs({
      jobs: [
        { jobId: 'j1', videoId: VID, kind: 'video', state: 'done', fileName: 'a.mp4', missed: true },
        { jobId: 'j2', videoId: VID, kind: 'video', state: 'weird' },
      ],
    });
    expect(jobs).toEqual([{ jobId: 'j1', videoId: VID, kind: 'video', state: 'done', percent: null, speed: null, eta: null, fileName: 'a.mp4', error: null, missed: true }]);
  });
});

/** 假的原生訊息連接埠。 */
function fakePort() {
  const messageListeners: Array<(m: unknown) => void> = [];
  const disconnectListeners: Array<(p: unknown) => void> = [];
  const sent: Array<{ id: string; cmd: string; args?: unknown }> = [];
  const port: PortLike & { sent: typeof sent; reply(m: unknown): void; drop(): void } = {
    sent,
    postMessage: (m) => sent.push(m as { id: string; cmd: string }),
    disconnect: () => {},
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn) => disconnectListeners.push(fn) },
    reply: (m) => messageListeners.forEach((fn) => fn(m)),
    drop: () => disconnectListeners.forEach((fn) => fn(port)),
  };
  return port;
}

describe('NativeClient（T16）', () => {
  it('以 id 配對回應（回應順序可以與請求不同）', async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port });
    const a = client.request('status');
    const b = client.request('getInfo', { videoId: VID });
    expect(port.sent.map((m) => m.cmd)).toEqual(['status', 'getInfo']);
    expect(port.sent[1]!.args).toEqual({ videoId: VID });
    expect(new Set(port.sent.map((m) => m.id)).size).toBe(2);
    port.reply({ id: port.sent[1]!.id, ok: true, result: { title: 'B' } });
    port.reply({ id: port.sent[0]!.id, ok: false, error: { code: 'YTDLP_NOT_FOUND', message: 'm' } });
    await expect(b).resolves.toEqual({ title: 'B' });
    await expect(a).rejects.toMatchObject({ code: 'YTDLP_NOT_FOUND' });
  });

  it('請求 id 符合橋接程式的格式', () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port });
    void client.request('jobs').catch(() => {});
    expect(port.sent[0]!.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('事件交給 onEvent', () => {
    const port = fakePort();
    const onEvent = vi.fn();
    const client = new NativeClient({ connect: () => port, onEvent });
    client.connect();
    port.reply({ event: 'done', jobId: 'j1', videoId: VID, kind: 'video', path: '/a', fileName: 'a.mp4' });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'done', jobId: 'j1' }));
  });

  it('找不到橋接程式（連線立即中斷）時，進行中的請求以 HOST_UNREACHABLE 失敗', async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, lastError: () => 'Specified native messaging host not found.' });
    const p = client.request('status');
    port.drop();
    await expect(p).rejects.toBeInstanceOf(HostRequestError);
    await expect(p).rejects.toMatchObject({ code: 'HOST_UNREACHABLE', message: 'Specified native messaging host not found.' });
    expect(client.connected).toBe(false);
  });

  it('connectNative 丟出例外時以 HOST_UNREACHABLE 失敗', async () => {
    const client = new NativeClient({
      connect: () => {
        throw new Error('no native messaging');
      },
    });
    await expect(client.request('status')).rejects.toMatchObject({ code: 'HOST_UNREACHABLE' });
  });

  it('逾時', async () => {
    vi.useFakeTimers();
    const client = new NativeClient({ connect: () => fakePort() });
    const p = client.request('status', undefined, 1000);
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    vi.useRealTimers();
  });

  it('中斷後，有進行中的下載時自動重連（間隔遞增），重連後呼叫 onConnect', () => {
    vi.useFakeTimers();
    const ports: ReturnType<typeof fakePort>[] = [];
    let active = true;
    const onConnect = vi.fn();
    const client = new NativeClient({
      connect: () => {
        const p = fakePort();
        ports.push(p);
        return p;
      },
      onConnect,
      shouldReconnect: () => active,
    });
    client.connect();
    ports[0]!.reply({ id: 'x', ok: true, result: {} }); // 收到訊息：連線正常
    ports[0]!.drop();
    expect(client.connected).toBe(false);
    vi.advanceTimersByTime(999);
    expect(ports).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(ports).toHaveLength(2);
    expect(onConnect).toHaveBeenCalledTimes(2);
    // 新連線沒有收到任何訊息就中斷：下一次等更久
    ports[1]!.drop();
    vi.advanceTimersByTime(1000);
    expect(ports).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(ports).toHaveLength(3);
    // 沒有進行中的下載時不再重連
    active = false;
    ports[2]!.drop();
    vi.advanceTimersByTime(60_000);
    expect(ports).toHaveLength(3);
    vi.useRealTimers();
  });

  it('reconnectDelay：1、2、4、8、16、30 秒', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });
});
