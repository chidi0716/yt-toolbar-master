// 工具列外框（001）：依使用者的設定（006）排出左右兩組工具，最右邊是固定的「更多」「關閉」；
// 目前展開的面板；以及編輯模式（006 FR-1、FR-3 至 FR-5）。
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { UpdateReminder } from '@/features/update/content';
import type { ReminderState } from '@/features/update/reminder';
import { createStore } from '@/features/viewing/store';
import { t } from '@/utils/i18n';
import { defaultLayout, splitLayout, type ToolbarLayout, type ToolId } from '@/utils/toolbar-layout';
import { Icon } from '../icons';
import { useLocale } from '../useLocale';
import { ComingSoon } from '../panels/PanelStatus';
import { useStore } from '../panels/useStore';
import { FIXED, TOOLS, getButton, isToolOngoing, type ButtonDef, type ButtonId } from './buttons';
import { OtherTools } from './OtherTools';
import { initialPanelState, panelReducer, reminderBlocked } from './panel-state';
import { PanelHost } from './PanelHost';
import type { HorizontalRange } from './position';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarEditor } from './ToolbarEditor';
import { UpdateCard, UpdateNotice } from './UpdateCard';

/** 切換按鈕背後的功能（003 由各功能模組提供）。 */
export interface ToggleFeature {
  active: boolean;
  toggle: () => void;
  /** 不能使用時的原因：按鈕停用，提示文字顯示原因（003 FR-32）。 */
  disabledReason?: string;
  /** 短暫顯示在提示文字中的訊息（003 FR-15）。 */
  notice?: string;
}

export interface ToolbarProps {
  /** Shadow DOM 的宿主元素。 */
  host: HTMLElement;
  /** 目前影片 ID；改變代表 YouTube 換頁了（FR-4）。 */
  videoId: string;
  /** 播放器左右緣（視窗座標）。 */
  getBounds: () => HorizontalRange | null;
  /** 切換按鈕的功能；未提供的按鈕顯示「即將推出」。 */
  toggles?: Partial<Record<ButtonId, ToggleFeature>>;
  /** 直接執行的按鈕（截圖、關閉）。 */
  actions?: Partial<Record<ButtonId, () => void>>;
  /** 面板內容；未提供的面板顯示「即將推出」。 */
  renderPanel?: (id: ButtonId) => ComponentChildren | undefined;
  /** 面板按鈕背後的功能正在進行中（例如循環播放，003 FR-52），按鈕維持開啟狀態。 */
  activePanels?: ReadonlySet<ButtonId>;
  /** 下載進度（002 FR-3）：0–100、不確定（FR-6b）或沒有進行中的下載（null）。 */
  progress?: Partial<Record<ButtonId, number | 'indeterminate' | null>>;
  /** 使用者的工具列設定（006）；未提供時為預設值。 */
  layout?: ToolbarLayout;
  /** 編輯模式按「完成」時儲存設定（006 FR-4）。 */
  onSaveLayout?: (layout: ToolbarLayout) => void;
  /** 新版本提醒（008 FR-28、FR-29b）：工具列下方的卡片、「更多」上的小圓點與選單頂端的提醒。 */
  reminder?: UpdateReminder;
  /** 取代按鈕名稱的提示文字（009 FR-7：一鍵下載時標明點下去會發生什麼）。 */
  tooltips?: Partial<Record<ButtonId, string>>;
}

const NO_REMINDER = createStore<ReminderState>({ phase: 'none', view: null, cardVisible: false });

const COMING_SOON_MS = 1500;

export function Toolbar({
  host,
  videoId,
  getBounds,
  toggles = {},
  actions = {},
  renderPanel,
  activePanels,
  progress,
  layout = defaultLayout(),
  onSaveLayout,
  reminder,
  tooltips,
}: ToolbarProps) {
  useLocale();
  const reminderState = useStore(reminder?.controller.state ?? NO_REMINDER);
  const [state, dispatch] = useReducer(panelReducer<ButtonId>, initialPanelState<ButtonId>());
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<ButtonId, HTMLButtonElement>());
  const [notice, setNotice] = useState<ButtonId | null>(null);
  /** 編輯中的暫存設定；null 表示不在編輯模式（006 FR-4：按「完成」才儲存）。 */
  const [draft, setDraft] = useState<ToolbarLayout | null>(null);
  const editing = draft !== null;

  // YouTube 換頁：未釘選的面板收起，釘選的面板維持並更新內容（FR-4、FR-13）；編輯模式自動取消（006 FR-5）。
  const lastVideoId = useRef(videoId);
  useEffect(() => {
    if (lastVideoId.current === videoId) return;
    lastVideoId.current = videoId;
    dispatch({ type: 'navigate' });
    setDraft(null);
  }, [videoId]);

  // 面板收起後焦點回到按鈕（FR-19）；隱藏的工具從「更多」開啟時回到「更多」。焦點已在頁面其他地方時不搶。
  useEffect(() => {
    const id = state.restoreFocusTo;
    if (!id) return;
    const active = document.activeElement;
    if (host.shadowRoot?.activeElement || !active || active === document.body || active === host) {
      (buttonRefs.current.get(id) ?? buttonRefs.current.get('more'))?.focus();
    }
    dispatch({ type: 'focusRestored' });
  }, [state.restoreFocusTo, host]);

  // 「即將推出」提示：一次性的計時器，閒置時不會有計時器在跑（NFR-3）。
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), COMING_SOON_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const onEscape = useCallback(() => dispatch({ type: 'escape' }), []);
  const onOutside = useCallback(() => dispatch({ type: 'outside' }), []);
  const onPin = useCallback(() => dispatch({ type: 'pin' }), []);
  const onUnpin = useCallback(() => dispatch({ type: 'unpin' }), []);

  // ---- 編輯模式 ----
  const focusMoreLater = useRef(false);
  const startEditing = useCallback(() => {
    dispatch({ type: 'close' });
    setDraft(layout);
  }, [layout]);
  const finishEditing = (save: boolean) => {
    if (save && draft) onSaveLayout?.(draft);
    setDraft(null);
    focusMoreLater.current = true;
  };
  useEffect(() => {
    if (editing || !focusMoreLater.current) return;
    focusMoreLater.current = false;
    if (host.shadowRoot?.activeElement || document.activeElement === document.body) buttonRefs.current.get('more')?.focus();
  }, [editing, host]);
  // Esc 取消編輯（006 FR-4）。工具列內的按鍵在 Shadow DOM 邊界被停止冒泡，所以在 document 的 capture 階段監聽；
  // 只在編輯模式中監聽（006 NFR-1）。
  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
      focusMoreLater.current = true;
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [editing]);

  // 新版本提醒：工具列掛載時才可能出現卡片（工具列被關閉時不顯示，FR-29b）；展開面板或編輯工具列時延後（constitution 第 7c 點）。
  useEffect(() => {
    if (!reminder) return;
    reminder.attach(host);
    return () => reminder.attach(null);
  }, [reminder, host]);
  useEffect(() => reminder?.setToolbarBlocked(reminderBlocked(state, editing)), [reminder, state.openId, editing]);

  const handleClick = (def: ButtonDef) => {
    if (def.kind === 'panel') {
      dispatch({ type: 'toggle', id: def.id });
    } else if (def.kind === 'toggle' && toggles[def.id]) {
      if (!toggles[def.id]!.disabledReason) toggles[def.id]!.toggle();
    } else if (def.kind === 'action' && actions[def.id]) {
      actions[def.id]!();
    } else {
      setNotice(def.id);
    }
  };

  const { left, right, hidden } = splitLayout(layout);
  /** 隱藏的工具有進行中的狀態（下載、循環、浮動等）：「更多」按鈕顯示提示圓點（006 FR-17）。 */
  const hiddenOngoing = hidden.some((id) => isToolOngoing(id, { progress, activePanels, toggles }));
  /** 提醒卡片收合後，「更多」上的小圓點保留到使用者處理為止（FR-28）。 */
  const updateDot = reminderState.phase === 'collapsed';

  const renderButton = (def: ButtonDef, align: 'start' | 'center' | 'end') => {
    const label = t(def.label);
    const disabledReason = toggles[def.id]?.disabledReason;
    const toggleNotice = toggles[def.id]?.notice;
    const dot = def.id === 'more' && (hiddenOngoing || updateDot);
    const dotNotes = def.id === 'more' ? [hiddenOngoing && t('moreHiddenActive'), updateDot && t('updateReminderDot')].filter(Boolean) : [];
    return (
      <ToolbarButton
        key={def.id}
        def={def}
        label={dotNotes.length ? `${label} (${dotNotes.join(', ')})` : label}
        tooltip={
          toggleNotice ?? (notice === def.id ? t('comingSoon') : disabledReason ? `${label}: ${disabledReason}` : (tooltips?.[def.id] ?? label))
        }
        notice={notice === def.id || !!toggleNotice}
        expanded={state.openId === def.id}
        pressed={def.kind === 'panel' ? activePanels?.has(def.id) : toggles[def.id]?.active}
        disabledReason={disabledReason}
        controls={panelDomId(def.id)}
        tooltipAlign={align}
        buttonRef={(el: HTMLButtonElement | null) => {
          if (el) buttonRefs.current.set(def.id, el);
          else buttonRefs.current.delete(def.id);
        }}
        onClick={() => handleClick(def)}
        progress={progress?.[def.id] ?? null}
        dot={dot}
      />
    );
  };

  const openDef = state.openId ? getButton(state.openId) : null;
  // 隱藏的工具從「更多」開啟時，面板對齊「更多」按鈕（006 FR-15）。
  const openButton = state.openId ? (buttonRefs.current.get(state.openId) ?? buttonRefs.current.get('more')) : undefined;
  const rightDefs = [...right.map((id) => TOOLS[id]), FIXED.more, FIXED.close];

  if (draft) {
    return (
      <div ref={containerRef} class="ytm-toolbar" data-editing="" role="group" aria-label={t('editToolbarLabel')}>
        <ToolbarEditor
          draft={draft}
          onChange={setDraft}
          onDone={() => finishEditing(true)}
          onCancel={() => finishEditing(false)}
          onReset={() => setDraft(defaultLayout())}
        />
      </div>
    );
  }

  const panelContent = (id: ButtonId) => {
    const content = renderPanel?.(id) ?? <ComingSoon />;
    if (id !== 'more') return content;
    // 「更多」面板：上方為隱藏的工具（006 FR-15、FR-16），最下方為「編輯工具列」（006 FR-1）。
    return (
      <>
        {reminder && reminderState.view?.pending && <UpdateNotice view={reminderState.view} reminder={reminder} />}
        <OtherTools
          hidden={hidden}
          toggles={toggles}
          activePanels={activePanels}
          progress={progress}
          onOpen={(tool: ToolId) => handleClick(TOOLS[tool])}
        />
        {content}
        <button type="button" class="ytm-more-edit" onClick={startEditing}>
          <Icon name="edit" size={20} />
          <span>{t('moreEditToolbar')}</span>
        </button>
      </>
    );
  };

  return (
    <div ref={containerRef} class="ytm-toolbar" role="group" aria-label={t('toolbarLabel')}>
      <div class="ytm-group" data-group="left">
        {left.map((id, i) => renderButton(TOOLS[id], i === 0 ? 'start' : 'center'))}
      </div>
      <div class="ytm-group" data-group="right">
        {rightDefs.map((def, i) => renderButton(def, i === rightDefs.length - 1 ? 'end' : 'center'))}
      </div>
      {reminder && reminderState.cardVisible && reminderState.view && <UpdateCard view={reminderState.view} reminder={reminder} />}
      {openDef && openButton && containerRef.current && (
        <PanelHost
          key={openDef.id}
          panelId={panelDomId(openDef.id)}
          title={t(openDef.panelTitle ?? openDef.label)}
          pinned={state.pinned}
          container={containerRef.current}
          button={openButton}
          host={host}
          getBounds={getBounds}
          onPin={onPin}
          onUnpin={onUnpin}
          onEscape={onEscape}
          onOutside={onOutside}
        >
          {panelContent(openDef.id)}
        </PanelHost>
      )}
    </div>
  );
}

function panelDomId(id: ButtonId): string {
  return `ytm-panel-${id}`;
}
