// 下載工作清單（002 FR-3、FR-4、FR-6、FR-6a、FR-6b，tasks T22）：面板內列出目前這部影片的下載，
// 顯示百分比、速度、剩餘時間（沒有百分比時為不確定進度）、「取消」；完成時可以在 Finder／檔案總管中顯示；
// 失敗時顯示易懂的原因與「重試」，必要時附「更新 yt-dlp」「開啟設定頁」或安裝說明。
import { useState } from 'preact/hooks';
import { cancelJob, revealJob, startDownload, updateYtDlp, HostError } from '@/features/downloads/host-client';
import { INSTALL_GUIDE_URL } from '@/features/downloads/host-status';
import { errorInfo, formatEta, formatSpeed, isActive, type JobRecord } from '@/features/downloads/jobs';
import { t, type MessageKey } from '@/utils/i18n';
import type { ContentMessage } from '@/utils/messages';
import type { JobKind } from '@/utils/native-protocol';
import type { UpdateResult } from '@/utils/native-protocol';
import { Button } from '../controls/Button';
import { Icon } from '../icons';
import { useStore } from './useStore';
import { downloadJobs } from '@/features/downloads/host-client';

const STATE_LABELS: Record<JobRecord['state'], MessageKey> = {
  queued: 'jobQueued',
  downloading: 'jobDownloading',
  processing: 'jobProcessing',
  done: 'jobDone',
  failed: 'jobFailed',
  cancelled: 'jobCancelled',
};

export function openSettings() {
  const message: ContentMessage = { type: 'openOptions' };
  browser.runtime.sendMessage(message).catch(() => {});
}

/** 「更新 yt-dlp」：直接更新，或顯示可以複製的更新指令（由套件管理工具安裝時）。 */
export function UpdateYtDlp() {
  const [state, setState] = useState<{ status: 'idle' | 'running' | 'error' } | { status: 'done'; result: UpdateResult }>({ status: 'idle' });
  const run = async () => {
    setState({ status: 'running' });
    try {
      setState({ status: 'done', result: await updateYtDlp() });
    } catch {
      setState({ status: 'error' });
    }
  };
  if (state.status === 'done') {
    const r = state.result;
    if (!r.ran && r.command) {
      return (
        <div class="ytm-update" data-state="command">
          <span>{t('updateRunCommand')}</span>
          <code class="ytm-code">{r.command}</code>
        </div>
      );
    }
    return (
      <div class="ytm-update" data-state="done" role="status">
        <Icon name="check" size={18} />
        <span>{r.updated ? t('updateDone', r.version ?? '') : t('updateUpToDate')}</span>
      </div>
    );
  }
  return (
    <div class="ytm-update" data-state={state.status}>
      <Button variant="secondary" disabled={state.status === 'running'} onClick={() => void run()}>
        <Icon name="refresh" size={18} />
        <span>{state.status === 'running' ? t('updateRunning') : t('updateYtDlp')}</span>
      </Button>
      {state.status === 'error' && (
        <span class="ytm-field-error" role="alert">
          {t('updateFailed')}
        </span>
      )}
    </div>
  );
}

/** 錯誤說明與操作（FR-6a）。onRetry 為 null 時不提供重試。 */
export function ErrorBlock({ code, onRetry }: { code: JobRecord['error']; onRetry: (() => void) | null }) {
  const info = errorInfo(code);
  return (
    <div class="ytm-job-error" role="alert" data-code={code ?? 'UNKNOWN'}>
      <span class="ytm-job-error-text">{t(info.message)}</span>
      <span class="ytm-job-error-actions">
        {info.action === 'settings' && (
          <Button variant="secondary" onClick={openSettings}>
            <Icon name="settings" size={18} />
            <span>{t('helpOpenSettings')}</span>
          </Button>
        )}
        {info.action === 'install' && (
          <a class="ytm-link" href={INSTALL_GUIDE_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="open_in_new" size={18} />
            <span>{t('hostInstallGuide')}</span>
          </a>
        )}
        {info.retry && onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            <Icon name="refresh" size={18} />
            <span>{t('retry')}</span>
          </Button>
        )}
      </span>
      {info.action === 'update' && <UpdateYtDlp />}
    </div>
  );
}

function ProgressBar({ percent }: { percent: number | null }) {
  return (
    <div
      class="ytm-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : Math.round(percent)}
      data-indeterminate={percent === null ? '' : undefined}
    >
      {/* 不確定與確定進度用不同的元素，切換時寬度不會從動畫中的位置漸變。 */}
      <div key={percent === null ? 'indeterminate' : 'determinate'} class="ytm-progress-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
    </div>
  );
}

/** 一個下載。label 可以換掉顯示的說明（一鍵下載的面板加上大小，009 FR-4）。 */
export function JobRow({ job, label }: { job: JobRecord; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState<JobRecord['error']>(null);
  const active = isActive(job);
  const details = [
    job.percent !== null && active ? `${Math.floor(job.percent)}%` : '',
    active ? formatSpeed(job.speed) : '',
    active && job.eta !== null ? t('jobEta', formatEta(job.eta)) : '',
  ].filter(Boolean);
  const retry = job.request
    ? async () => {
        setBusy(true);
        try {
          await startDownload(job.request!);
          setRetryError(null);
        } catch (err) {
          setRetryError(err instanceof HostError ? err.code : 'UNKNOWN');
        } finally {
          setBusy(false);
        }
      }
    : null;
  return (
    <li class="ytm-job" data-state={job.state} data-job={job.jobId}>
      <div class="ytm-job-head">
        <span class="ytm-job-label">{label || job.label || job.fileName || job.kind}</span>
        {/* 遇到 yt-dlp 過舊等錯誤時，小幫手先更新 yt-dlp 再重試（008 FR-22）。 */}
        <span class="ytm-job-state" data-stage={active && job.stage ? job.stage : undefined}>
          {active && job.stage === 'updating-ytdlp' ? t('jobUpdatingYtDlp') : t(STATE_LABELS[job.state])}
        </span>
      </div>
      {active && (
        <>
          <ProgressBar percent={job.stage || (job.state === 'processing' && job.percent === 100) ? null : job.percent} />
          <div class="ytm-job-foot">
            <span class="ytm-job-details">{details.join(' · ')}</span>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                cancelJob(job.jobId)
                  .catch(() => {})
                  .finally(() => setBusy(false));
              }}
            >
              <Icon name="close" size={18} />
              <span>{t('jobCancel')}</span>
            </Button>
          </div>
        </>
      )}
      {job.state === 'done' && (
        <div class="ytm-job-foot">
          <span class="ytm-job-file" title={job.fileName ?? ''}>
            {job.fileName}
          </span>
          <Button variant="secondary" onClick={() => void revealJob(job.jobId).catch(() => {})}>
            <Icon name="folder_open" size={18} />
            <span>{t('jobReveal')}</span>
          </Button>
        </div>
      )}
      {job.state === 'failed' && <ErrorBlock code={retryError ?? job.error} onRetry={retry && !busy ? () => void retry() : null} />}
    </li>
  );
}

/** 這部影片、這一類的下載（新的在前）。 */
export function JobList({ videoId, kind }: { videoId: string; kind: JobKind }) {
  const jobs = useStore(downloadJobs()).filter((j) => j.videoId === videoId && j.kind === kind && j.state !== 'cancelled');
  if (jobs.length === 0) return null;
  return (
    <ul class="ytm-jobs" aria-label={t('jobsLabel')}>
      {jobs.map((job) => (
        <JobRow key={job.jobId} job={job} />
      ))}
    </ul>
  );
}
