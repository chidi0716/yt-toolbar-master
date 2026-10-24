// 工具列的掛載與重新掛載（001 FR-1 至 FR-5、plan 3.4）。
//
// - 只在影片觀看頁、且「啟用」設定為開時顯示。
// - 換頁（yt-navigate-finish）時重新檢查；同一條工具列只會有一個。
// - 只觀察錨點的父節點，YouTube 把工具列移除時重新插入；離開觀看頁時停止觀察（NFR-3）。
// - 全螢幕時隱藏。
import { render } from 'preact';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { HelpPanel } from '@/components/panels/HelpPanel';
import { LinkPanel } from '@/components/panels/LinkPanel';
import { LoopPanel } from '@/components/panels/LoopPanel';
import { MorePanel, type MoreItem, type MoreSwitchItem } from '@/components/panels/MorePanel';
import { SubtitlePanel } from '@/components/panels/SubtitlePanel';
import { ThumbnailPanel } from '@/components/panels/ThumbnailPanel';
import { Mp3Panel, VideoPanel } from '@/components/panels/VideoPanel';
import panelsCss from '@/components/panels/panels.css?inline';
import type { ButtonId } from '@/components/toolbar/buttons';
import { Toolbar, type ToolSources } from '@/components/toolbar/Toolbar';
import controlsCss from '@/components/controls/controls.css?inline';
import toolbarCss from '@/components/toolbar/toolbar.css?inline';
import { createScreenshot } from '@/features/downloads/content';
import { downloadJobs, quickSettings, type QuickSettings } from '@/features/downloads/host-client';
import { buttonProgress } from '@/features/downloads/jobs';
import { quickTooltip } from '@/features/downloads/quick';
import { createUpdateReminder } from '@/features/update/content';
import { createViewingController } from '@/features/viewing';
import { derive } from '@/features/viewing/store';
import { initI18n, onLocaleChange, t } from '@/utils/i18n';
import { enabled, QUALITY_LOCK_VALUES, readSettings, toolbarLayout, uiLanguage, type QualityLock } from '@/utils/settings';
import { normalizeLayout, type ToolbarLayout } from '@/utils/toolbar-layout';
import { WATCH_HOSTS, findPlayer, findToolbarAnchor } from '@/utils/youtube/dom';
import { getVideoId, isWatchPage, onNavigate } from '@/utils/youtube/page';

const LOG_PREFIX = '[yt-toolbar-master]';
/** 首次載入時等待錨點出現的上限；超過就安靜放棄（constitution 第 7 點）。 */
const ANCHOR_WAIT_MS = 20_000;

const pick = (f: { state: MoreSwitchItem['state']; toggle: () => void }) => ({ state: f.state, toggle: f.toggle });

/** 鎖定畫質下拉選單的選項（004 FR-1）。 */
const qualityOptions = () =>
  QUALITY_LOCK_VALUES.map((value: QualityLock) => ({
    value,
    label: value === 'off' ? t('qualityOff') : value === 'max' ? t('qualityMax') : `${value}p`,
  }));

export async function startToolbar(ctx: ContentScriptContext): Promise<void> {
  // 介面語言、是否顯示、工具列設定一次讀取。
  const [language, enabledValue, layoutValue] = await readSettings([uiLanguage, enabled, toolbarLayout] as const);
  await initI18n(language);
  let isEnabled = enabledValue;
  // 自訂工具列（006）：讀取時驗證並與預設清單合併；其他分頁或設定頁改變時立即重新繪製（FR-21、FR-22）。
  let layout: ToolbarLayout = normalizeLayout(layoutValue);
  let videoId: string | null = null;
  let parentObserver: MutationObserver | null = null;
  let observedParent: Element | null = null;
  let waitObserver: MutationObserver | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  let waitFrame = 0;

  // 觀看輔助功能（003）：工具列啟用、且在支援的網域時才作用；停用時還原所有修改。
  const viewing = createViewingController();
  const updateViewing = () => viewing.setActive(isEnabled && WATCH_HOSTS.includes(location.hostname));

  const getBounds = () => {
    const rect = findPlayer()?.getBoundingClientRect();
    return rect && rect.width > 0 ? { left: rect.left, right: rect.right } : null;
  };

  const ui = await createShadowRootUi<HTMLElement>(ctx, {
    name: 'ytm-toolbar',
    position: 'inline',
    anchor: () => findToolbarAnchor()?.before ?? null,
    append: 'before',
    css: `${toolbarCss}\n${controlsCss}\n${panelsCss}`,
    // 工具列內的按鍵不要冒泡到 YouTube，避免觸發 YouTube 的鍵盤快捷鍵（FR-19）。
    isolateEvents: true,
    onMount(container, _shadow, host) {
      container.classList.add('ytm-root');
      const anchor = findToolbarAnchor();
      if (anchor) host.style.setProperty('--ytm-font-family', getComputedStyle(anchor.parent).fontFamily);
      renderInto(container, host);
      return container;
    },
    onRemove(container) {
      if (container) render(null, container);
    },
  });

  // ✕：隱藏工具列並記住，等同把彈出視窗的「啟用」關掉（001 FR-15、FR-16）。
  // enabled.watch 收到變更後會呼叫 sync() 移除工具列。
  // 截圖（002 FR-50 至 FR-53）：點了直接擷取；完成或錯誤時按鈕短暫顯示提示。
  const screenshot = createScreenshot();
  const actions = {
    close: () => {
      void enabled.setValue(false);
    },
    screenshot: () => screenshot.capture(),
  };

  // 新版本提醒（008 第三之一節）：影片頁載入完成時請背景腳本查詢；卡片由工具列繪製。
  const reminder = createUpdateReminder();
  let checkedVideoId: string | null = null;

  const { more } = viewing;
  // 每次繪製時重新產生，下拉選單的文字跟著介面語言（007 FR-3）。
  const moreItems = (): MoreItem[] => [
    { id: 'smartPause', icon: 'pause_presentation', label: 'moreSmartPause', description: 'moreSmartPauseDesc', ...pick(more.smartPause) },
    { id: 'autoplay', icon: 'autoplay', label: 'moreAutoplay', description: 'moreAutoplayDesc', ...pick(more.autoplay) },
    { id: 'audioOnly', icon: 'headphones', label: 'moreAudioOnly', description: 'moreAudioOnlyDesc', ...pick(more.audioOnly) },
    { id: 'wheelVolume', icon: 'mouse', label: 'moreWheelVolume', description: 'moreWheelVolumeDesc', ...pick(more.wheelVolume) },
    { id: 'hideComments', icon: 'comments_disabled', label: 'moreHideComments', description: 'moreHideCommentsDesc', ...pick(more.hideComments) },
    {
      kind: 'select',
      id: 'qualityLock',
      icon: 'hd',
      label: 'moreQualityLock',
      description: 'moreQualityLockDesc',
      state: more.quality.state,
      options: qualityOptions(),
      onChange: (value) => more.quality.setLock(value as QualityLock),
    },
  ];
  const refreshMore = () => more.autoplay.refresh();

  const renderPanel = (id: ButtonId) => {
    switch (id) {
      case 'help':
        return <HelpPanel layout={layout} />;
      case 'link':
        return videoId ? <LinkPanel videoId={videoId} /> : undefined;
      case 'loop':
        return <LoopPanel loop={viewing.loop} />;
      case 'more':
        return <MorePanel items={moreItems()} onOpen={refreshMore} />;
      // 下載：縮圖、字幕不需要橋接程式（階段 4a）；影片、MP3 經由橋接程式（階段 4）。
      case 'thumbnail':
        return videoId ? <ThumbnailPanel videoId={videoId} /> : undefined;
      case 'subtitles':
        return videoId ? <SubtitlePanel videoId={videoId} /> : undefined;
      case 'video':
        return videoId ? <VideoPanel videoId={videoId} /> : undefined;
      case 'mp3':
        return videoId ? <Mp3Panel videoId={videoId} /> : undefined;
      default:
        return undefined;
    }
  };

  // 下載工作（002 FR-3）：按鈕上的進度環。一鍵下載（009 FR-7）：「影片」「MP3」的提示文字標明點下去會發生什麼。
  // 每個按鈕各自訂閱自己的狀態，狀態改變時不重新繪製整條工具列。
  const jobs = downloadJobs();
  const quick = quickSettings();
  const downloadStatus = (id: string): ToolSources => {
    const tooltip = (kind: 'video' | 'mp3', q: QuickSettings | null) => (q?.enabled ? quickTooltip(kind, q.defaults) : undefined);
    return {
      video: derive([jobs, quick], (list, q) => ({ progress: buttonProgress(list, id, 'video'), tooltip: tooltip('video', q) })),
      mp3: derive([jobs, quick], (list, q) => ({ progress: buttonProgress(list, id, 'mp3'), tooltip: tooltip('mp3', q) })),
      subtitles: derive([jobs], (list) => ({ progress: buttonProgress(list, id, 'subtitle') })),
    };
  };

  /** 換頁、改變工具列設定或介面語言時重新繪製（按鈕的狀態另外由各自的 store 更新）。 */
  function renderInto(container: HTMLElement, host: HTMLElement) {
    if (!videoId) return;
    viewing.decorateToolbarHost(host);
    render(
      <Toolbar
        host={host}
        videoId={videoId}
        getBounds={getBounds}
        status={{ ...viewing.status, ...downloadStatus(videoId), screenshot: screenshot.state }}
        actions={{ ...viewing.actions, ...actions }}
        renderPanel={renderPanel}
        layout={layout}
        onSaveLayout={saveLayout}
        reminder={reminder}
      />,
      container,
    );
  }

  const saveLayout = (next: ToolbarLayout) => {
    layout = normalizeLayout(next);
    rerender();
    toolbarLayout.setValue(layout).catch((err: unknown) => console.info(`${LOG_PREFIX} failed to save toolbar layout`, err));
  };

  const rerender = () => {
    if (ui.mounted) renderInto(ui.uiContainer, ui.shadowHost);
  };

  const isInPlace = () => {
    const anchor = findToolbarAnchor();
    const host = ui.shadowHost;
    return !!anchor && host.parentElement === anchor.parent && host.nextElementSibling === anchor.before;
  };

  const stopObserving = () => {
    parentObserver?.disconnect();
    parentObserver = null;
    observedParent = null;
  };

  const observeParent = (parent: Element) => {
    if (observedParent === parent) return;
    stopObserving();
    observedParent = parent;
    parentObserver = new MutationObserver(() => {
      if (!isInPlace()) sync();
    });
    parentObserver.observe(parent, { childList: true });
  };

  const stopWaiting = () => {
    waitObserver?.disconnect();
    waitObserver = null;
    clearTimeout(waitTimer);
    waitTimer = undefined;
    cancelAnimationFrame(waitFrame);
    waitFrame = 0;
  };

  // 首次載入時 YouTube 還沒畫出錨點：暫時觀察整頁，找到或逾時就停止。
  const waitForAnchor = () => {
    if (waitObserver) return;
    waitObserver = new MutationObserver(() => {
      if (waitFrame) return;
      waitFrame = requestAnimationFrame(() => {
        waitFrame = 0;
        if (findToolbarAnchor()) {
          stopWaiting();
          sync();
        }
      });
    });
    waitObserver.observe(document.documentElement, { childList: true, subtree: true });
    waitTimer = setTimeout(() => {
      stopWaiting();
      console.info(`${LOG_PREFIX} toolbar anchor not found; toolbar disabled on this page`);
    }, ANCHOR_WAIT_MS);
  };

  const applyFullscreen = () => {
    ui.shadowHost.hidden = !!document.fullscreenElement;
  };

  function sync() {
    // 打開影片頁時查詢新版本（工具列關閉時也查詢，只更新擴充功能圖示的標記；FR-27、FR-29b）。
    const watchId = isWatchPage(location.href) ? getVideoId(location.href) : null;
    if (watchId && watchId !== checkedVideoId) {
      checkedVideoId = watchId;
      reminder.check();
    }
    const show = isEnabled && isWatchPage(location.href);
    if (!show) {
      stopWaiting();
      stopObserving();
      if (ui.mounted) ui.remove();
      return;
    }
    videoId = getVideoId(location.href);
    const anchor = findToolbarAnchor();
    if (!anchor) {
      stopObserving();
      waitForAnchor();
      return;
    }
    stopWaiting();
    if (ui.mounted && isInPlace()) {
      renderInto(ui.uiContainer, ui.shadowHost);
    } else {
      if (ui.mounted) ui.remove();
      try {
        ui.mount();
      } catch (err) {
        console.info(`${LOG_PREFIX} failed to mount toolbar`, err);
        return;
      }
    }
    observeParent(anchor.parent);
    applyFullscreen();
  }

  ctx.onInvalidated(
    onNavigate(() => {
      sync();
      viewing.navigate();
    }),
  );
  ctx.onInvalidated(
    enabled.watch((value) => {
      isEnabled = value;
      updateViewing();
      sync();
    }),
  );
  ctx.onInvalidated(
    toolbarLayout.watch((value) => {
      layout = normalizeLayout(value);
      rerender();
    }),
  );
  // 介面語言改變（007 FR-3）：同一個 Preact 樹重新繪製，工具列與面板狀態不變（NFR-1）。
  ctx.onInvalidated(onLocaleChange(rerender));
  ctx.onInvalidated(() => viewing.setActive(false));
  ctx.onInvalidated(() => reminder.dispose());
  ctx.addEventListener(document, 'fullscreenchange', applyFullscreen);
  ctx.onInvalidated(() => {
    stopWaiting();
    stopObserving();
  });

  updateViewing();
  sync();
}
