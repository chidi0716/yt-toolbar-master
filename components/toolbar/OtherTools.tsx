// 「更多」面板的「其他工具」區塊（006 FR-15、FR-16）：隱藏的工具以「圖示＋名稱」一列顯示，
// 點擊的效果與在工具列上點擊相同。
// - 面板類：收起「更多」，改為展開該工具的面板（對齊「更多」按鈕）；
// - 切換類：列上顯示目前的開關狀態，點擊即切換；
// - 執行類（截圖）：點擊即執行，完成或錯誤的提示顯示在列上。
import { t } from '@/utils/i18n';
import type { ToolId } from '@/utils/toolbar-layout';
import { Switch } from '../controls/Switch';
import { Icon } from '../icons';
import { isToolOngoing, TOOLS, type ButtonId } from './buttons';
import type { ToggleFeature } from './Toolbar';

export interface OtherToolsProps {
  hidden: readonly ToolId[];
  toggles: Partial<Record<ButtonId, ToggleFeature>>;
  activePanels?: ReadonlySet<ButtonId>;
  progress?: Partial<Record<ButtonId, number | 'indeterminate' | null>>;
  onOpen: (id: ToolId) => void;
}

export function OtherTools({ hidden, toggles, activePanels, progress, onOpen }: OtherToolsProps) {
  if (hidden.length === 0) return null;
  return (
    <section class="ytm-other-tools" aria-labelledby="ytm-other-tools-title">
      <h3 id="ytm-other-tools-title" class="ytm-other-title">
        {t('moreOtherTools')}
      </h3>
      <ul class="ytm-other-list">
        {hidden.map((id) => {
          const def = TOOLS[id];
          const feature = toggles[id];
          const name = t(def.label);
          const busy = isToolOngoing(id, { progress, activePanels, toggles });
          if (def.kind === 'toggle') {
            const labelId = `ytm-other-${id}-label`;
            const descId = `ytm-other-${id}-desc`;
            const desc = feature?.notice ?? feature?.disabledReason;
            return (
              <li key={id} class="ytm-other-item" data-tool={id} data-busy={busy ? '' : undefined}>
                <span class="ytm-other-icon">
                  <Icon name={def.icon} />
                </span>
                <span class="ytm-other-text">
                  <span id={labelId} class="ytm-other-name">
                    {name}
                  </span>
                  {desc && (
                    <span id={descId} class="ytm-other-desc">
                      {desc}
                    </span>
                  )}
                </span>
                <Switch
                  checked={!!feature?.active}
                  disabled={!feature || !!feature.disabledReason}
                  labelledBy={labelId}
                  describedBy={desc ? descId : undefined}
                  onChange={() => onOpen(id)}
                />
              </li>
            );
          }
          const status = feature?.notice;
          return (
            <li key={id} class="ytm-other-item" data-tool={id} data-busy={busy ? '' : undefined}>
              <button type="button" class="ytm-other-btn" aria-haspopup={def.kind === 'panel' ? 'dialog' : undefined} onClick={() => onOpen(id)}>
                <span class="ytm-other-icon">
                  <Icon name={def.icon} />
                </span>
                <span class="ytm-other-text">
                  <span class="ytm-other-name">{name}</span>
                  {status && (
                    <span class="ytm-other-desc" role="status">
                      {status}
                    </span>
                  )}
                </span>
                {busy && <span class="ytm-other-dot" role="img" aria-label={t('moreHiddenActive')} />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
