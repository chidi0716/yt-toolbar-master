// 影片面板（002 FR-10 至 FR-15、004 第 3 節，tasks T19）與 MP3 面板（002 FR-20 至 FR-24，tasks T20）。
// 兩者都需要橋接程式：未連線或缺少元件時顯示安裝說明（FR-2）；直播與尚未開始的影片顯示無法下載（FR-1）。
// 一鍵下載（009 第一節，tasks T53）：開啟時點按鈕就以預設值直接開始，面板顯示這次的下載與「改用其他畫質」。
// 尚未安裝小幫手時只顯示安裝引導，偵測到安裝完成後顯示「開始下載」按鈕，不自動開始（009 第二節，tasks T54）。
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cancelJob, downloadJobs, getInfo, HostError, quickSettings, startDownload, startQuickDownload } from '@/features/downloads/host-client';
import { canDownload, missingOnlyDeno } from '@/features/downloads/host-status';
import { isActive, isMp3Bitrate, MP3_BITRATES, mp3Label, videoLabel, type DownloadRequest, type JobRecord, type Mp3Bitrate } from '@/features/downloads/jobs';
import { existingQuickJob, initialDownloadMode, quickSummary, videoSpecLabel, type DownloadMode, type QuickKind } from '@/features/downloads/quick';
import { buildQualityList, formatSize, sizeForSection, visibleRows, type QualityRow } from '@/utils/format-list';
import { t } from '@/utils/i18n';
import { isLiveInfo, type HostInfo } from '@/utils/native-protocol';
import { clipHintSeen, mp3Bitrate } from '@/utils/settings';
import { formatRange } from '@/utils/time';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';
import { Icon } from '../icons';
import { PanelPinContext } from '../toolbar/PanelHost';
import { DenoHint, HostSetup, UpdateFailureHint, useHostState } from './HostSetup';
import { openSettings } from '@/utils/messages';
import { ErrorBlock, JobList, JobRow, OtherJobs } from './JobList';
import { PanelError, PanelLoading } from './PanelStatus';
import { TimeRange, useClipRange } from './TimeRange';
import { useStore } from './useStore';
import { isLiveOrUpcoming, useDuration, useVideoData } from './useVideoData';

/**
 * 共通：直播檢查、橋接程式狀態、只缺 deno 的提示。children 的第二個參數表示這次打開面板時小幫手還不能使用、
 * 之後才偵測到（009 FR-11：顯示「小幫手已安裝完成」）。
 */
function DownloadGate({ videoId, children }: { videoId: string; children: (title: string, installed: boolean) => ComponentChildren }) {
  const [attempt, setAttempt] = useState(0);
  const video = useVideoData(videoId, attempt);
  const host = useHostState();
  const settings = useStore(quickSettings());
  const shownSetup = useRef(false);
  if (video.status === 'loading' || host.state === null || settings === null) return <PanelLoading />;
  if (video.status === 'error') return <PanelError onRetry={() => setAttempt((n) => n + 1)} />;
  if (isLiveOrUpcoming(video.data)) return <p class="ytm-muted ytm-live-unavailable">{t('liveUnavailable')}</p>;
  if (!canDownload(host.state)) {
    // 只顯示安裝引導，不記住、也不自動開始這次下載（009 FR-10）。
    shownSetup.current = true;
    return <HostSetup host={{ ...host, state: host.state }} />;
  }
  return (
    <>
      {missingOnlyDeno(host.state) && <DenoHint />}
      <UpdateFailureHint state={host.state} onOpenSettings={openSettings} />
      {children(video.data?.title ?? '', shownSetup.current)}
      <OtherJobs videoId={videoId} />
    </>
  );
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
  const playerDuration = useDuration();

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
    const label = videoLabel(row);
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
                  {row.limited && <span class="ytm-quality-note">{t('qualityLimited', row.limitedCodec ?? 'AV1')}</span>}
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

export function VideoPanel({ videoId }: { videoId: string }) {
  return <DownloadPanel videoId={videoId} kind="video" />;
}

// ---------------------------------------------------------------------------
// MP3
// ---------------------------------------------------------------------------

function Mp3Options({ videoId, pageTitle }: { videoId: string; pageTitle: string }) {
  const [bitrate, setBitrate] = useState<Mp3Bitrate>(192);
  const [startError, setStartError] = useState<JobRecord['error']>(null);
  const [starting, setStarting] = useState(false);
  const pin = useContext(PanelPinContext);
  const duration = useDuration();
  const clip = useClipRange('mp3', videoId, Number.isFinite(duration) ? duration : 0);

  useEffect(() => {
    void mp3Bitrate.getValue().then((v) => isMp3Bitrate(v) && setBitrate(v));
  }, []);

  const download = async () => {
    setStarting(true);
    const section = clip.clip.section;
    const error = await begin({
      kind: 'mp3',
      videoId,
      title: pageTitle,
      label: `${mp3Label(bitrate)}${section ? ` ${formatRange(section)}` : ''}`,
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
            if (!isMp3Bitrate(b)) return;
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
  return <DownloadPanel videoId={videoId} kind="mp3" />;
}

// ---------------------------------------------------------------------------
// 一鍵下載（009 第一、二節）
// ---------------------------------------------------------------------------

/**
 * 面板打開（使用者點了「影片」或「MP3」，或從「更多」打開隱藏的工具）時的影片 ID。釘選的面板換到別部影片時，
 * 使用者沒有為那部影片點過按鈕，所以不自動下載，改為顯示「開始下載」按鈕。
 */
function DownloadPanel({ videoId, kind }: { videoId: string; kind: QuickKind }) {
  const [openedFor] = useState(videoId);
  return (
    <DownloadGate key={videoId} videoId={videoId}>
      {(title, installed) => <DownloadBody videoId={videoId} kind={kind} pageTitle={title} clicked={openedFor === videoId} installed={installed} />}
    </DownloadGate>
  );
}

/**
 * 一鍵下載開啟時：剛點了按鈕就直接開始（009 FR-4）；剛安裝好小幫手（FR-11）或釘選的面板換了影片時，先顯示「開始下載」按鈕。
 * 一鍵下載關閉、或按了「改用其他畫質」時顯示完整選項。
 */
function DownloadBody(props: { videoId: string; kind: QuickKind; pageTitle: string; clicked: boolean; installed: boolean }) {
  const { videoId, kind, pageTitle, clicked, installed } = props;
  const settings = useStore(quickSettings());
  const [mode, setMode] = useState<DownloadMode>(() =>
    initialDownloadMode({ quickEnabled: settings?.enabled === true, clickedForThisVideo: clicked, helperJustInstalled: installed }),
  );
  const full = kind === 'video' ? <QualityList videoId={videoId} pageTitle={pageTitle} /> : <Mp3Options videoId={videoId} pageTitle={pageTitle} />;
  if (mode === 'quick') return <QuickDownload videoId={videoId} kind={kind} pageTitle={pageTitle} onChooseOther={() => setMode('full')} />;
  if (mode === 'full' || !settings) {
    // 一鍵下載關閉：安裝完成後切換成選項清單（009 FR-11）。
    return (
      <>
        {installed && <InstalledNote />}
        {full}
      </>
    );
  }
  const spec = kind === 'video' ? videoSpecLabel(settings.defaults.height, settings.defaults.container) : mp3Label(settings.defaults.bitrate);
  return (
    <div class={kind === 'video' ? 'ytm-video ytm-quick' : 'ytm-mp3 ytm-quick'} data-kind={kind} data-phase="confirm">
      {installed && <InstalledNote />}
      {pageTitle && <p class="ytm-quick-title">{pageTitle}</p>}
      <div class="ytm-quick-actions">
        <button type="button" class="ytm-link ytm-quick-other" onClick={() => setMode('full')}>
          <Icon name="tune" size={20} />
          <span>{t(kind === 'video' ? 'quickChangeQuality' : 'quickChangeBitrate')}</span>
        </button>
        <Button variant="primary" onClick={() => setMode('quick')}>
          <Icon name="download" size={18} />
          <span>{t('quickStart', spec)}</span>
        </Button>
      </div>
      <JobList videoId={videoId} kind={kind} />
    </div>
  );
}

/** 「小幫手已安裝完成」（009 FR-11）：偵測到小幫手後不自動開始，等使用者按「開始下載」。 */
function InstalledNote() {
  return (
    <p class="ytm-hint ytm-quick-installed" role="status">
      <Icon name="check" size={18} />
      <span>{t('quickInstalled')}</span>
    </p>
  );
}

type QuickPhase = { phase: 'preparing' } | { phase: 'job'; jobId: string } | { phase: 'error'; code: JobRecord['error'] };

/**
 * 一鍵下載的面板（009 FR-4、FR-5）：這次下載的標題、畫質（或位元率）與進度；「改用其他畫質」取消這次下載並顯示完整選項；
 * 同一個下載進行中或已完成時只顯示它，不重複下載。
 */
function QuickDownload(props: { videoId: string; kind: QuickKind; pageTitle: string; onChooseOther: () => void }) {
  const { videoId, kind, pageTitle, onChooseOther } = props;
  const jobs = useStore(downloadJobs());
  const [state, setState] = useState<QuickPhase>(() => {
    const existing = existingQuickJob(jobs, videoId, kind);
    return existing ? { phase: 'job', jobId: existing.jobId } : { phase: 'preparing' };
  });
  const mounted = useRef(true);
  const abandoned = useRef(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const start = async () => {
    setState({ phase: 'preparing' });
    try {
      const result = await startQuickDownload(videoId, kind, pageTitle);
      // 準備期間按了「改用其他畫質」：取消剛開始的下載。
      if (abandoned.current) {
        if (result.status === 'started') void cancelJob(result.jobId).catch(() => {});
        return;
      }
      if (mounted.current) setState({ phase: 'job', jobId: result.jobId });
    } catch (err) {
      if (mounted.current && !abandoned.current) setState({ phase: 'error', code: err instanceof HostError ? err.code : 'UNKNOWN' });
    }
  };
  // 面板打開時開始一次（收起面板不會取消已開始的下載）。
  useEffect(() => {
    if (state.phase === 'preparing') void start();
  }, []);

  const job = state.phase === 'job' ? jobs.find((j) => j.jobId === state.jobId) : undefined;
  const chooseOther = () => {
    abandoned.current = true;
    if (job && isActive(job)) void cancelJob(job.jobId).catch(() => {});
    onChooseOther();
  };
  const title = job?.title || pageTitle;
  const preparing = state.phase === 'preparing' || (state.phase === 'job' && !job);
  const again = job && (job.state === 'done' || job.state === 'cancelled');

  return (
    <div class={kind === 'video' ? 'ytm-video ytm-quick' : 'ytm-mp3 ytm-quick'} data-kind={kind} data-phase={preparing ? 'preparing' : state.phase}>
      {title && <p class="ytm-quick-title">{title}</p>}
      {preparing && (
        <p class="ytm-muted ytm-quick-preparing" role="status">
          {t('quickPreparing')}
        </p>
      )}
      {job && (
        <ul class="ytm-jobs ytm-quick-job">
          <JobRow job={job} label={quickSummary(job)} />
        </ul>
      )}
      {state.phase === 'error' && <ErrorBlock code={state.code} onRetry={() => void start()} />}
      <div class="ytm-quick-actions">
        <button type="button" class="ytm-link ytm-quick-other" onClick={chooseOther}>
          <Icon name="tune" size={20} />
          <span>{t(kind === 'video' ? 'quickChangeQuality' : 'quickChangeBitrate')}</span>
        </button>
        {again && (
          <Button variant="secondary" onClick={() => void start()}>
            <Icon name="download" size={18} />
            <span>{t('quickAgain')}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
