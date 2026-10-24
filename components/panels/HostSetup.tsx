// 小幫手的狀態與安裝說明（002 FR-2、008 FR-1、FR-2、FR-24，tasks T16、T22、T45）。影片／MP3 面板與設定頁共用：
// - useHostState：向背景腳本查詢 status，可以重新檢查；還沒裝好的期間每 3 秒自動檢查一次（只在面板或設定頁開著時）；
// - ComponentList：各元件的狀態（設定頁另外顯示來源與路徑）；
// - HostSetup：說明會安裝什麼、必要元件的狀態，依作業系統顯示一行安裝指令（可以複製）、三步驟說明、
//   「這個指令會做什麼？」（步驟、下載來源、先檢視腳本的方式）與「重新檢查」；
// - DenoHint：只缺 deno 時的建議提示（可以下載）。
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { sendToBackground } from '@/utils/messages';
import { checkHostStatus } from '@/features/downloads/host-client';
import {
  canDownload,
  COMPONENT_LABELS,
  componentText,
  HOST_COMPONENTS,
  INSTALL_GUIDE_URL,
  showUpdateFailureHint,
  sourceLabel,
  component,
  type HostState,
} from '@/features/downloads/host-status';
import {
  detailSource,
  INSTALL_COMMANDS,
  INSTALL_DETAILS,
  INSTALL_POLL_MS,
  INSTALL_STEPS,
  INSTALL_TITLES,
  platformToOs,
  REVIEW_COMMANDS,
  type InstallOs,
} from '@/features/downloads/install-guide';
import { detectOs, type HostOs } from '@/features/downloads/logic';
import { t } from '@/utils/i18n';
import { hostUpdateHintDismissed } from '@/utils/settings';
import { Button } from '../controls/Button';
import { Icon } from '../icons';
import { useCopy } from '../useCopy';

/** 從瀏覽器的 user agent 推測作業系統（等背景腳本回覆 runtime.getPlatformInfo 之前先用）。 */
export const currentOs = (): HostOs => {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectOs(nav.userAgentData?.platform || navigator.platform || '', navigator.userAgent);
};

/**
 * 作業系統：以 runtime.getPlatformInfo 為準（plan 3.10，內容腳本經由背景腳本取得）；取得前為 null，
 * 不先以 user agent 猜測，避免顯示錯誤系統的指令。背景腳本沒有回應時才改用 user agent。
 */
let platformOs: Promise<HostOs> | null = null;
export function usePlatformOs(): HostOs | null {
  const [os, setOs] = useState<HostOs | null>(null);
  useEffect(() => {
    let current = true;
    platformOs ??= sendToBackground<{ os: string }>({ type: 'platformInfo' }).then((res) => (res.ok ? platformToOs(res.os) : currentOs()));
    void platformOs.then((value) => current && setOs(value));
    return () => {
      current = false;
    };
  }, []);
  return os;
}

/** 檢查中顯示「檢查中」至少這麼久，讓使用者看得出「重新檢查」有作用。 */
const MIN_CHECK_MS = 400;

const sameState = (a: HostState | null, b: HostState) => JSON.stringify(a) === JSON.stringify(b);

/** 面板：還不能下載的期間自動檢查（008 FR-1）。 */
const notReady = (s: HostState) => !canDownload(s);

export interface HostStateHook {
  state: HostState | null;
  checking: boolean;
  recheck: () => void;
  /** 不顯示「檢查中」地重新查詢（例如改了自動更新的設定之後）。 */
  refresh: () => void;
  /** 以指令的回應直接更新（例如移除下載功能之後，不必再查詢）。 */
  setState: (state: HostState) => void;
}

/**
 * 小幫手的狀態。pollWhile 成立的期間每 3 秒在背景檢查一次（不顯示「檢查中」），安裝完成後自動切換成可下載畫面
 * （008 FR-1）；元件卸載（面板收起、離開設定頁）時停止。分頁在背景時不檢查。
 */
export function useHostState(pollWhile: (s: HostState) => boolean = notReady): HostStateHook {
  const [state, setState] = useState<HostState | null>(null);
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setChecking(true);
    const started = Date.now();
    void checkHostStatus(attempt > 0).then(async (s) => {
      const wait = MIN_CHECK_MS - (Date.now() - started);
      if (attempt > 0 && wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!current) return;
      setState(s);
      setChecking(false);
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const refresh = useCallback(() => {
    void checkHostStatus(true).then((s) => {
      if (mounted.current) setState((prev) => (sameState(prev, s) ? prev : s));
    });
  }, []);

  const poll = state !== null && !checking && pollWhile(state);
  useEffect(() => {
    if (!poll) return;
    let busy = false;
    const timer = setInterval(() => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      void checkHostStatus(true).then((s) => {
        busy = false;
        if (mounted.current) setState((prev) => (sameState(prev, s) ? prev : s));
      });
    }, INSTALL_POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, checking, recheck, refresh, setState };
}

/**
 * 各元件的狀態。details 為 true 時（設定頁，008 FR-24）另外顯示來源，滑鼠停留時顯示路徑；
 * children 接在最後（設定頁的擴充功能本身）。
 */
export function ComponentList({ state, details = false, children }: { state: HostState; details?: boolean; children?: ComponentChildren }) {
  return (
    <ul class="ytm-setup-components">
      {HOST_COMPONENTS.map((c) => {
        const { text, missing } = componentText(state, c);
        const info = details && !missing ? component(state, c).info : null;
        const source = sourceLabel(info);
        return (
          <li key={c} data-component={c} data-missing={missing ? '' : undefined}>
            <span>{t(COMPONENT_LABELS[c])}</span>
            <span class="ytm-setup-state" title={info?.path ?? undefined}>
              {source ? `${text} · ${source}` : text}
            </span>
          </li>
        );
      })}
      {children}
    </ul>
  );
}

/** 指令與「複製」按鈕；無法寫入剪貼簿時選取指令文字，讓使用者自己複製。 */
export function CopyCommand({ command, id }: { command: string; id: string }) {
  const { copied: done, failed, copy } = useCopy<'command'>();
  const copied = done ? 'copied' : failed ? 'failed' : 'idle';
  const codeRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!failed || !codeRef.current) return;
    try {
      window.getSelection()?.selectAllChildren(codeRef.current);
    } catch {
      // 選取失敗時，指令文字仍可以手動選取（user-select: all）。
    }
  }, [failed]);
  return (
    <div class="ytm-command">
      <code ref={codeRef} id={id} class="ytm-code ytm-command-text">
        {command}
      </code>
      <Button variant="secondary" aria-describedby={id} onClick={() => copy('command', command)} data-copied={copied === 'copied' ? '' : undefined}>
        <Icon name={copied === 'copied' ? 'check' : 'content_copy'} size={18} />
        <span>{copied === 'copied' ? t('installCopied') : t('installCopy')}</span>
      </Button>
      <span class="ytm-command-status" role="status">
        {copied === 'failed' ? t('installCopyFailed') : ''}
      </span>
    </div>
  );
}

/** 一行安裝指令、三步驟與「這個指令會做什麼？」（008 FR-1）。 */
export function InstallGuide({ os, idPrefix }: { os: InstallOs; idPrefix: string }) {
  return (
    <div class="ytm-install" data-os={os}>
      <CopyCommand command={INSTALL_COMMANDS[os]} id={`${idPrefix}-command`} />
      <ol class="ytm-setup-steps">
        {INSTALL_STEPS[os].map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      <details class="ytm-install-details">
        <summary>{t('installWhatTitle')}</summary>
        <ol class="ytm-install-detail-list">
          {INSTALL_DETAILS.map((d) => {
            const source = detailSource(d, os);
            return (
              <li key={d.text}>
                <span>{t(d.text)}</span>
                {source && <code class="ytm-inline-code">{source}</code>}
              </li>
            );
          })}
        </ol>
        <p class="ytm-install-note">{t('installWhatNote')}</p>
        <p class="ytm-install-note">{t('installReview')}</p>
        <code class="ytm-code">{REVIEW_COMMANDS[os].join('\n')}</code>
      </details>
    </div>
  );
}

/**
 * 未安裝小幫手或缺少元件時的說明（002 FR-2、008 FR-1、FR-2）。設定頁以 details 顯示元件來源，
 * extraRows 接在元件清單最後，actions 放在「重新檢查」旁。
 */
export function HostSetup(props: { host: HostStateHook & { state: HostState }; details?: boolean; extraRows?: ComponentChildren; actions?: ComponentChildren }) {
  const { host, details, extraRows, actions } = props;
  const { state } = host;
  const os = usePlatformOs();
  return (
    <div class="ytm-setup" data-state={state.state}>
      <p class="ytm-setup-title">
        <Icon name="error" />
        <span>{t(state.state === 'unreachable' ? 'hostMissingTitle' : 'hostToolsMissingTitle')}</span>
      </p>
      <p class="ytm-setup-intro">{t('installIntro')}</p>
      <ComponentList state={state} details={details}>
        {extraRows}
      </ComponentList>
      {os && <p class="ytm-setup-os-title">{t(INSTALL_TITLES[os])}</p>}
      {os === 'other' ? <p class="ytm-muted ytm-setup-os">{t('hostOtherOs')}</p> : os && <InstallGuide os={os} idPrefix="ytm-install" />}
      <p class="ytm-muted ytm-install-auto" role="status">
        {t('installAutoDetect')}
      </p>
      <div class="ytm-setup-actions">
        <a class="ytm-link" href={INSTALL_GUIDE_URL} target="_blank" rel="noopener noreferrer">
          <Icon name="open_in_new" size={20} />
          <span>{t('hostInstallGuide')}</span>
        </a>
        <RecheckButton host={host} />
        {actions}
      </div>
    </div>
  );
}

/** 「重新檢查」：檢查中顯示「檢查中」。 */
export function RecheckButton({ host }: { host: Pick<HostStateHook, 'checking' | 'recheck'> }) {
  return (
    <Button variant="primary" disabled={host.checking} onClick={host.recheck}>
      <Icon name="refresh" size={18} />
      <span>{host.checking ? t('hostChecking') : t('hostRecheck')}</span>
    </Button>
  );
}

/** 只缺 deno 時的提示（可以下載，但取得不到部分格式）：再執行一次安裝指令即可補上。 */
export function DenoHint() {
  const os = usePlatformOs();
  const command = os && os !== 'other' ? INSTALL_COMMANDS[os] : null;
  return (
    <div class="ytm-hint ytm-deno-hint" role="note">
      <Icon name="error" size={18} />
      <span>
        {t('hostDenoHint')}
        {command && <CopyCommand command={command} id="ytm-deno-command" />}
      </span>
    </div>
  );
}

/**
 * 小幫手自動更新連續失敗 3 次以上時的一行提示（008 FR-25、FR-29c）：只在使用者打開下載面板時看到，
 * 可以關閉（直到下一次失敗），並連到設定頁查看詳情。
 */
export function UpdateFailureHint({ state, onOpenSettings }: { state: HostState; onOpenSettings: () => void }) {
  const [dismissed, setDismissed] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    void hostUpdateHintDismissed.getValue().then((v) => setDismissed(typeof v === 'number' ? v : null));
  }, []);
  if (dismissed === undefined || !showUpdateFailureHint(state, dismissed)) return null;
  const lastCheck = state.state === 'connected' ? (state.status.update?.lastCheck ?? null) : null;
  return (
    <div class="ytm-hint ytm-update-failed-hint" role="note">
      <Icon name="error" size={18} />
      <span class="ytm-update-failed-text">
        {t('hostUpdateFailingHint')}{' '}
        <button type="button" class="ytm-inline-link" onClick={onOpenSettings}>
          {t('helpOpenSettings')}
        </button>
      </span>
      <button
        type="button"
        class="ytm-icon-btn ytm-hint-close"
        aria-label={t('hintDismiss')}
        title={t('hintDismiss')}
        onClick={() => {
          setDismissed(lastCheck ?? Date.now());
          void hostUpdateHintDismissed.setValue(lastCheck ?? Date.now());
        }}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
