// 時間範圍區塊（002 FR-20 至 FR-23、004 FR-20 至 FR-26）：影片與 MP3 面板共用同一個元件。
// 區間滑桿、「開始」「結束」輸入框、「與播放器同步」開關與「設為目前時間」按鈕。
// 兩個面板各自記住自己的時間範圍；換到另一部影片時重設為整部影片（004 FR-26）。
import { useEffect, useState } from 'preact/hooks';
import { t } from '@/utils/i18n';
import { formatTime, isFullRange, validateRange, type TimeError } from '@/utils/time';
import { findVideo } from '@/utils/youtube/dom';
import { player } from '@/utils/youtube/player';
import { RangeSlider } from '../controls/RangeSlider';
import { Switch } from '../controls/Switch';
import { TimeInput } from '../controls/TimeInput';
import { Icon } from '../icons';

export type RangeOwner = 'video' | 'mp3';

interface RangeState {
  videoId: string;
  /** 建立這個範圍時的影片長度（整數秒）。 */
  limit: number;
  range: readonly [number, number];
  startText: string;
  endText: string;
  sync: boolean;
}

/** 各面板記住的時間範圍（只在這個分頁中，換影片時重設）。 */
const remembered = new Map<RangeOwner, RangeState>();

const ERROR_KEYS = {
  format: 'timeErrorFormat',
  outOfRange: 'timeErrorOutOfRange',
  order: 'timeErrorOrder',
} as const satisfies Record<TimeError, string>;

const fresh = (videoId: string, limit: number, sync: boolean): RangeState => ({
  videoId,
  limit,
  range: [0, limit],
  startText: formatTime(0, true),
  endText: formatTime(limit, true),
  sync,
});

export interface ClipRange {
  /** 輸入都合法（FR-22、004 FR-25）。 */
  valid: boolean;
  /** 不是整部影片時的裁切範圍（整數秒）；整部影片或不合法時為 null（FR-21、004 FR-21）。 */
  section: { start: number; end: number } | null;
}

/** 時間範圍的狀態；duration 為影片長度（秒）。 */
export function useClipRange(owner: RangeOwner, videoId: string, duration: number) {
  const limit = Math.max(0, Math.floor(duration));
  const [state, setState] = useState<RangeState>(() => {
    const prev = remembered.get(owner);
    return prev && prev.videoId === videoId ? prev : fresh(videoId, limit, prev?.sync ?? false);
  });

  // 換到另一部影片時重設為整部影片。影片長度改變時（例如先用播放器的長度，之後取得 yt-dlp 的長度），
  // 原本是整部影片、或範圍超出新的長度，也重設為整部影片。
  useEffect(() => {
    setState((prev) => {
      if (prev.videoId !== videoId || prev.range[1] > limit) return fresh(videoId, limit, prev.sync);
      if (prev.limit !== limit && prev.range[0] === 0 && prev.range[1] === prev.limit) return fresh(videoId, limit, prev.sync);
      return prev;
    });
  }, [videoId, limit]);
  useEffect(() => {
    remembered.set(owner, state);
  }, [owner, state]);

  const check = validateRange(state.startText, state.endText, duration);
  const full = check.valid && isFullRange(check.start!, check.end!, duration);
  const clip: ClipRange = { valid: check.valid && limit > 0, section: check.valid && !full ? { start: check.start!, end: check.end! } : null };
  return { state, setState, check, limit, clip };
}

type ClipRangeHook = ReturnType<typeof useClipRange>;

const seek = (seconds: number) => {
  player.seekTo(seconds).catch(() => {
    const video = findVideo();
    if (video) video.currentTime = seconds;
  });
};

export function TimeRange({ id, hook }: { id: string; hook: ClipRangeHook }) {
  const { state, setState, check, limit } = hook;
  const known = limit > 0;
  const setRange = (range: readonly [number, number]) =>
    setState((prev) => ({ ...prev, range, startText: formatTime(range[0], true), endText: formatTime(range[1], true) }));
  const setNow = (which: 0 | 1) => {
    const now = Math.min(limit, Math.floor(findVideo()?.currentTime ?? 0));
    setRange(which === 0 ? [Math.min(now, state.range[1]), state.range[1]] : [state.range[0], Math.max(now, state.range[0])]);
  };

  const field = (which: 0 | 1) => {
    const error = which === 0 ? check.startError : check.endError;
    const fieldId = `${id}-${which === 0 ? 'start' : 'end'}`;
    return (
      <label class="ytm-field">
        <span class="ytm-clip-label">
          {t(which === 0 ? 'timeStart' : 'timeEnd')}
          {state.sync && (
            <button type="button" class="ytm-clip-now" data-which={which === 0 ? 'start' : 'end'} title={t('clipSetNow')} aria-label={t('clipSetNow')} onClick={() => setNow(which)}>
              <Icon name="my_location" size={16} />
            </button>
          )}
        </span>
        <TimeInput
          id={fieldId}
          value={state.range[which]}
          disabled={!known}
          invalid={!!error}
          errorId={`${fieldId}-error`}
          onInput={(seconds, text) =>
            setState((prev) => {
              const range: [number, number] = [prev.range[0], prev.range[1]];
              if (seconds !== null && seconds <= limit) range[which] = seconds;
              return { ...prev, range, [which === 0 ? 'startText' : 'endText']: text };
            })
          }
        />
        {error && (
          <span id={`${fieldId}-error`} class="ytm-field-error">
            {t(ERROR_KEYS[error])}
          </span>
        )}
      </label>
    );
  };

  return (
    <div class="ytm-clip" id={id}>
      <div class="ytm-clip-title">{t('clipTitle')}</div>
      <RangeSlider
        min={0}
        max={Math.max(limit, 1)}
        value={state.range}
        disabled={!known}
        startLabel={t('timeStart')}
        endLabel={t('timeEnd')}
        formatValue={(v) => formatTime(v)}
        onChange={setRange}
        onCommit={(value, thumb) => {
          // 與播放器同步時，拖動把手讓播放器跳到該時間點（002 FR-23）。
          if (state.sync) seek(value[thumb]);
        }}
      />
      <div class="ytm-range-labels">
        <span>{formatTime(0)}</span>
        <span>{known ? formatTime(limit) : '—'}</span>
      </div>
      <div class="ytm-time-fields">
        {field(0)}
        {field(1)}
      </div>
      <div class="ytm-clip-sync">
        <span id={`${id}-sync-label`}>{t('clipSync')}</span>
        <Switch checked={state.sync} labelledBy={`${id}-sync-label`} onChange={(sync) => setState((prev) => ({ ...prev, sync }))} />
      </div>
    </div>
  );
}
