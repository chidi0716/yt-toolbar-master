// 影片面板（002 FR-10 至 FR-15、004 第 3 節，tasks T19）與 MP3 面板（002 FR-20 至 FR-24，tasks T20）。
// 兩者都需要橋接程式：未連線或缺少元件時顯示安裝說明（FR-2）；直播與尚未開始的影片顯示無法下載（FR-1）。
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { getInfo, HostError, startDownload } from '@/features/downloads/host-client';
import { canDownload, missingOnlyDeno } from '@/features/downloads/host-status';
import { MP3_BITRATES, type DownloadRequest, type JobRecord, type Mp3Bitrate } from '@/features/downloads/jobs';
import { buildQualityList, formatSize, sizeForSection, visibleRows, type QualityRow } from '@/utils/format-list';
import { t } from '@/utils/i18n';
import type { HostInfo } from '@/utils/native-protocol';
import { clipHintSeen, mp3Bitrate } from '@/utils/settings';
import { findVideo } from '@/utils/youtube/dom';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';
import { Icon } from '../icons';
import { PanelPinContext } from '../toolbar/PanelHost';
import { DenoHint, HostSetup, UpdateFailureHint, useHostState } from './HostSetup';
import { ErrorBlock, JobList, openSettings } from './JobList';
import { PanelError, PanelLoading } from './PanelStatus';
import { TimeRange, useClipRange } from './TimeRange';
import { isLiveOrUpcoming, useVideoData } from './useVideoData';

const isLiveInfo = (info: HostInfo) => info.isLive || info.liveStatus === 'is_live' || info.liveStatus === 'is_upcoming';

/** 共通：直播檢查、橋接程式狀態、只缺 deno 的提示。 */
function DownloadGate({ videoId, children }: { videoId: string; children: (title: string) => ComponentChildren }) {
  const [attempt, setAttempt] = useState(0);
  const video = useVideoData(videoId, attempt);
  const host = useHostState({ pollWhileMissing: true });
  if (video.status === 'loading' || host.state === null) return <PanelLoading />;
  if (video.status === 'error') return <PanelError onRetry={() => setAttempt((n) => n + 1)} />;
  if (isLiveOrUpcoming(video.data)) return <p class="ytm-muted ytm-live-unavailable">{t('liveUnavailable')}</p>;
  if (!canDownload(host.state)) return <HostSetup state={host.state} checking={host.checking} recheck={host.recheck} />;
  return (
    <>
      {missingOnlyDeno(host.state) && <DenoHint state={host.state} />}
      <UpdateFailureHint state={host.state} onOpenSettings={openSettings} />
      {children(video.data?.title ?? '')}
    </>
  );
}

/** 使用播放器的影片長度（取得 getInfo 前也能操作時間範圍）。 */
function usePlayerDuration(): number {
  const [duration, setDuration] = useState(() => findVideo()?.duration ?? Number.NaN);
  useEffect(() => {
    const video = findVideo();
    if (!video) return;
    const update = () => setDuration(video.duration);
    update();
    video.addEventListener('durationchange', update);
    return () => video.removeEventListener('durationchange', update);
  }, []);
  return duration;
}

/** 開始下載；失敗時回傳錯誤代碼。 */
async function begin(request: DownloadRequest): Promise<JobRecord['error']> {
  try {
    await startDownload(request);
    return null;
  } catch (err) {
    return err instanceof HostError ? err.code : 'UNKNOWN';
  }
}

// ---------------------------------------------------------------------------
// 影片
// ---------------------------------------------------------------------------

function QualityList({ videoId, pageTitle }: { videoId: string; pageTitle: string }) {
  const [attempt, setAttempt] = useState(0);
  const [info, setInfo] = useState<{ status: 'loading' } | { status: 'error'; code: JobRecord['error'] } | { status: 'ready'; info: HostInfo }>({ status: 'loading' });
  const [showAll, setShowAll] = useState(false);
  const [startError, setStartError] = useState<JobRecord['error']>(null);
  const [hintSeen, setHintSeen] = useState(true);
  const playerDuration = usePlayerDuration();

  useEffect(() => {
    let current = true;
    setInfo({ status: 'loading' });
    getInfo(videoId).then(
      (i) => current && setInfo({ status: 'ready', info: i }),
      (err: unknown) => current && setInfo({ status: 'error', code: err instanceof HostError ? err.code : 'UNKNOWN' }),
    );
    return () => {
      current = false;
    };
  }, [videoId, attempt]);
  useEffect(() => {
    void clipHintSeen.getValue().then((v) => setHintSeen(v === true));
  }, []);

  const duration = info.status === 'ready' && info.info.duration ? info.info.duration : playerDuration;
  const clip = useClipRange('video', videoId, Number.isFinite(duration) ? duration : 0);
  const rows = useMemo(() => (info.status === 'ready' ? buildQualityList(info.info.formats) : []), [info]);

  if (info.status === 'loading') return <PanelLoading />;
  if (info.status === 'error') return <ErrorBlock code={info.code} onRetry={() => setAttempt((n) => n + 1)} />;
  if (isLiveInfo(info.info)) return <p class="ytm-muted ytm-live-unavailable">{t('liveUnavailable')}</p>;

  const section = clip.clip.section;
  const download = async (row: QualityRow) => {
    setStartError(null);
    if (section && !hintSeen) {
      setHintSeen(true);
      void clipHintSeen.setValue(true);
    }
    const label = `${row.resolution} ${row.container.toUpperCase()}`;
    const error = await begin({
      kind: 'video',
      videoId,
      title: info.info.title || pageTitle,
      label: section ? `${label} ${formatRange(section)}` : label,
      formatId: row.formatId,
      container: row.container,
      section,
    });
    setStartError(error);
  };
  const shown = visibleRows(rows, showAll);
  const hasMore = rows.some((r) => r.container !== 'mp4');

  return (
    <div class="ytm-video">
      <TimeRange id="ytm-video-clip" hook={clip} />
      {section && !hintSeen && (
        <p class="ytm-hint ytm-clip-hint" role="note">
          {t('clipSlowHint')}
        </p>
      )}
      {rows.length === 0 ? (
        <p class="ytm-muted">{t('qualityNone')}</p>
      ) : (
        <ul class="ytm-list ytm-quality-list">
          {shown.map((row) => {
            const { size, approx } = sizeForSection(row, section, duration);
            return (
              <li key={row.key}>
                <button
                  type="button"
                  class="ytm-list-row ytm-quality-row"
                  data-format={row.formatId}
                  data-limited={row.limited ? '' : undefined}
                  disabled={!clip.clip.valid}
                  onClick={() => void download(row)}
                >
                  <span class="ytm-quality-container">{row.container.toUpperCase()}</span>
                  <span class="ytm-quality-resolution">
                    {row.resolution}
                    {row.hdr ? ' HDR' : ''}
                  </span>
                  <span class="ytm-quality-badge">{row.badge && <span class="ytm-badge">{row.badge}</span>}</span>
                  <span class="ytm-quality-size">{formatSize(size, approx, t('sizeApprox'))}</span>
                  {row.limited && <span class="ytm-quality-note">{t('qualityLimited')}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <button type="button" class="ytm-link ytm-more-formats" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
          <Icon name={showAll ? 'expand_less' : 'expand_more'} size={20} />
          <span>{showAll ? t('qualityFewer') : t('qualityMore')}</span>
        </button>
      )}
      {startError && <ErrorBlock code={startError} onRetry={null} />}
      <JobList videoId={videoId} kind="video" />
    </div>
  );
}

/** 檔名與標籤中的時間範圍（例如 01:00–01:30）。 */
function formatRange(section: { start: number; end: number }): string {
  const f = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  };
  return `${f(section.start)}–${f(section.end)}`;
}

export function VideoPanel({ videoId }: { videoId: string }) {
  return <DownloadGate videoId={videoId}>{(title) => <QualityList videoId={videoId} pageTitle={title} />}</DownloadGate>;
}

// ---------------------------------------------------------------------------
// MP3
// ---------------------------------------------------------------------------

const isBitrate = (v: unknown): v is Mp3Bitrate => (MP3_BITRATES as readonly unknown[]).includes(v);

function Mp3Options({ videoId, pageTitle }: { videoId: string; pageTitle: string }) {
  const [bitrate, setBitrate] = useState<Mp3Bitrate>(192);
  const [startError, setStartError] = useState<JobRecord['error']>(null);
  const [starting, setStarting] = useState(false);
  const pin = useContext(PanelPinContext);
  const duration = usePlayerDuration();
  const clip = useClipRange('mp3', videoId, Number.isFinite(duration) ? duration : 0);

  useEffect(() => {
    void mp3Bitrate.getValue().then((v) => isBitrate(v) && setBitrate(v));
  }, []);

  const download = async () => {
    setStarting(true);
    const section = clip.clip.section;
    const error = await begin({
      kind: 'mp3',
      videoId,
      title: pageTitle,
      label: `MP3 ${bitrate} kbps${section ? ` ${formatRange(section)}` : ''}`,
      bitrate,
      section,
    });
    setStartError(error);
    setStarting(false);
  };

  return (
    <div class="ytm-mp3">
      <label class="ytm-field ytm-mp3-bitrate">
        <span>{t('mp3Bitrate')}</span>
        <Select
          id="ytm-mp3-bitrate"
          value={String(bitrate)}
          options={MP3_BITRATES.map((b) => ({ value: String(b), label: `${b} kbps` }))}
          onChange={(v) => {
            const b = Number(v);
            if (!isBitrate(b)) return;
            setBitrate(b);
            void mp3Bitrate.setValue(b);
          }}
        />
      </label>
      <TimeRange id="ytm-mp3-clip" hook={clip} />
      <div class="ytm-mp3-footer">
        {pin && (
          <Button variant="secondary" onClick={pin.pinned ? pin.unpin : pin.pin}>
            <Icon name={pin.pinned ? 'keep_off' : 'keep'} size={18} />
            <span>{pin.pinned ? t('panelUnpin') : t('panelPin')}</span>
          </Button>
        )}
        <Button variant="primary" disabled={!clip.clip.valid || starting} onClick={() => void download()}>
          <Icon name="download" size={18} />
          <span>{t('download')}</span>
        </Button>
      </div>
      {startError && <ErrorBlock code={startError} onRetry={() => void download()} />}
      <JobList videoId={videoId} kind="mp3" />
    </div>
  );
}

export function Mp3Panel({ videoId }: { videoId: string }) {
  return <DownloadGate videoId={videoId}>{(title) => <Mp3Options videoId={videoId} pageTitle={title} />}</DownloadGate>;
}
