// 「更多」面板（003 FR-60 至 FR-64、004 FR-1）：每列左側為圖示與名稱、下方一行灰色小字說明，
// 右側為開關或下拉選單。
import { useEffect } from 'preact/hooks';
import type { Store, ToggleState } from '@/features/viewing/store';
import { t, type MessageKey } from '@/utils/i18n';
import { Select, type SelectOption } from '../controls/Select';
import { Switch } from '../controls/Switch';
import { Icon, type IconName } from '../icons';
import { useStore } from './useStore';

interface MoreItemBase {
  id: string;
  icon: IconName;
  label: MessageKey;
  description: MessageKey;
}

/** 右側為開關的項目。 */
export interface MoreSwitchItem extends MoreItemBase {
  kind?: 'switch';
  state: Store<ToggleState>;
  toggle: () => void;
}

/** 右側為下拉選單的項目（例如鎖定畫質，004 FR-1、FR-6：顯示目前選擇的值）。 */
export interface MoreSelectItem<V extends string = string> extends MoreItemBase {
  kind: 'select';
  /** 只讀取：選擇改變時由 onChange 通知功能模組。 */
  state: Pick<Store<{ value: V }>, 'get' | 'subscribe'>;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
}

export type MoreItem = MoreSwitchItem | MoreSelectItem;

function MoreSwitchRow({ item }: { item: MoreSwitchItem }) {
  const state = useStore(item.state);
  const labelId = `ytm-more-${item.id}-label`;
  const descId = `ytm-more-${item.id}-desc`;
  return (
    <li class="ytm-more-item" data-item={item.id} data-disabled={state.disabledReason ? '' : undefined}>
      <span class="ytm-more-icon">
        <Icon name={item.icon} />
      </span>
      <span class="ytm-more-text">
        <span id={labelId} class="ytm-more-name">
          {t(item.label)}
        </span>
        <span id={descId} class="ytm-more-desc">
          {state.disabledReason ?? t(item.description)}
        </span>
      </span>
      <Switch
        checked={state.active}
        disabled={!!state.disabledReason}
        labelledBy={labelId}
        describedBy={descId}
        onChange={() => item.toggle()}
      />
    </li>
  );
}

function MoreSelectRow({ item }: { item: MoreSelectItem }) {
  const { value } = useStore(item.state);
  const selectId = `ytm-more-${item.id}-select`;
  return (
    <li class="ytm-more-item" data-item={item.id}>
      <span class="ytm-more-icon">
        <Icon name={item.icon} />
      </span>
      <span class="ytm-more-text">
        <label for={selectId} class="ytm-more-name">
          {t(item.label)}
        </label>
        <span class="ytm-more-desc">{t(item.description)}</span>
      </span>
      <Select id={selectId} value={value} options={item.options} onChange={item.onChange} />
    </li>
  );
}

export function MorePanel({ items, onOpen }: { items: readonly MoreItem[]; onOpen?: () => void }) {
  // 面板打開時讓功能重新檢查 YouTube 的狀態（例如自動播放開關）。
  useEffect(() => onOpen?.(), [onOpen]);
  return (
    <ul class="ytm-more">
      {items.map((item) =>
        item.kind === 'select' ? <MoreSelectRow key={item.id} item={item} /> : <MoreSwitchRow key={item.id} item={item} />,
      )}
    </ul>
  );
}
