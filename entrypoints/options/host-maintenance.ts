// 設定頁「下載」區的自動更新與移除（008 FR-24、FR-25、FR-30，plan 3.10）。以 DOM API 建立。
import { createIconElement } from '@/components/icon-data';
import { checkUpdates, HostError, setAutoUpdate, uninstallHost } from '@/features/downloads/host-client';
import { UPDATE_FAILURE_HINT_AT, type HostState } from '@/features/downloads/host-status';
import { t, type MessageKey } from '@/utils/i18n';
import type { HostUpdateInfo } from '@/utils/native-protocol';
import { hostUpdateHintDismissed } from '@/utils/settings';
import { el, formatDateTime, group, statusRow } from './dom';

const RESULT_LABELS: Record<NonNullable<HostUpdateInfo['lastResult']>, MessageKey> = {
  ok: 'updatesResultOk',
  updated: 'updatesResultUpdated',
  failed: 'updatesResultFailed',
};

/** 「最近一次檢查」的文字。 */
export function lastCheckText(u: HostUpdateInfo): string {
  if (u.running) return t('updatesRunning');
  if (u.lastCheck === null) return t('updatesNever');
  return u.lastResult ? t('updatesLastCheckResult', [formatDateTime(u.lastCheck), t(RESULT_LABELS[u.lastResult])]) : formatDateTime(u.lastCheck);
}

/** 擴充功能本身的版本與更新方式（008 FR-24）。 */
export async function extensionSource(): Promise<string> {
  try {
    const self = await browser.management?.getSelf?.();
    return self?.installType === 'development' ? t('extensionSourceManual') : t('extensionSourceAuto');
  } catch {
    return '';
  }
}

export interface MaintenanceSection {
  readonly elements: HTMLElement[];
  render(state: HostState | null): void;
  dispose(): void;
}

/**
 * 自動更新（開關、立即檢查、最近一次結果、連續失敗提示）與移除下載功能。
 * refresh：重新查詢 status（不使用暫存），結果再以 render 傳回；更新進行中的定時檢查由連線狀態區負責。
 * uninstalled：移除成功後呼叫。
 */
export function createMaintenance({ refresh, uninstalled }: { refresh: () => void; uninstalled: () => void }): MaintenanceSection {
  // ---- 自動更新（FR-24、FR-25） ----
  const updates = group('updates', 'updatesTitle');
  const autoInput = el('input', { type: 'checkbox', id: 'downloads-auto-update', className: 'switch' });
  autoInput.setAttribute('role', 'switch');
  autoInput.setAttribute('aria-describedby', 'downloads-auto-update-desc');
  const autoRow = el(
    'div',
    { className: 'option' },
    el(
      'label',
      { className: 'option-text', htmlFor: 'downloads-auto-update' },
      el('span', { className: 'option-name', textContent: t('updatesAuto') }),
      el('span', { className: 'option-desc', id: 'downloads-auto-update-desc', textContent: t('updatesAutoDesc') }),
    ),
    autoInput,
  );
  const lastRow = statusRow(t('updatesLastCheck'), '', 'downloads-last-check');
  const checkNow = el('button', { type: 'button', className: 'button', id: 'downloads-check-updates', textContent: t('updatesCheckNow') });
  const updatesMessage = el('p', { className: 'option-desc update-result', id: 'downloads-updates-message' });
  updatesMessage.setAttribute('role', 'status');
  const failures = el('p', { className: 'option-desc error', id: 'downloads-update-failures' });
  const showHint = el('button', { type: 'button', className: 'button', id: 'downloads-show-update-hint', textContent: t('updatesShowHint') });
  const unsupported = el('p', { className: 'option-desc', id: 'downloads-updates-unsupported', textContent: t('updatesUnsupported') });
  updates.append(autoRow, el('div', { className: 'status-list' }, lastRow), failures, el('div', { className: 'actions' }, checkNow, showHint), updatesMessage, unsupported);

  // ---- 移除下載功能（FR-30） ----
  const remove = group('uninstall', 'uninstallTitle');
  const removeButton = el('button', { type: 'button', className: 'button danger with-icon', id: 'downloads-uninstall' }, createIconElement('delete', 18), t('uninstallButton'));
  const removeMessage = el('p', { className: 'option-desc update-result', id: 'downloads-uninstall-message' });
  removeMessage.setAttribute('role', 'status');
  remove.append(el('p', { className: 'option-desc', textContent: t('uninstallDesc') }), el('div', { className: 'actions' }, removeButton), removeMessage);

  // 確認對話框（在設定頁內，不使用瀏覽器的 confirm，plan 3.10）。
  const dialog = el('dialog', { className: 'confirm', id: 'downloads-uninstall-dialog' });
  dialog.setAttribute('aria-labelledby', 'downloads-uninstall-dialog-title');
  dialog.setAttribute('aria-describedby', 'downloads-uninstall-dialog-desc');
  const cancel = el('button', { type: 'button', className: 'button', id: 'downloads-uninstall-cancel', textContent: t('uninstallCancel') });
  const confirm = el('button', { type: 'button', className: 'button danger', id: 'downloads-uninstall-confirm', textContent: t('uninstallConfirm') });
  dialog.append(
    el('h3', { id: 'downloads-uninstall-dialog-title', textContent: t('uninstallDialogTitle') }),
    el('p', { id: 'downloads-uninstall-dialog-desc', textContent: t('uninstallDialogDesc') }),
    el('div', { className: 'actions dialog-actions' }, cancel, confirm),
  );
  remove.append(dialog);

  const render = (next: HostState | null) => {
    const connected = next?.state === 'connected';
    const u = connected ? next.status.update : null;
    updates.hidden = !connected;
    remove.hidden = !connected;
    if (!connected) return;
    unsupported.hidden = u !== null;
    for (const node of [autoRow, lastRow.parentElement!, failures, checkNow.parentElement!]) node.hidden = u === null;
    if (!u) return;
    autoInput.checked = u.auto;
    autoInput.disabled = false;
    lastRow.lastElementChild!.textContent = lastCheckText(u);
    checkNow.disabled = u.running;
    const failing = u.consecutiveFailures >= UPDATE_FAILURE_HINT_AT;
    failures.textContent = failing ? t('updatesFailures', String(u.consecutiveFailures)) : '';
    failures.hidden = !failing;
    showHint.hidden = true;
    if (failing) {
      void hostUpdateHintDismissed.getValue().then((v) => {
        showHint.hidden = !(typeof v === 'number' && (u.lastCheck === null || v === u.lastCheck));
      });
    }
  };

  autoInput.addEventListener('change', async () => {
    const enabled = autoInput.checked;
    autoInput.disabled = true;
    updatesMessage.textContent = '';
    try {
      await setAutoUpdate(enabled);
    } catch {
      autoInput.checked = !enabled;
      updatesMessage.textContent = t('updatesSaveFailed');
    }
    autoInput.disabled = false;
    refresh();
  });
  checkNow.addEventListener('click', async () => {
    checkNow.disabled = true;
    updatesMessage.textContent = '';
    try {
      const started = await checkUpdates();
      updatesMessage.textContent = started ? t('updatesStarted') : t('updatesAlreadyRunning');
    } catch {
      updatesMessage.textContent = t('updatesSaveFailed');
    }
    refresh();
  });
  showHint.addEventListener('click', async () => {
    await hostUpdateHintDismissed.setValue(null);
    showHint.hidden = true;
  });

  removeButton.addEventListener('click', () => {
    removeMessage.textContent = '';
    dialog.showModal();
    cancel.focus();
  });
  cancel.addEventListener('click', () => dialog.close());
  confirm.addEventListener('click', async () => {
    dialog.close();
    removeButton.disabled = true;
    removeMessage.textContent = t('uninstallRunning');
    try {
      await uninstallHost();
      removeMessage.textContent = t('uninstallDone');
      uninstalled();
    } catch (err) {
      removeMessage.textContent = err instanceof HostError && err.code === 'JOBS_RUNNING' ? t('errJobsRunning') : t('uninstallFailed');
    }
    removeButton.disabled = false;
  });

  render(null);
  return {
    elements: [updates, remove],
    render,
    dispose() {
      if (dialog.open) dialog.close();
    },
  };
}
