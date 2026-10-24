// 背景腳本端：經由橋接程式的下載（tasks T16、plan 3.8）。
// - 連線（utils/native.ts）、狀態與影片資訊的暫存（002 NFR-2）；
// - 下載工作清單：以 storage.session 保存，改變時推播給曾經查詢過的 YouTube 分頁（002 FR-3、FR-4）；
// - 完成／失敗通知，點通知在 Finder／檔案總管中顯示檔案（002 FR-5、FR-6）；擴充功能沒有連線時結束的工作
//   在下一次連線時以 jobs 的 missed 補發通知（plan 4.6）。
import { initI18n, t } from '@/utils/i18n';
import type { ContentMessage, MessageResponse } from '@/utils/messages';
import { HostRequestError, NativeClient, type HostEvent, type PortLike } from '@/utils/native';
import {
  HOST_NAME,
  parseInfo,
  parseJobs,
  parseStatus,
  parseUpdate,
  type HostErrorCode,
  type HostInfo,
  type HostStatusResult,
} from '@/utils/native-protocol';
import { defaultVideoContainer, defaultVideoHeight, downloadDir, embedInfo, mp3Bitrate, namePreset } from '@/utils/settings';
import { applyEvent, errorInfo, isActive, isFinal, markMissing, mergeHostJobs, newJob, pruneJobs, type DownloadRequest, type JobRecord } from './jobs';
import { component, createStatusCache } from './host-status';
import { activeJobFor, planQuickDownload, startNotificationId, toQuickDefaults, type QuickDefaults, type QuickKind } from './quick';

const LOG_PREFIX = '[yt-toolbar-master]';
const INFO_TTL_MS = 30 * 60_000;
const NOTIFICATION_PREFIX = 'ytm-job:';
/** 沒有進行中的下載、也沒有等待中的指令這麼久之後關閉連線（橋接程式隨之結束，也不讓 service worker 一直執行）。 */
const IDLE_CLOSE_MS = 60_000;

const jobsItem = storage.defineItem<JobRecord[]>('session:downloadJobs', { fallback: [] });
const notifiedItem = storage.defineItem<string[]>('session:notifiedJobs', { fallback: [] });
const tabsItem = storage.defineItem<number[]>('session:jobTabs', { fallback: [] });
/**
 * 是否還有沒看到結束的下載。storage.session 在瀏覽器重新啟動時會清空，這個值存在 local：
 * 重新啟動後據此連線一次，以 jobs 的 missed 補發瀏覽器關閉期間完成的通知（plan 4.6）。
 */
const unfinishedItem = storage.defineItem<boolean>('local:hostJobsUnfinished', { fallback: false });

let jobs: JobRecord[] = [];
let notified = new Set<string>();
let tabs = new Set<number>();
let unfinished = false;
let loaded: Promise<void> | null = null;

const infoCache = new Map<string, { at: number; promise: Promise<HostInfo> }>();
const statusCache = createStatusCache();

const client = new NativeClient({
  connect: () => browser.runtime.connectNative(HOST_NAME) as unknown as PortLike,
  lastError: (port) =>
    browser.runtime.lastError?.message ?? ((port as { error?: { message?: string } } | undefined)?.error?.message || undefined),
  onEvent: (event) => void onHostEvent(event),
  onConnect: () => void syncJobs(),
  onDisconnect: (reason) => {
    statusCache.clear();
    if (reason) console.info(`${LOG_PREFIX} helper disconnected: ${reason}`);
  },
  // 還有進行中的下載時自動重連，才能繼續收到進度與完成事件。
  shouldReconnect: () => jobs.some(isActive),
});

let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIdleClose() {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!client.connected) return;
    if (jobs.some(isActive) || client.pendingCount > 0) scheduleIdleClose();
    else client.close();
  }, IDLE_CLOSE_MS);
}

function load(): Promise<void> {
  loaded ??= Promise.all([jobsItem.getValue(), notifiedItem.getValue(), tabsItem.getValue(), unfinishedItem.getValue()]).then(([j, n, tb, u]) => {
    jobs = Array.isArray(j) ? j : [];
    unfinished = u === true;
    notified = new Set(Array.isArray(n) ? n : []);
    tabs = new Set(Array.isArray(tb) ? tb : []);
  });
  return loaded;
}

/** 背景腳本啟動時：有進行中的下載就重新連線（瀏覽器重新啟動或 service worker 被暫停後）。 */
export async function resumeDownloads(): Promise<void> {
  await load();
  if (jobs.some(isActive) || unfinished) client.connect();
}

async function setJobs(next: JobRecord[]): Promise<void> {
  jobs = pruneJobs(next, Date.now());
  await jobsItem.setValue(jobs);
  const active = jobs.some(isActive);
  if (active !== unfinished) {
    unfinished = active;
    await unfinishedItem.setValue(active);
  }
  broadcast();
}

function broadcast() {
  const message = { type: 'jobsChanged', jobs };
  for (const tabId of [...tabs]) {
    browser.tabs.sendMessage(tabId, message).catch(() => {
      // 分頁已關閉或已離開 YouTube：不再推播。
      tabs.delete(tabId);
      void tabsItem.setValue([...tabs]);
    });
  }
}

async function onHostEvent(event: HostEvent) {
  await load();
  await setJobs(applyEvent(jobs, event, Date.now()));
  if (event.kind !== 'progress' && event.kind !== 'stage') {
    await notifyFinished(event.jobId);
    scheduleIdleClose();
  }
}

/** 重新連線後以 jobs 同步，並為沒有連線時結束的工作補發通知。 */
async function syncJobs() {
  await load();
  try {
    const host = parseJobs(await client.request('jobs'));
    let next = mergeHostJobs(jobs, host, Date.now());
    next = markMissing(next, host, Date.now());
    await setJobs(next);
    for (const h of host) if (h.missed) await notifyFinished(h.jobId);
  } catch (err) {
    console.info(`${LOG_PREFIX} jobs sync failed`, err);
    // 找不到橋接程式（例如已解除安裝）：不再於每次啟動時嘗試連線。
    if (unfinished && !jobs.some(isActive)) {
      unfinished = false;
      await unfinishedItem.setValue(false);
    }
  }
  scheduleIdleClose();
}

async function notifyFinished(jobId: string) {
  const job = jobs.find((j) => j.jobId === jobId);
  if (!job || !isFinal(job.state)) return;
  // 右鍵下載的「開始下載」通知（009 FR-23）換成完成或失敗的通知。
  if (job.kind === 'video' || job.kind === 'mp3') browser.notifications.clear(startNotificationId(job.videoId, job.kind)).catch(() => {});
  if (job.state === 'cancelled' || notified.has(jobId)) return;
  notified.add(jobId);
  await notifiedItem.setValue([...notified].slice(-200));
  const done = job.state === 'done';
  await initI18n();
  try {
    await browser.notifications.create(`${NOTIFICATION_PREFIX}${jobId}`, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: done ? t('notifyDoneTitle') : t('notifyFailedTitle'),
      message: done ? (job.fileName ?? job.title) : `${job.title || job.label}\n${t(errorInfo(job.error).message)}`,
    });
  } catch (err) {
    console.info(`${LOG_PREFIX} notification failed`, err);
  }
}

/** 點完成通知：在 Finder／檔案總管中顯示檔案（002 FR-5）。 */
export function onNotificationClicked(notificationId: string): void {
  if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
  const jobId = notificationId.slice(NOTIFICATION_PREFIX.length);
  void browser.notifications.clear(notificationId);
  void load().then(() => {
    if (jobs.find((j) => j.jobId === jobId)?.state !== 'done') return;
    client.request('reveal', { jobId }).catch((err: unknown) => console.info(`${LOG_PREFIX} reveal failed`, err));
  });
}

/** 只快取可以下載的結果；未安裝或缺少元件時每次都重新查詢（009 FR-10a）。 */
export async function getStatus(refresh: boolean): Promise<HostStatusResult> {
  const cached = refresh ? null : statusCache.get();
  if (cached) return cached;
  try {
    const value = parseStatus(await client.request('status'));
    statusCache.put(value);
    return value;
  } catch (err) {
    statusCache.clear();
    throw err;
  }
}

function getInfo(videoId: string): Promise<HostInfo> {
  const cached = infoCache.get(videoId);
  if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.promise;
  const promise = client.request('getInfo', { videoId }).then(parseInfo);
  infoCache.set(videoId, { at: Date.now(), promise });
  promise.catch(() => infoCache.delete(videoId));
  if (infoCache.size > 30) infoCache.delete(infoCache.keys().next().value!);
  return promise;
}

/** 下載指令的參數：依請求種類只帶允許的欄位，補上下載資料夾、檔名格式與嵌入資訊（002 FR-60、004 FR-11）。 */
export function downloadArgs(
  request: DownloadRequest,
  settings: { dir: string; namePreset: string; embed: boolean },
): Record<string, unknown> {
  const common = { videoId: request.videoId, kind: request.kind, dir: settings.dir, namePreset: settings.namePreset };
  switch (request.kind) {
    case 'video':
      return {
        ...common,
        formatId: request.formatId,
        container: request.container,
        embed: settings.embed,
        ...(request.section ? { section: request.section } : {}),
      };
    case 'mp3':
      return { ...common, bitrate: request.bitrate, embed: settings.embed, ...(request.section ? { section: request.section } : {}) };
    case 'subtitle':
      return { ...common, subLang: request.subLang, subFormat: request.subFormat, subAuto: request.subAuto };
  }
}

async function startDownload(request: DownloadRequest, estimate: JobRecord['estimate'] = null): Promise<string> {
  await load();
  const status = await getStatus(false);
  const preset = await namePreset.getValue();
  const settings = {
    dir: (await downloadDir.getValue()) || status.defaultDir,
    namePreset: status.namePresets.some((p) => p.id === preset) ? preset : 'title-id',
    embed: (await embedInfo.getValue()) !== false,
  };
  // 設定的下載資料夾不存在或無法寫入時，橋接程式回應 PERMISSION_DENIED（T15b）。
  const result = await client.request('download', downloadArgs(request, settings));
  const jobId = typeof result.jobId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(result.jobId) ? result.jobId : null;
  if (!jobId) throw new HostRequestError('UNKNOWN', 'download returned no jobId');
  // 事件有時比 download 的回應早到：已經有紀錄時保留進度，只補上請求內容。
  const existing = jobs.find((j) => j.jobId === jobId);
  const created = newJob(jobId, request, Date.now(), estimate);
  await setJobs(existing ? jobs.map((j) => (j.jobId === jobId ? { ...j, label: created.label, title: created.title, request, estimate } : j)) : [created, ...jobs]);
  return jobId;
}

// ---------------------------------------------------------------------------
// 一鍵下載與右鍵下載（009，plan 3.11）
// ---------------------------------------------------------------------------

export type QuickSource = 'toolbar' | 'contextMenu';

export interface QuickResult {
  /** started：開始了新的下載；running：同一部影片的同一種下載已在進行中（FR-5），沒有重複下載。 */
  status: 'started' | 'running';
  jobId: string;
  title: string;
  label: string;
}

/** 目前的預設值（009 FR-2、FR-3）。 */
export async function readQuickDefaults(): Promise<QuickDefaults> {
  const [height, container, bitrate] = await Promise.all([defaultVideoHeight.getValue(), defaultVideoContainer.getValue(), mp3Bitrate.getValue()]);
  return toQuickDefaults(height, container, bitrate);
}

/** 同一部影片、同一種的一鍵下載同時只處理一個（連點兩次時共用同一個結果）。 */
const quickPending = new Map<string, Promise<QuickResult>>();

/**
 * 一鍵下載：取得影片資訊（共用 getInfo 的暫存）→ 檢查是否可下載（FR-6）→ 依預設值選格式（FR-2、FR-3）→ 開始下載。
 * 同一部影片的同一種下載進行中時回傳那個工作（FR-5）。失敗時以 HostRequestError 丟出錯誤代碼。
 * onInfo 在取得影片資訊後呼叫（右鍵下載用來把通知中的影片 ID 換成標題，FR-23）。
 */
export function quickDownload(
  videoId: string,
  kind: QuickKind,
  options: { source: QuickSource; title?: string; onStart?: () => void; onInfo?: (title: string) => void },
): Promise<QuickResult> {
  const key = `${videoId}:${kind}`;
  const pending = quickPending.get(key);
  if (pending) return pending;
  const run = (async (): Promise<QuickResult> => {
    await load();
    const running = activeJobFor(jobs, videoId, kind);
    if (running) return { status: 'running', jobId: running.jobId, title: running.title, label: running.label };
    const status = await getStatus(false);
    if (!status.ready) throw new HostRequestError(component({ state: 'connected', status }, 'yt-dlp').ok ? 'FFMPEG_NOT_FOUND' : 'YTDLP_NOT_FOUND');
    // 小幫手可以使用：右鍵下載在這時顯示「開始下載」通知（先以影片 ID 顯示，FR-23）。
    options.onStart?.();
    const [info, defaults] = await Promise.all([getInfo(videoId), readQuickDefaults()]);
    options.onInfo?.(info.title || options.title || '');
    const plan = planQuickDownload(videoId, info, kind, defaults, options.title);
    if (!plan.ok) throw new HostRequestError(plan.error);
    // 取得資訊的期間，其他分頁有機會開始同一個下載：再檢查一次。
    const again = activeJobFor(jobs, videoId, kind);
    if (again) return { status: 'running', jobId: again.jobId, title: again.title, label: again.label };
    const jobId = await startDownload(plan.request, plan.estimate);
    return { status: 'started', jobId, title: plan.request.title, label: plan.request.label };
  })();
  quickPending.set(key, run);
  void run.finally(() => quickPending.delete(key)).catch(() => {});
  return run;
}

type HostMessageType =
  | 'hostStatus'
  | 'getInfo'
  | 'startDownload'
  | 'quickDownload'
  | 'cancelJob'
  | 'revealJob'
  | 'getJobs'
  | 'pickFolder'
  | 'updateYtDlp'
  | 'hostSetAutoUpdate'
  | 'hostCheckUpdates'
  | 'hostUninstall';
export const HOST_MESSAGE_TYPES: readonly string[] = [
  'hostStatus',
  'getInfo',
  'startDownload',
  'quickDownload',
  'cancelJob',
  'revealJob',
  'getJobs',
  'pickFolder',
  'updateYtDlp',
  'hostSetAutoUpdate',
  'hostCheckUpdates',
  'hostUninstall',
];

async function handle(message: Extract<ContentMessage, { type: HostMessageType }>, tabId: number | undefined): Promise<MessageResponse<Record<string, unknown>>> {
  switch (message.type) {
    case 'hostStatus':
      return { ok: true, status: await getStatus(message.refresh) };
    case 'getInfo':
      return { ok: true, info: await getInfo(message.videoId) };
    case 'startDownload':
      return { ok: true, jobId: await startDownload(message.request) };
    case 'quickDownload':
      return { ok: true, result: await quickDownload(message.videoId, message.kind, { source: 'toolbar', title: message.title }) };
    case 'cancelJob': {
      const result = await client.request('cancel', { jobId: message.jobId });
      await load();
      await setJobs(jobs.map((j) => (j.jobId === message.jobId && isActive(j) ? { ...j, state: result.state === 'cancelled' ? 'cancelled' : j.state, speed: null, eta: null, updatedAt: Date.now() } : j)));
      return { ok: true };
    }
    case 'revealJob':
      await client.request('reveal', { jobId: message.jobId });
      return { ok: true };
    case 'getJobs':
      await load();
      if (tabId !== undefined && !tabs.has(tabId)) {
        tabs.add(tabId);
        await tabsItem.setValue([...tabs]);
      }
      if (jobs.some(isActive) && !client.connected) client.connect();
      return { ok: true, jobs };
    case 'pickFolder': {
      const result = await client.request('pickFolder');
      return { ok: true, path: typeof result.path === 'string' ? result.path : null };
    }
    case 'updateYtDlp': {
      const result = parseUpdate(await client.request('updateYtDlp'));
      statusCache.clear();
      return { ok: true, update: result };
    }
    // 008（plan 4.9、3.10）
    case 'hostSetAutoUpdate':
      await client.request('setAutoUpdate', { enabled: message.enabled });
      statusCache.clear();
      return { ok: true };
    case 'hostCheckUpdates': {
      const result = await client.request('checkUpdates');
      statusCache.clear();
      return { ok: true, started: result.started === true };
    }
    case 'hostUninstall':
      // 有進行中的下載時，小幫手回應 JOBS_RUNNING。成功後小幫手 2 秒後刪除自己與瀏覽器的註冊。
      await client.request('uninstall');
      statusCache.clear();
      infoCache.clear();
      // 關閉這次的連線：正在執行的小幫手隨之結束，下一次查詢會重新連線（註冊已被刪除時為未安裝）。
      client.close();
      return { ok: true };
  }
}

/** 處理經由橋接程式的訊息；結果以 sendResponse 回覆。不是這類訊息時回傳 false。 */
export function handleHostMessage(message: ContentMessage, tabId: number | undefined, sendResponse: (response: unknown) => void): boolean {
  if (!HOST_MESSAGE_TYPES.includes(message.type)) return false;
  const done = handle(message as Extract<ContentMessage, { type: HostMessageType }>, tabId);
  void done.finally(scheduleIdleClose).catch(() => {});
  done.then(sendResponse, (err: unknown) => {
    const code: HostErrorCode = err instanceof HostRequestError ? err.code : 'UNKNOWN';
    if (code === 'UNKNOWN' || code === 'INVALID_ARGS' || code === 'INVALID_REQUEST') console.info(`${LOG_PREFIX} helper request failed`, err);
    sendResponse({ ok: false, error: code });
  });
  return true;
}
