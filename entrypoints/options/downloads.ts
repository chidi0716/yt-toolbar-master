// 設定頁的「下載」區（002 FR-60、004 FR-11、008 FR-2、FR-24、FR-25、FR-30，tasks T23、T45、T46）：
// 各元件（小幫手、yt-dlp、ffmpeg、deno、擴充功能）的版本與來源、安裝說明、更新 yt-dlp、自動更新、移除下載功能、
// 下載資料夾、檔名格式、嵌入資訊開關。設定改變時立即寫入；背景腳本在下次下載時讀取。
import { HostError, pickFolder } from '@/features/downloads/host-client';
import type { HostState } from '@/features/downloads/host-status';
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
import { mountConnection } from './connection';
import { createMaintenance } from './host-maintenance';

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

  // ---- 連線狀態：與影片／MP3 面板相同的元件與安裝說明（Preact），狀態改變時更新其他區塊 ----
  const connection = group('connection', 'optionsConnection');
  const host = mountConnection(connection, (next) => {
    state = next;
    renderStatus();
  });

  // ---- 自動更新、移除下載功能（008） ----
  // 移除後小幫手隨即刪除自己與瀏覽器的註冊：直接顯示未安裝（安裝說明），不再查詢。
  const maintenance = createMaintenance({ refresh: host.refresh, uninstalled: () => host.setState({ state: 'unreachable' }) });

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
    choose.disabled = state?.state !== 'connected';
    maintenance.render(state);
    void renderFolder();
    void renderPresets();
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
  return () => {
    host.dispose();
    maintenance.dispose();
    unwatch();
    cleanups.forEach((c) => c());
  };
}
