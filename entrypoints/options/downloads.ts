// 設定頁的「下載」區（002 FR-60、004 FR-11、008 FR-2、FR-24、FR-25、FR-30，tasks T23、T45、T46）：
// 各元件（小幫手、yt-dlp、ffmpeg、deno、擴充功能）的版本與來源、安裝說明、更新 yt-dlp、自動更新、移除下載功能、
// 下載資料夾、檔名格式、嵌入資訊開關。設定改變時立即寫入；背景腳本在下次下載時讀取。
import { checkHostStatus, HostError, pickFolder, updateYtDlp } from '@/features/downloads/host-client';
import { componentState, componentVersion, HOST_COMPONENTS, INSTALL_GUIDE_URL, type HostComponent, type HostState } from '@/features/downloads/host-status';
import { INSTALL_POLL_MS } from '@/features/downloads/install-guide';
import type { HostOs } from '@/features/downloads/logic';
import { t, type MessageKey } from '@/utils/i18n';
import {
  DEFAULT_VIDEO_CONTAINERS,
  DEFAULT_VIDEO_HEIGHTS,
  defaultVideoContainer,
  defaultVideoHeight,
  downloadContextMenu,
  downloadDir,
  embedInfo,
  namePreset,
  quickDownload,
  toDefaultVideoContainer,
  toDefaultVideoHeight,
  type DefaultVideoHeight,
} from '@/utils/settings';
import { componentInfo, createMaintenance, extensionSource, sourceLabel } from './host-maintenance';
import { installGuide, platformOs } from './install-guide';

const COMPONENT_LABELS: Record<HostComponent, MessageKey> = {
  host: 'hostComponentHelper',
  ytDlp: 'hostComponentYtDlp',
  ffmpeg: 'hostComponentFfmpeg',
  deno: 'hostComponentDeno',
};

/** 橋接程式內建的檔名格式（status 的 namePresets）；沒有連線時也能顯示目前的選擇。 */
const PRESET_LABELS: Record<string, MessageKey> = {
  'title-id': 'namePresetTitleId',
  title: 'namePresetTitle',
  'channel-title': 'namePresetChannelTitle',
  'date-title': 'namePresetDateTitle',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {}, ...children: Array<Node | string>) {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

/** 預設影片畫質的選項文字（009 FR-2）。 */
function heightLabel(h: DefaultVideoHeight): string {
  if (h === 'best') return t('quickHeightBest');
  const text = h === 2160 ? '2160p (4K)' : h === 1440 ? '1440p (2K)' : `${h}p`;
  return h === 1080 ? t('optionsDefaultMark', text) : text;
}

/** 開關一列：名稱、一行說明與開關（與頁面整理的開關相同的外觀）。 */
function switchRow(id: string, name: MessageKey, desc: MessageKey, item: { getValue(): Promise<boolean>; setValue(v: boolean): Promise<void>; watch(cb: (v: boolean) => void): () => void }, cleanups: Array<() => void>) {
  const input = el('input', { type: 'checkbox', id, className: 'switch' });
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-describedby', `${id}-desc`);
  input.disabled = true;
  void item.getValue().then((v) => {
    input.checked = v !== false;
    input.disabled = false;
  });
  input.addEventListener('change', () => void item.setValue(input.checked));
  cleanups.push(item.watch((v) => (input.checked = v !== false)));
  return el(
    'div',
    { className: 'option', dataset: { option: id } },
    el('label', { className: 'option-text', htmlFor: id }, el('span', { className: 'option-name', textContent: t(name) }), el('span', { className: 'option-desc', id: `${id}-desc`, textContent: t(desc) })),
    input,
  );
}

/** 下拉選單一列。 */
function selectRow(id: string, name: MessageKey, desc: MessageKey | null, options: Array<{ value: string; label: string }>) {
  const select = el('select', { id, className: 'select' });
  select.append(...options.map((o) => el('option', { value: o.value, textContent: o.label })));
  select.disabled = true;
  const text = el('label', { className: 'option-text', htmlFor: id }, el('span', { className: 'option-name', textContent: t(name) }));
  if (desc) {
    text.append(el('span', { className: 'option-desc', id: `${id}-desc`, textContent: t(desc) }));
    select.setAttribute('aria-describedby', `${id}-desc`);
  }
  return { row: el('div', { className: 'option', dataset: { option: id } }, text, select), select };
}

function group(id: string, title: MessageKey): HTMLFieldSetElement {
  const fieldset = el('fieldset', { className: 'group', dataset: { category: id } });
  fieldset.append(el('legend', { textContent: t(title) }));
  return fieldset;
}

/** 繪製下載區；回傳的函式取消監聽（介面語言改變時重新繪製，007 FR-3）。 */
export function renderDownloads(root: HTMLElement): () => void {
  let state: HostState | null = null;
  let os: HostOs | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  // ---- 連線狀態 ----
  const connection = group('connection', 'optionsConnection');
  const list = el('div', { className: 'status-list' });
  const install = el('div', { className: 'status-install' });
  const recheck = el('button', { type: 'button', className: 'button', id: 'downloads-recheck', textContent: t('hostRecheck') });
  const update = el('button', { type: 'button', className: 'button', id: 'downloads-update', textContent: t('updateYtDlp') });
  const updateResult = el('div', { className: 'option-desc update-result', id: 'downloads-update-result' });
  updateResult.setAttribute('role', 'status');
  // 擴充功能本身（008 FR-24）：版本與更新方式。
  const extensionRow = el(
    'div',
    { className: 'status-row', dataset: { component: 'extension', ok: 'true' } },
    el('span', { textContent: t('componentExtension') }),
    el('span', { className: 'option-desc', id: 'downloads-extension', textContent: t('hostStatusVersion', browser.runtime.getManifest().version) }),
  );
  void extensionSource().then((source) => {
    if (source) extensionRow.lastElementChild!.textContent = `${t('hostStatusVersion', browser.runtime.getManifest().version)} · ${source}`;
  });
  connection.append(list, el('div', { className: 'status-list' }, extensionRow), install, el('div', { className: 'actions' }, recheck, update), updateResult);

  // ---- 自動更新、移除下載功能（008） ----
  const maintenance = createMaintenance(async () => {
    const next = await checkHostStatus(true);
    if (disposed) return;
    state = next;
    renderStatus();
  });

  // ---- 下載資料夾 ----
  const folder = group('folder', 'optionsFolder');
  const folderPath = el('span', { className: 'option-name folder-path', id: 'downloads-folder' });
  const choose = el('button', { type: 'button', className: 'button', id: 'downloads-choose', textContent: t('optionsFolderChoose') });
  const reset = el('button', { type: 'button', className: 'button', id: 'downloads-reset', textContent: t('optionsFolderReset') });
  const folderError = el('div', { className: 'option-desc error', id: 'downloads-folder-error' });
  folder.append(el('div', { className: 'option' }, el('span', { className: 'option-text' }, folderPath)), el('div', { className: 'actions' }, choose, reset), folderError);

  // ---- 下載的檔案：檔名格式、嵌入資訊 ----
  const files = group('files', 'optionsFiles');
  const select = el('select', { id: 'downloads-name-preset', className: 'select' });
  const embedInput = el('input', { type: 'checkbox', id: 'downloads-embed', className: 'switch' });
  embedInput.setAttribute('role', 'switch');
  embedInput.setAttribute('aria-describedby', 'downloads-embed-desc');
  files.append(
    el('div', { className: 'option', dataset: { option: 'namePreset' } }, el('label', { className: 'option-text', htmlFor: 'downloads-name-preset' }, el('span', { className: 'option-name', textContent: t('optionsNamePreset') })), select),
    el(
      'div',
      { className: 'option', dataset: { option: 'embed' } },
      el('label', { className: 'option-text', htmlFor: 'downloads-embed' }, el('span', { className: 'option-name', textContent: t('optionsEmbed') }), el('span', { className: 'option-desc', id: 'downloads-embed-desc', textContent: t('optionsEmbedDesc') })),
      embedInput,
    ),
  );

  // ---- 一鍵下載（009 FR-1、FR-2） ----
  const cleanups: Array<() => void> = [];
  const quick = group('quick', 'optionsQuickTitle');
  const height = selectRow(
    'downloads-default-height',
    'optionsDefaultHeight',
    'optionsDefaultHeightDesc',
    DEFAULT_VIDEO_HEIGHTS.map((h) => ({ value: String(h), label: heightLabel(h) })),
  );
  const container = selectRow('downloads-default-container', 'optionsDefaultContainer', null, [
    ...DEFAULT_VIDEO_CONTAINERS.map((c) => ({ value: c, label: c === 'mp4' ? t('optionsDefaultMark', t('optionsContainerMp4')) : t('optionsContainerAny') })),
  ]);
  quick.append(
    switchRow('downloads-quick', 'optionsQuickDownload', 'optionsQuickDownloadDesc', quickDownload, cleanups),
    height.row,
    container.row,
    // 右鍵下載（009 FR-25）：關閉時背景腳本移除選單項目。
    switchRow('downloads-context-menu', 'optionsContextMenu', 'optionsContextMenuDesc', downloadContextMenu, cleanups),
  );
  const showHeight = (v: unknown) => (height.select.value = String(toDefaultVideoHeight(v)));
  const showContainer = (v: unknown) => (container.select.value = toDefaultVideoContainer(v));
  void defaultVideoHeight.getValue().then((v) => {
    showHeight(v);
    height.select.disabled = false;
  });
  void defaultVideoContainer.getValue().then((v) => {
    showContainer(v);
    container.select.disabled = false;
  });
  height.select.addEventListener('change', () => {
    const v = height.select.value;
    void defaultVideoHeight.setValue(toDefaultVideoHeight(v === 'best' ? 'best' : Number(v)));
  });
  container.select.addEventListener('change', () => void defaultVideoContainer.setValue(toDefaultVideoContainer(container.select.value)));
  cleanups.push(defaultVideoHeight.watch(showHeight), defaultVideoContainer.watch(showContainer));

  root.append(connection, ...maintenance.elements, quick, folder, files);

  const renderStatus = () => {
    list.replaceChildren();
    if (!state) {
      list.append(el('div', { className: 'option-desc', textContent: t('hostChecking') }));
      return;
    }
    for (const c of HOST_COMPONENTS) {
      const ok = componentState(state, c);
      const version = componentVersion(state, c);
      const text =
        ok === null
          ? t(c === 'host' ? 'hostStatusNotInstalled' : 'hostStatusUnknown')
          : ok
            ? version
              ? t('hostStatusVersion', version)
              : t('hostStatusFound')
            : t(c === 'host' ? 'hostStatusNotInstalled' : 'hostStatusMissing');
      // 來源（008 FR-24）：小幫手安裝的、Homebrew、winget 或系統上原本就有的；滑鼠停留時顯示路徑。
      const info = ok ? componentInfo(state, c) : null;
      const source = sourceLabel(info);
      const value = el('span', { className: 'option-desc', textContent: source ? `${text} · ${source}` : text });
      if (info?.path) value.title = info.path;
      list.append(el('div', { className: 'status-row', dataset: { component: c, ok: String(ok === true) } }, el('span', { textContent: t(COMPONENT_LABELS[c]) }), value));
    }
    install.replaceChildren();
    // 小幫手未安裝或缺少元件：與面板相同的安裝說明（008 FR-2）；安裝期間每 3 秒自動檢查。
    const missing = state.state === 'unreachable' || !state.status.complete;
    if (missing && os) {
      install.append(el('p', { className: 'option-desc', textContent: t('installIntro') }), installGuide(os, 'downloads-install'));
      const link = el('a', { href: INSTALL_GUIDE_URL, target: '_blank', rel: 'noopener noreferrer', textContent: t('hostInstallGuide') });
      install.append(link);
    }
    setPolling(missing);
    const connected = state.state === 'connected';
    update.disabled = !connected || componentState(state, 'ytDlp') !== true;
    choose.disabled = !connected;
    maintenance.render(state);
    renderFolder();
    renderPresets();
  };

  const renderFolder = async () => {
    const dir = await downloadDir.getValue();
    const defaultDir = state?.state === 'connected' ? state.status.defaultDir : '';
    folderPath.textContent = dir || (defaultDir ? t('optionsFolderDefault', defaultDir) : t('optionsFolderDefaultUnknown'));
    reset.disabled = !dir;
  };

  const renderPresets = async () => {
    const current = await namePreset.getValue();
    const presets = state?.state === 'connected' && state.status.namePresets.length ? state.status.namePresets : Object.keys(PRESET_LABELS).map((id) => ({ id }));
    select.replaceChildren(
      ...presets.map((p) => {
        const label = PRESET_LABELS[p.id] ? t(PRESET_LABELS[p.id]!) : p.id;
        return el('option', { value: p.id, textContent: label });
      }),
    );
    select.value = presets.some((p) => p.id === current) ? current : 'title-id';
  };

  function setPolling(on: boolean) {
    if (!on || disposed) {
      clearInterval(pollTimer);
      pollTimer = undefined;
      return;
    }
    if (pollTimer !== undefined) return;
    let busy = false;
    pollTimer = setInterval(async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      const next = await checkHostStatus(true);
      busy = false;
      if (disposed || JSON.stringify(next) === JSON.stringify(state)) return;
      state = next;
      renderStatus();
    }, INSTALL_POLL_MS);
  }

  const check = async (refresh: boolean) => {
    recheck.disabled = true;
    recheck.textContent = t('hostChecking');
    state = await checkHostStatus(refresh);
    recheck.disabled = false;
    recheck.textContent = t('hostRecheck');
    renderStatus();
  };

  recheck.addEventListener('click', () => void check(true));
  update.addEventListener('click', async () => {
    update.disabled = true;
    updateResult.textContent = t('updateRunning');
    try {
      const r = await updateYtDlp();
      updateResult.replaceChildren();
      if (!r.ran && r.command) updateResult.append(t('updateRunCommand'), el('code', { className: 'code', textContent: r.command }));
      else updateResult.textContent = r.updated ? t('updateDone', r.version ?? '') : t('updateUpToDate');
    } catch {
      updateResult.textContent = t('updateFailed');
    }
    update.disabled = false;
    void check(true);
  });
  choose.addEventListener('click', async () => {
    folderError.textContent = '';
    try {
      const path = await pickFolder();
      if (path) await downloadDir.setValue(path);
    } catch (err) {
      folderError.textContent = err instanceof HostError && err.code === 'UNSUPPORTED_PLATFORM' ? t('optionsFolderUnsupported') : t('errDownloadFailed');
    }
    void renderFolder();
  });
  reset.addEventListener('click', async () => {
    await downloadDir.setValue(null);
    void renderFolder();
  });
  select.addEventListener('change', () => void namePreset.setValue(select.value));
  embedInput.disabled = true;
  void embedInfo.getValue().then((v) => {
    embedInput.checked = v !== false;
    embedInput.disabled = false;
  });
  embedInput.addEventListener('change', () => void embedInfo.setValue(embedInput.checked));
  const unwatch = downloadDir.watch(() => void renderFolder());

  renderStatus();
  void platformOs().then((value) => {
    os = value;
    if (!disposed && state) renderStatus();
  });
  void check(false);
  return () => {
    disposed = true;
    setPolling(false);
    maintenance.dispose();
    unwatch();
    cleanups.forEach((c) => c());
  };
}
