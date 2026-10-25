// 設定頁「關於」區（008 FR-29、FR-29a，plan 3.9）：目前版本、最新版本、最近一次查詢時間、「前往下載」，
// 以及選過「不再提醒」時的「重新開啟新版本提醒」。設定頁不會自己查詢（查詢只在開啟影片頁時進行，FR-27）。
import { sendToBackground, type ContentMessage } from '@/utils/messages';
import { t } from '@/utils/i18n';
import { updateCheck, updateReminder } from '@/utils/settings';
import { isNewer, isReleaseUrl, type ReminderView } from '@/utils/update-check';
import { formatDateTime, statusRow as row } from './dom';

async function send(message: ContentMessage): Promise<ReminderView | null> {
  const res = await sendToBackground<{ view: ReminderView }>(message);
  return res.ok ? res.view : null;
}

/** 繪製「關於」區；回傳的函式取消監聽。 */
export function renderAbout(root: HTMLElement): () => void {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'group';
  fieldset.dataset.category = 'about';
  const list = document.createElement('div');
  list.className = 'status-list';
  const status = document.createElement('p');
  status.className = 'option-desc about-status';
  status.id = 'about-status';
  status.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'actions';
  const note = document.createElement('p');
  note.className = 'option-desc';
  note.id = 'about-note';
  fieldset.append(list, status, actions, note);
  root.append(fieldset);

  const render = (view: ReminderView | null) => {
    const current = view?.currentVersion ?? browser.runtime.getManifest().version;
    list.replaceChildren(row(t('aboutCurrentVersion'), current, 'about-current'));
    actions.replaceChildren();
    if (!view || !view.eligible) {
      // Firefox 簽署版：由瀏覽器自動更新，不查詢也不提醒（FR-26）。
      status.textContent = view ? t('aboutAutoUpdated') : '';
      note.textContent = '';
      return;
    }
    const checked =
      view.lastCheckedAt === null
        ? t('aboutNotChecked')
        : view.lastResult === 'failed'
          ? t('aboutCheckFailed', formatDateTime(view.lastCheckedAt))
          : formatDateTime(view.lastCheckedAt);
    list.append(row(t('aboutLatestVersion'), view.latest?.version ?? t('aboutNotChecked'), 'about-latest'), row(t('aboutLastChecked'), checked, 'about-checked'));
    note.textContent = t('aboutCheckNote');
    if (view.disabled) {
      status.textContent = t('aboutRemindersOff');
      const enable = document.createElement('button');
      enable.type = 'button';
      enable.className = 'button';
      enable.id = 'about-reenable';
      enable.textContent = t('aboutReenable');
      enable.addEventListener('click', () => void send({ type: 'updateAction', action: 'enable', version: null }).then(render));
      actions.append(enable);
      return;
    }
    const latest = view.latest;
    // 有比目前版本新的版本時（即使跳過或已點過「前往下載」）都提供「前往下載」（FR-29a）。
    const newer = !!latest && isNewer(latest.version, current);
    status.textContent = !latest ? '' : newer ? t('aboutNewAvailable', latest.version) : t('aboutUpToDate');
    if (latest && newer && isReleaseUrl(latest.url)) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'button primary';
      open.id = 'about-open';
      open.textContent = t('updateReminderOpen');
      open.addEventListener('click', () => {
        window.open(latest.url, '_blank', 'noopener');
        void send({ type: 'updateAction', action: 'open', version: latest.version }).then(render);
      });
      actions.append(open);
    }
  };

  const refresh = () => void send({ type: 'updateStatus' }).then(render);
  render(null);
  refresh();
  const unwatch = [updateCheck.watch(refresh), updateReminder.watch(refresh)];
  return () => unwatch.forEach((u) => u());
}
