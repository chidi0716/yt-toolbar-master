// 循環播放面板（003 FR-50 至 FR-53）。
import { useEffect, useState } from 'preact/hooks';
import { MAX_TIMES, MIN_TIMES, type LoopConfig } from '@/features/viewing/loop-logic';
import type { LoopController } from '@/features/viewing/loop';
import { t } from '@/utils/i18n';
import { formatTime, validateRange, type TimeError } from '@/utils/time';
import { findVideo } from '@/utils/youtube/dom';
import { Button } from '../controls/Button';
import { RangeSlider } from '../controls/RangeSlider';
import { TimeInput } from '../controls/TimeInput';
import { useStore } from './useStore';

/** 目前影片的長度（秒）；中繼資料載入後更新。 */
function useDuration(): number {
  const [duration, setDuration] = useState(() => findVideo()?.duration ?? Number.NaN);
  useEffect(() => {
    const video = findVideo();
    if (!video) return;
    const update = () => setDuration(video.duration);
    update();
    video.addEventListener('durationchange', update);
    video.addEventListener('loadedmetadata', update);
    return () => {
      video.removeEventListener('durationchange', update);
      video.removeEventListener('loadedmetadata', update);
    };
  }, []);
  return duration;
}

const ERROR_KEYS = {
  format: 'timeErrorFormat',
  outOfRange: 'timeErrorOutOfRange',
  order: 'timeErrorOrder',
} as const satisfies Record<TimeError, string>;

function parseTimes(text: string): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= MIN_TIMES && n <= MAX_TIMES ? n : null;
}

export function LoopPanel({ loop }: { loop: LoopController }) {
  const status = useStore(loop.status);
  const duration = useDuration();
  const known = Number.isFinite(duration) && duration > 0;
  const limit = known ? Math.floor(duration) : 0;

  const [mode, setMode] = useState<'repeat' | 'segment'>(status.config?.mode ?? 'repeat');
  const [timesText, setTimesText] = useState('3');
  const [infinite, setInfinite] = useState(false);
  const [range, setRange] = useState<readonly [number, number]>([0, limit]);
  const [startText, setStartText] = useState(() => formatTime(0, true));
  const [endText, setEndText] = useState(() => formatTime(limit, true));

  // 影片長度第一次取得時，把片段預設為整部影片。
  useEffect(() => {
    if (!known) return;
    setRange((prev) => (prev[1] === 0 || prev[1] > limit ? [Math.min(prev[0], limit), limit] : prev));
    setEndText((prev) => (prev === formatTime(0, true) ? formatTime(limit, true) : prev));
  }, [known, limit]);

  const times = infinite ? null : parseTimes(timesText);
  const segment = validateRange(startText, endText, duration);
  const config: LoopConfig | null =
    mode === 'repeat'
      ? infinite || times !== null
        ? { mode: 'repeat', times }
        : null
      : segment.valid
        ? { mode: 'segment', start: segment.start!, end: segment.end! }
        : null;
  const canStart = known && config !== null;

  const setRangeAndText = (next: readonly [number, number]) => {
    setRange(next);
    setStartText(formatTime(next[0], true));
    setEndText(formatTime(next[1], true));
  };

  return (
    <div class="ytm-loop">
      <fieldset class="ytm-fieldset">
        <legend class="ytm-visually-hidden">{t('loopModeLabel')}</legend>

        <label class="ytm-radio">
          <input type="radio" name="ytm-loop-mode" checked={mode === 'repeat'} onChange={() => setMode('repeat')} />
          <span>{t('loopModeRepeat')}</span>
        </label>
        <div class="ytm-loop-option" data-disabled={mode !== 'repeat' ? '' : undefined}>
          <input
            id="ytm-loop-times"
            class="ytm-input ytm-number-input"
            type="number"
            inputMode="numeric"
            min={MIN_TIMES}
            max={MAX_TIMES}
            aria-label={t('loopTimesLabel')}
            aria-invalid={mode === 'repeat' && !infinite && times === null ? 'true' : undefined}
            disabled={mode !== 'repeat' || infinite}
            value={timesText}
            onInput={(e) => setTimesText((e.currentTarget as HTMLInputElement).value)}
          />
          <span>{t('loopTimesUnit')}</span>
          <label class="ytm-checkbox">
            <input
              type="checkbox"
              checked={infinite}
              disabled={mode !== 'repeat'}
              onChange={(e) => setInfinite((e.currentTarget as HTMLInputElement).checked)}
            />
            <span>{t('loopInfinite')}</span>
          </label>
        </div>
        {mode === 'repeat' && !infinite && times === null && <p class="ytm-field-error">{t('loopTimesError')}</p>}

        <label class="ytm-radio">
          <input type="radio" name="ytm-loop-mode" checked={mode === 'segment'} onChange={() => setMode('segment')} />
          <span>{t('loopModeSegment')}</span>
        </label>
        <div class="ytm-loop-option ytm-loop-segment" data-disabled={mode !== 'segment' ? '' : undefined}>
          <RangeSlider
            min={0}
            max={Math.max(limit, 1)}
            value={range}
            disabled={mode !== 'segment' || !known}
            startLabel={t('timeStart')}
            endLabel={t('timeEnd')}
            formatValue={(v) => formatTime(v)}
            onChange={setRangeAndText}
          />
          <div class="ytm-range-labels">
            <span>{formatTime(0)}</span>
            <span>{known ? formatTime(duration) : '—'}</span>
          </div>
          <div class="ytm-time-fields">
            <label class="ytm-field">
              <span>{t('timeStart')}</span>
              <TimeInput
                id="ytm-loop-start"
                value={range[0]}
                disabled={mode !== 'segment' || !known}
                invalid={mode === 'segment' && !!segment.startError}
                errorId="ytm-loop-start-error"
                onInput={(seconds, text) => {
                  setStartText(text);
                  if (seconds !== null && seconds <= limit) setRange([seconds, range[1]]);
                }}
              />
              {mode === 'segment' && segment.startError && (
                <span id="ytm-loop-start-error" class="ytm-field-error">
                  {t(ERROR_KEYS[segment.startError])}
                </span>
              )}
            </label>
            <label class="ytm-field">
              <span>{t('timeEnd')}</span>
              <TimeInput
                id="ytm-loop-end"
                value={range[1]}
                disabled={mode !== 'segment' || !known}
                invalid={mode === 'segment' && !!segment.endError}
                errorId="ytm-loop-end-error"
                onInput={(seconds, text) => {
                  setEndText(text);
                  if (seconds !== null && seconds <= limit) setRange([range[0], seconds]);
                }}
              />
              {mode === 'segment' && segment.endError && (
                <span id="ytm-loop-end-error" class="ytm-field-error">
                  {t(ERROR_KEYS[segment.endError])}
                </span>
              )}
            </label>
          </div>
        </div>
      </fieldset>

      <div class="ytm-loop-footer">
        <span class="ytm-loop-status" role="status" aria-live="polite">
          {status.running || status.played > 0 ? t('loopPlayedCount', String(status.played)) : ''}
        </span>
        <div class="ytm-loop-actions">
          <Button variant="secondary" disabled={!status.running} onClick={() => loop.end()}>
            {t('loopStop')}
          </Button>
          <Button variant="primary" disabled={!canStart} onClick={() => config && loop.begin(config)}>
            {t('loopStart')}
          </Button>
        </div>
      </div>
    </div>
  );
}
