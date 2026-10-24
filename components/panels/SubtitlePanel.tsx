// 字幕面板（002 FR-40 至 FR-45）：字幕清單分成「上傳的字幕」與「自動產生的字幕」兩組，可選擇檔案格式，
// 由擴充功能直接下載並轉換（不需要橋接程式）。直接下載失敗時，若橋接程式可用就改由 yt-dlp 下載（T21），
// 否則顯示錯誤並說明安裝橋接程式可改善（FR-44）。
import { useEffect, useMemo, useState } from 'preact/hooks';
import { currentTitle, sendToBackground } from '@/features/downloads/content';
import { checkHostStatus, HostError, startDownload } from '@/features/downloads/host-client';
import { canDownload } from '@/features/downloads/host-status';
import type { JobRecord } from '@/features/downloads/jobs';
import { orderCaptions } from '@/features/downloads/logic';
import { CAPTION_FORMATS, type CaptionFormat } from '@/utils/filename';
import { t, type MessageKey } from '@/utils/i18n';
import type { CaptionTrack } from '@/utils/youtube/dom';
import { player } from '@/utils/youtube/player';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';
import { Icon } from '../icons';
import { ErrorBlock, JobList } from './JobList';
import { PanelError, PanelLoading } from './PanelStatus';
import { isLiveOrUpcoming, useVideoData } from './useVideoData';

const FORMAT_LABELS: Record<CaptionFormat, MessageKey> = {
  srt: 'subtitlesFormatSrt',
  vtt: 'subtitlesFormatVtt',
  txt: 'subtitlesFormatTxt',
};
const SAVED_MS = 2500;

type TracksState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; tracks: CaptionTrack[] };
type DownloadState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  /** 直接下載失敗，橋接程式也無法使用。 */
  | { state: 'failed' }
  /** 直接下載失敗，已改由橋接程式（yt-dlp）下載（T21）。 */
  | { state: 'viaHost' }
  /** 改用橋接程式時失敗。 */
  | { state: 'hostFailed'; code: JobRecord['error'] };

const trackId = (track: CaptionTrack) => `${track.isAuto ? 'auto' : 'up'}-${track.languageCode}-${track.url.length}`;

export function SubtitlePanel({ videoId }: { videoId: string }) {
  const [attempt, setAttempt] = useState(0);
  const video = useVideoData(videoId, attempt);
  const [tracks, setTracks] = useState<TracksState>({ status: 'loading' });
  /** 使用者選擇的字幕；還沒選時使用預設（FR-43）。 */
  const [chosen, setChosen] = useState<CaptionTrack | null>(null);
  const [format, setFormat] = useState<CaptionFormat>('srt');
  const [download, setDownload] = useState<DownloadState>({ state: 'idle' });

  useEffect(() => {
    let current = true;
    setTracks({ status: 'loading' });
    setChosen(null);
    setDownload({ state: 'idle' });
    player
      .getCaptionTracks()
      .then((list) => current && setTracks({ status: 'ready', tracks: list }))
      .catch(() => current && setTracks({ status: 'error' }));
    return () => {
      current = false;
    };
  }, [videoId, attempt]);

  const ordered = useMemo(
    () => (tracks.status === 'ready' ? orderCaptions(tracks.tracks, browser.i18n.getUILanguage() || navigator.language) : null),
    [tracks],
  );
  const selected = chosen ?? ordered?.selected ?? null;

  useEffect(() => {
    if (download.state !== 'saved') return;
    const timer = setTimeout(() => setDownload({ state: 'idle' }), SAVED_MS);
    return () => clearTimeout(timer);
  }, [download]);

  if (video.status === 'loading' || tracks.status === 'loading') return <PanelLoading />;
  if (video.status === 'error' || tracks.status === 'error') return <PanelError onRetry={() => setAttempt((n) => n + 1)} />;
  if (isLiveOrUpcoming(video.data)) return <p class="ytm-muted">{t('liveUnavailable')}</p>;
  if (!ordered || tracks.tracks.length === 0) return <p class="ytm-muted">{t('subtitlesNone')}</p>;

  const start = async () => {
    if (!selected) return;
    setDownload({ state: 'saving' });
    const title = await currentTitle(videoId);
    const res = await sendToBackground({
      type: 'downloadCaption',
      videoId,
      title,
      languageCode: selected.languageCode,
      url: selected.url,
      format,
    });
    if (res.ok) {
      setDownload({ state: 'saved' });
      return;
    }
    // 直接下載失敗：橋接程式可用時改由 yt-dlp 下載（FR-44，T21），存到設定頁指定的下載資料夾（FR-45）。
    const host = await checkHostStatus();
    if (!canDownload(host)) {
      setDownload({ state: 'failed' });
      return;
    }
    try {
      await startDownload({
        kind: 'subtitle',
        videoId,
        title,
        label: `${selected.name} ${format.toUpperCase()}`,
        subLang: selected.languageCode,
        subFormat: format,
        subAuto: selected.isAuto,
      });
      setDownload({ state: 'viaHost' });
    } catch (err) {
      setDownload({ state: 'hostFailed', code: err instanceof HostError ? err.code : 'UNKNOWN' });
    }
  };

  const group = (key: 'uploaded' | 'auto', title: MessageKey) => {
    const list = ordered.groups[key];
    if (list.length === 0) return null;
    return (
      <fieldset class="ytm-fieldset ytm-subs-group" data-group={key}>
        <legend class="ytm-subs-legend">{t(title)}</legend>
        {list.map((track) => (
          <label key={trackId(track)} class="ytm-radio ytm-subs-track" data-lang={track.languageCode} data-auto={track.isAuto ? '' : undefined}>
            <input type="radio" name="ytm-subs-track" checked={selected === track} onChange={() => setChosen(track)} />
            <span>{track.name}</span>
            {track.isAuto && (
              <span class="ytm-subs-auto" title={t('subtitlesAutoBadge')} aria-label={t('subtitlesAutoBadge')}>
                <Icon name="graphic_eq" size={18} />
              </span>
            )}
          </label>
        ))}
      </fieldset>
    );
  };

  return (
    <div class="ytm-subs">
      <div class="ytm-subs-list">
        {group('uploaded', 'subtitlesUploaded')}
        {group('auto', 'subtitlesAuto')}
      </div>
      <div class="ytm-subs-footer">
        <label class="ytm-field ytm-subs-format">
          <span>{t('subtitlesFormat')}</span>
          <Select
            id="ytm-subs-format"
            value={format}
            options={CAPTION_FORMATS.map((value) => ({ value, label: t(FORMAT_LABELS[value]) }))}
            onChange={setFormat}
          />
        </label>
        <Button variant="primary" disabled={!selected || download.state === 'saving'} onClick={() => void start()}>
          <Icon name="download" size={18} />
          <span>{t('download')}</span>
        </Button>
      </div>
      <p class="ytm-subs-status" aria-live="polite">
        {download.state === 'saved' && (
          <span class="ytm-subs-saved">
            <Icon name="check" size={18} />
            {t('downloadSaved')}
          </span>
        )}
      </p>
      {download.state === 'viaHost' && (
        <p class="ytm-hint ytm-subs-via-host" role="status">
          {t('subtitlesViaHost')}
        </p>
      )}
      {download.state === 'hostFailed' && <ErrorBlock code={download.code} onRetry={() => void start()} />}
      <JobList videoId={videoId} kind="subtitle" />
      {download.state === 'failed' && (
        <div class="ytm-status ytm-status-error ytm-subs-error" role="alert">
          <Icon name="error" />
          <span>{t('subtitlesDirectFailed')}</span>
          <Button variant="secondary" onClick={() => void start()}>
            <Icon name="refresh" size={18} />
            <span>{t('retry')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
