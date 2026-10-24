// 面板內容的共通狀態（001 FR-14）：載入中、錯誤與重試、尚未推出。
import { t } from '@/utils/i18n';
import { Button } from '../controls/Button';
import { Icon } from '../icons';

export function PanelLoading() {
  return (
    <div class="ytm-status" role="status" aria-live="polite">
      <span class="ytm-spinner">
        <Icon name="progress_activity" />
      </span>
      <span>{t('loading')}</span>
    </div>
  );
}

export function PanelError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div class="ytm-status ytm-status-error" role="alert">
      <Icon name="error" />
      <span>{message ?? t('errorGeneric')}</span>
      <Button variant="secondary" onClick={onRetry}>
        <Icon name="refresh" size={18} />
        <span>{t('retry')}</span>
      </Button>
    </div>
  );
}

export function ComingSoon() {
  return <p class="ytm-muted">{t('comingSoon')}</p>;
}
