// 觀看輔助功能（003）的總控制：啟用／停用、換頁通知，並把各功能的狀態提供給工具列。
import type { ButtonId } from '@/components/toolbar/buttons';
import type { ToolSources } from '@/components/toolbar/Toolbar';
import { createCinema } from './cinema';
import { createDarkMode } from './dark-mode';
import { createFloating } from './floating';
import { createLoop, type LoopController } from './loop';
import { createAudioOnly, createAutoplay, createHideComments, createSmartPause, createWheelVolume, type AutoplayFeature } from './more';
import type { SettingFeature } from './setting-feature';
import { createPip } from './pip';
import { createQualityLock, type QualityLockFeature } from './quality';
import { derive, type ViewingFeature } from './store';

export interface ViewingController {
  /** 工具列啟用、且在支援的網域時為 true；false 時還原所有對 YouTube 頁面的修改。 */
  setActive(active: boolean): void;
  /** YouTube 換頁時呼叫（003 FR-3）。 */
  navigate(): void;
  /** 工具列按鈕的狀態（切換類的開關；循環播放進行中時按鈕維持開啟，003 FR-52）。 */
  readonly status: ToolSources;
  /** 切換按鈕的動作。 */
  readonly actions: Partial<Record<ButtonId, () => void>>;
  /** 循環播放（給面板使用）。 */
  loop: LoopController;
  /** 「更多」選單的功能（給面板使用），順序即面板中的順序。 */
  more: {
    smartPause: SettingFeature;
    autoplay: AutoplayFeature;
    audioOnly: SettingFeature;
    wheelVolume: SettingFeature;
    hideComments: SettingFeature;
    /** 鎖定畫質（004 第 1 節）。 */
    quality: QualityLockFeature;
  };
}

export function createViewingController(): ViewingController {
  const dark = createDarkMode();
  const pip = createPip();
  const cinema = createCinema();
  const floating = createFloating();
  const loop = createLoop();
  const more = {
    smartPause: createSmartPause(),
    autoplay: createAutoplay(),
    audioOnly: createAudioOnly(),
    wheelVolume: createWheelVolume(),
    hideComments: createHideComments(),
    quality: createQualityLock(),
  };
  const features: ViewingFeature[] = [dark, pip, cinema, floating, loop, ...Object.values(more)];
  // 劇院模式開啟期間浮動播放器暫停作用，浮動中的播放器回到原位（003 FR-45）；以按鈕、Esc、點變暗區域或停用工具列
  // 關閉時恢復。播放器容器找不到等原因沒有開成功時狀態不變，浮動播放器不受影響。
  cinema.state.subscribe(() => floating.setSuspended(cinema.state.get().active));
  let active = false;

  return {
    loop,
    more,
    status: {
      darkMode: dark.state,
      pip: pip.state,
      cinema: cinema.state,
      floating: floating.state,
      loop: derive([loop.status], (s) => ({ active: s.running })),
    },
    actions: { darkMode: dark.toggle, pip: pip.toggle, cinema: cinema.toggle, floating: floating.toggle },
    setActive(next) {
      if (next === active) return;
      active = next;
      for (const feature of features) {
        try {
          if (next) feature.start();
          else feature.stop();
        } catch (err) {
          // 單一功能失效不得影響影片播放與其他功能（003 FR-4）。
          console.info('[yt-toolbar-master] viewing feature failed', err);
        }
      }
    },
    navigate() {
      if (!active) return;
      for (const feature of features) {
        try {
          feature.navigate?.();
        } catch (err) {
          console.info('[yt-toolbar-master] viewing feature failed on navigation', err);
        }
      }
    },
  };
}
