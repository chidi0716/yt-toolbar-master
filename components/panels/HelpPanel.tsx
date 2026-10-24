// 說明面板（001 FR-17、FR-18、006 FR-25）：列出目前工具列上顯示的工具（含固定的「更多」「關閉」）的圖示、
// 名稱與一句話說明；有隱藏的工具時，最後加一行「隱藏的工具可以從『更多』選單使用」。
// 並提供開啟設定頁的連結。內容完全內建，不開啟外部網站。
import { t } from '@/utils/i18n';
import type { ContentMessage } from '@/utils/messages';
import { defaultLayout, splitLayout, type ToolbarLayout } from '@/utils/toolbar-layout';
import { Icon } from '../icons';
import { FIXED, TOOLS } from '../toolbar/buttons';

function openOptions() {
  const message: ContentMessage = { type: 'openOptions' };
  browser.runtime.sendMessage(message).catch((err: unknown) => {
    console.info('[yt-toolbar-master] failed to open settings', err);
  });
}

export function HelpPanel({ layout = defaultLayout() }: { layout?: ToolbarLayout }) {
  const { left, right, hidden } = splitLayout(layout);
  const shown = [...left.map((id) => TOOLS[id]), ...right.map((id) => TOOLS[id]), FIXED.more, FIXED.close];
  return (
    <div class="ytm-help">
      <ul class="ytm-help-list">
        {shown.map((b) => (
          <li key={b.id} class="ytm-help-item" data-button={b.id}>
            <span class="ytm-help-icon">
              <Icon name={b.icon} />
            </span>
            <span class="ytm-help-text">
              <span class="ytm-help-name">{t(b.label)}</span>
              <span class="ytm-help-desc">{t(b.description)}</span>
            </span>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && <p class="ytm-muted ytm-help-hidden">{t('helpHiddenTools')}</p>}
      <button type="button" class="ytm-link" onClick={openOptions}>
        <Icon name="settings" size={20} />
        <span>{t('helpOpenSettings')}</span>
      </button>
    </div>
  );
}
