// 內容腳本端：經由背景腳本使用橋接程式（tasks T16、T19 至 T22）。
// 下載工作的清單由背景腳本推播（jobsChanged），這裡保存一份給面板與工具列按鈕使用。
import { createStore, type Store } from '@/features/viewing/store';
import { isBackgroundMessage } from '@/utils/messages';
import { toErrorCode, type HostErrorCode, type HostInfo, type HostStatusResult, type UpdateResult } from '@/utils/native-protocol';
import { defaultVideoContainer, defaultVideoHeight, mp3Bitrate, quickDownload, watchSettings } from '@/utils/settings';
import { sendToBackground } from '@/utils/messages';
import type { QuickResult } from './host-background';
import type { HostState } from './host-status';
import type { DownloadRequest, JobRecord } from './jobs';
import { toQuickDefaults, type QuickDefaults, type QuickKind } from './quick';

const LOG_PREFIX = '[yt-toolbar-master]';

export class HostError extends Error {
  constructor(readonly code: HostErrorCode) {
    super(code);
  }
}

async function call<T extends Record<string, unknown>>(message: Parameters<typeof sendToBackground>[0]): Promise<T> {
  const res = await sendToBackground<T>(message);
  if (res.ok) return res;
  const code = toErrorCode(res.error);
  // 詳細代碼只寫進 console（002 FR-6a）。
  console.info(`${LOG_PREFIX} ${message.type} failed: ${res.error}`);
  throw new HostError(code);
}

/** 橋接程式的狀態；找不到或無法啟動時為 unreachable。 */
export async function checkHostStatus(refresh = false): Promise<HostState> {
  try {
    // 背景腳本已以 parseStatus 整理過。
    const { status } = await call<{ status: HostStatusResult }>({ type: 'hostStatus', refresh });
    return { state: 'connected', status };
  } catch {
    return { state: 'unreachable' };
  }
}

export const getInfo = (videoId: string) => call<{ info: HostInfo }>({ type: 'getInfo', videoId }).then((r) => r.info);
export const startDownload = (request: DownloadRequest) => call<{ jobId: string }>({ type: 'startDownload', request }).then((r) => r.jobId);
/** 一鍵下載（009 FR-4、FR-5）：格式由背景腳本依預設值選擇。 */
export const startQuickDownload = (videoId: string, kind: QuickKind, title: string) =>
  call<{ result: QuickResult }>({ type: 'quickDownload', videoId, kind, title: title.slice(0, 500) }).then((r) => r.result);
export const cancelJob = (jobId: string) => call({ type: 'cancelJob', jobId });
export const revealJob = (jobId: string) => call({ type: 'revealJob', jobId });
export const updateYtDlp = () => call<{ update: UpdateResult }>({ type: 'updateYtDlp' }).then((r) => r.update);
export const setAutoUpdate = (enabled: boolean) => call({ type: 'hostSetAutoUpdate', enabled });
export const checkUpdates = () => call<{ started: boolean }>({ type: 'hostCheckUpdates' }).then((r) => r.started);
export const uninstallHost = () => call({ type: 'hostUninstall' });
export const pickFolder = () => call<{ path: string | null }>({ type: 'pickFolder' }).then((r) => r.path);

/** 下載工作（所有影片）；第一次使用時向背景腳本查詢，之後由推播更新。 */
let jobsStore: Store<JobRecord[]> | null = null;

export function downloadJobs(): Store<JobRecord[]> {
  if (jobsStore) return jobsStore;
  const store = createStore<JobRecord[]>([]);
  jobsStore = store;
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || !isBackgroundMessage(message)) return;
    store.set(message.jobs);
  });
  void sendToBackground<{ jobs: JobRecord[] }>({ type: 'getJobs' }).then((res) => {
    if (res.ok && Array.isArray(res.jobs)) store.set(res.jobs);
  });
  return store;
}

/** 一鍵下載的設定（009 FR-1 至 FR-3）；讀到之前為 null。 */
export interface QuickSettings {
  enabled: boolean;
  defaults: QuickDefaults;
}

let quickStore: Store<QuickSettings | null> | null = null;

/** 一鍵下載的設定與預設值；第一次使用時讀取，之後設定頁或其他分頁改變時立即更新（009 FR-7、FR-26）。 */
export function quickSettings(): Store<QuickSettings | null> {
  if (quickStore) return quickStore;
  const store = createStore<QuickSettings | null>(null);
  quickStore = store;
  watchSettings([quickDownload, defaultVideoHeight, defaultVideoContainer, mp3Bitrate] as const, ([enabled, height, container, bitrate]) =>
    store.set({ enabled: enabled !== false, defaults: toQuickDefaults(height, container, bitrate) }),
  );
  return store;
}
