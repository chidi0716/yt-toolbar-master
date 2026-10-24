// 設定頁「下載」區的連線狀態（002 FR-2、008 FR-2、FR-24）：掛載影片／MP3 面板的元件，
// 顯示相同的元件狀態與安裝說明，另外標示各元件的來源與擴充功能本身的版本。
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ComponentList, HostSetup, RecheckButton, useHostState, type HostStateHook } from '@/components/panels/HostSetup';
import { UpdateYtDlp } from '@/components/panels/JobList';
import { component, type HostState } from '@/features/downloads/host-status';
import { t } from '@/utils/i18n';
import { extensionSource } from './host-maintenance';

/** 設定頁：缺少任何元件（包括只缺 deno）或正在自動更新時，每 3 秒檢查一次。 */
const pollWhile = (s: HostState) => s.state === 'unreachable' || !s.status.complete || !!s.status.update?.running;

export type ConnectionControl = Pick<HostStateHook, 'recheck' | 'refresh' | 'setState'>;

/** 擴充功能本身的版本與更新方式（008 FR-24）。 */
function ExtensionRow() {
  const [source, setSource] = useState('');
  useEffect(() => void extensionSource().then(setSource), []);
  const text = t('hostStatusVersion', browser.runtime.getManifest().version);
  return (
    <li data-component="extension">
      <span>{t('componentExtension')}</span>
      <span class="ytm-setup-state">{source ? `${text} · ${source}` : text}</span>
    </li>
  );
}

function Connection({ onState, control }: { onState: (state: HostState) => void; control: { current: ConnectionControl | null } }) {
  const host = useHostState(pollWhile);
  const { state } = host;
  control.current = host;
  useEffect(() => {
    if (state) onState(state);
  }, [state, onState]);
  if (!state) return <p class="ytm-muted">{t('hostChecking')}</p>;
  const update = component(state, 'yt-dlp').ok ? <UpdateYtDlp onDone={host.refresh} /> : null;
  if (state.state === 'unreachable' || !state.status.complete) {
    return <HostSetup host={{ ...host, state }} details extraRows={<ExtensionRow />} actions={update} />;
  }
  return (
    <div class="ytm-setup" data-state={state.state}>
      <ComponentList state={state} details>
        <ExtensionRow />
      </ComponentList>
      <div class="ytm-setup-actions">
        <RecheckButton host={host} />
        {update}
      </div>
    </div>
  );
}

/** 掛載到 root；onState 在每次取得新的狀態時呼叫（下載資料夾、檔名格式、自動更新等區塊使用）。 */
export function mountConnection(root: HTMLElement, onState: (state: HostState) => void): ConnectionControl & { dispose(): void } {
  const container = document.createElement('div');
  container.className = 'ytm-root';
  root.append(container);
  const control: { current: ConnectionControl | null } = { current: null };
  render(<Connection onState={onState} control={control} />, container);
  return {
    recheck: () => control.current?.recheck(),
    refresh: () => control.current?.refresh(),
    setState: (state) => control.current?.setState(state),
    dispose: () => render(null, container),
  };
}
