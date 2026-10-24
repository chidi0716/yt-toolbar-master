// 內容腳本（isolated world）與頁面橋接腳本（main world）之間的事件協定（plan 3.5）。
//
// - 兩邊以 document 上的 CustomEvent 溝通，detail 一律是 JSON 字串
//   （字串可以安全跨越 Firefox 的 Xray 邊界）。
// - 只接受固定的幾種請求，其他一律忽略。頁面上的其他程式也能發出同名事件，
//   所以每種操作都必須是無害的：讀取影片資料與字幕清單、讀取/設定音量、跳轉、讀取/設定畫質與語音軌，
//   以及在 YouTube 外觀子選單的選項上加上標記屬性（markThemeOptions，不點擊、不帶參數）。
import {
  AUDIO_TRACK_ID_PATTERN,
  AUTO_QUALITY,
  isQualityCode,
  markThemeOptions,
  readAudioTracks,
  readCaptionTracks,
  readAvailableQualities,
  readCurrentTime,
  readQuality,
  readVideoData,
  readVolume,
  writeAudioTrack,
  writeQuality,
  writeSeek,
  writeVolume,
  type AudioTrackInfo,
  type CaptionTrack,
  type QualityCode,
  type VideoData,
  type YtAudioApi,
  type YtPlayerApi,
  type YtQualityApi,
} from './dom';

export const BRIDGE_REQUEST_EVENT = 'ytm-bridge:request';
export const BRIDGE_RESPONSE_EVENT = 'ytm-bridge:response';

/**
 * 不帶參數的請求。getAvailableQualities、getQuality：鎖定畫質（004 第 1 節、plan 3.5）；getAudioTracks：原始語音
 * （005 FR-10、plan 3.7.2）；getCaptionTracks：字幕直接下載（002 FR-44、plan 3.8），回傳的字幕網址只有 youtube.com 網域。
 */
const PLAIN_REQUESTS = [
  'getVideoData',
  'getVolume',
  'getCurrentTime',
  'markThemeOptions',
  'getAvailableQualities',
  'getQuality',
  'getAudioTracks',
  'getCaptionTracks',
] as const;

export type BridgeRequest =
  | { id: string; type: (typeof PLAIN_REQUESTS)[number] }
  | { id: string; type: 'setVolume'; volume: number }
  | { id: string; type: 'seekTo'; seconds: number }
  // setQuality 只接受 YouTube 畫質代號白名單與 auto。
  | { id: string; type: 'setQuality'; quality: QualityCode | typeof AUTO_QUALITY }
  // setAudioTrack 只接受目前清單中存在的語音軌 ID。
  | { id: string; type: 'setAudioTrack'; trackId: string };

export type BridgeRequestType = BridgeRequest['type'];

export interface BridgeResults {
  getVideoData: VideoData | null;
  getVolume: { volume: number; muted: boolean };
  setVolume: null;
  seekTo: null;
  getCurrentTime: number;
  getAvailableQualities: QualityCode[];
  getQuality: QualityCode | null;
  setQuality: null;
  getAudioTracks: { tracks: AudioTrackInfo[]; current: string | null };
  /** 是否已切換（清單中沒有這個 ID 時為 false）。 */
  setAudioTrack: boolean;
  markThemeOptions: { dark: boolean; light: boolean };
  getCaptionTracks: CaptionTrack[];
}

/** 頁面橋接腳本會用到的播放器方法。 */
export type BridgePlayer = YtPlayerApi & YtQualityApi & YtAudioApi;

/** 切換語音軌後播放位置被移動超過這個秒數時，跳回原本的位置（005 FR-13）。 */
const AUDIO_SWITCH_SEEK_TOLERANCE = 2;

export type BridgeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: BridgeError };

export type BridgeError = 'NO_PLAYER' | 'FAILED';

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 驗證請求；不合法時回傳 null（直接忽略，不回覆）。 */
export function parseBridgeRequest(raw: unknown): BridgeRequest | null {
  const obj = parseJson(raw);
  if (!obj || typeof obj.id !== 'string' || !ID_PATTERN.test(obj.id)) return null;
  const id = obj.id;
  if ((PLAIN_REQUESTS as readonly unknown[]).includes(obj.type)) return { id, type: obj.type as (typeof PLAIN_REQUESTS)[number] };
  switch (obj.type) {
    case 'setAudioTrack':
      return typeof obj.trackId === 'string' && AUDIO_TRACK_ID_PATTERN.test(obj.trackId)
        ? { id, type: 'setAudioTrack', trackId: obj.trackId }
        : null;
    case 'setQuality':
      return isQualityCode(obj.quality) || obj.quality === AUTO_QUALITY
        ? { id, type: 'setQuality', quality: obj.quality }
        : null;
    case 'setVolume':
      return isFiniteNumber(obj.volume) && obj.volume >= 0 && obj.volume <= 100
        ? { id, type: 'setVolume', volume: obj.volume }
        : null;
    case 'seekTo':
      return isFiniteNumber(obj.seconds) && obj.seconds >= 0
        ? { id, type: 'seekTo', seconds: obj.seconds }
        : null;
    default:
      return null;
  }
}

export function parseBridgeResponse(raw: unknown): BridgeResponse | null {
  const obj = parseJson(raw);
  if (!obj || typeof obj.id !== 'string' || typeof obj.ok !== 'boolean') return null;
  if (obj.ok) return { id: obj.id, ok: true, result: obj.result ?? null };
  return { id: obj.id, ok: false, error: obj.error === 'NO_PLAYER' ? 'NO_PLAYER' : 'FAILED' };
}

/**
 * main world 端：執行請求並產生回應。player 為 null 表示找不到播放器（播放器相關的請求回覆 NO_PLAYER）。
 * doc 是外觀選單所在的文件（markThemeOptions 用，不需要播放器）。
 */
export function handleBridgeRequest(req: BridgeRequest, player: BridgePlayer | null, doc?: Document): BridgeResponse {
  if (req.type === 'markThemeOptions') {
    try {
      return { id: req.id, ok: true, result: doc ? markThemeOptions(doc) : { dark: false, light: false } };
    } catch {
      return { id: req.id, ok: false, error: 'FAILED' };
    }
  }
  if (!player) return { id: req.id, ok: false, error: 'NO_PLAYER' };
  try {
    switch (req.type) {
      case 'getVideoData':
        return { id: req.id, ok: true, result: readVideoData(player) };
      case 'getVolume':
        return { id: req.id, ok: true, result: readVolume(player) };
      case 'getCurrentTime':
        return { id: req.id, ok: true, result: readCurrentTime(player) };
      case 'setVolume':
        writeVolume(player, Math.round(req.volume));
        return { id: req.id, ok: true, result: null };
      case 'seekTo':
        writeSeek(player, req.seconds);
        return { id: req.id, ok: true, result: null };
      case 'getAvailableQualities':
        return { id: req.id, ok: true, result: readAvailableQualities(player) };
      case 'getQuality':
        return { id: req.id, ok: true, result: readQuality(player) };
      case 'setQuality':
        writeQuality(player, req.quality);
        return { id: req.id, ok: true, result: null };
      case 'getAudioTracks':
        return { id: req.id, ok: true, result: readAudioTracks(player) };
      case 'getCaptionTracks':
        return { id: req.id, ok: true, result: readCaptionTracks(player as { getPlayerResponse?: () => unknown }) };
      case 'setAudioTrack': {
        // 切換時影片繼續播放，不得跳回開頭（005 FR-13）。
        const before = readCurrentTime(player);
        const switched = writeAudioTrack(player, req.trackId);
        if (switched && Math.abs(readCurrentTime(player) - before) > AUDIO_SWITCH_SEEK_TOLERANCE) writeSeek(player, before);
        return { id: req.id, ok: true, result: switched };
      }
    }
  } catch {
    return { id: req.id, ok: false, error: 'FAILED' };
  }
}
