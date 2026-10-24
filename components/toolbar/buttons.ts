// 工具註冊表（001 FR-6、FR-8、006，plan 3.7.3）：每個工具的識別字串、圖示、名稱、說明與類型集中在這裡。
// 工具列、編輯模式、「更多」面板的「其他工具」區塊、說明面板與設定頁都從這份註冊表與使用者的設定產生。
import type { MessageKey } from '@/utils/i18n';
import type { ToolId } from '@/utils/toolbar-layout';
import type { IconName } from '../icons';

/**
 * - panel：點了展開面板。
 * - toggle：點了直接開關某個狀態，開啟時維持圓形背景（FR-9）。
 * - action：點了直接執行（截圖、關閉）。
 */
export type ButtonKind = 'panel' | 'toggle' | 'action';

/** 固定工具：不能隱藏、也不能移動，永遠在工具列最右邊（006）。 */
export type FixedId = 'more' | 'close';

export type ButtonId = ToolId | FixedId;

export interface ButtonDef {
  id: ButtonId;
  kind: ButtonKind;
  icon: IconName;
  /** 按鈕名稱：提示文字與無障礙標籤（FR-7）。 */
  label: MessageKey;
  /** 說明面板中的一句話說明（FR-17）。 */
  description: MessageKey;
  /** 面板標題；未指定時使用按鈕名稱。 */
  panelTitle?: MessageKey;
  /**
   * 切換類工具「開啟」時是否算是進行中的狀態：隱藏時在「更多」按鈕顯示提示圓點（006 FR-17）。
   * 深色模式是長期的外觀設定，不算進行中。
   */
  ongoing?: boolean;
}

export const TOOLS: Readonly<Record<ToolId, ButtonDef>> = {
  video: { id: 'video', kind: 'panel', icon: 'movie', label: 'btnVideo', description: 'helpVideo', panelTitle: 'panelTitleVideo' },
  mp3: { id: 'mp3', kind: 'panel', icon: 'music_note', label: 'btnMp3', description: 'helpMp3', panelTitle: 'panelTitleMp3' },
  thumbnail: { id: 'thumbnail', kind: 'panel', icon: 'image', label: 'btnThumbnail', description: 'helpThumbnail', panelTitle: 'panelTitleThumbnail' },
  subtitles: { id: 'subtitles', kind: 'panel', icon: 'subtitles', label: 'btnSubtitles', description: 'helpSubtitles', panelTitle: 'panelTitleSubtitles' },
  screenshot: { id: 'screenshot', kind: 'action', icon: 'photo_camera', label: 'btnScreenshot', description: 'helpScreenshot' },
  // 004 第 4 節：複製帶時間的連結。
  link: { id: 'link', kind: 'panel', icon: 'link', label: 'btnLink', description: 'helpLink', panelTitle: 'panelTitleLink' },
  darkMode: { id: 'darkMode', kind: 'toggle', icon: 'dark_mode', label: 'btnDarkMode', description: 'helpDarkMode' },
  cinema: { id: 'cinema', kind: 'toggle', icon: 'lightbulb', label: 'btnCinema', description: 'helpCinema', ongoing: true },
  pip: { id: 'pip', kind: 'toggle', icon: 'picture_in_picture_alt', label: 'btnPip', description: 'helpPip', ongoing: true },
  floating: { id: 'floating', kind: 'toggle', icon: 'branding_watermark', label: 'btnFloating', description: 'helpFloating', ongoing: true },
  loop: { id: 'loop', kind: 'panel', icon: 'repeat', label: 'btnLoop', description: 'helpLoop' },
  help: { id: 'help', kind: 'panel', icon: 'help', label: 'btnHelp', description: 'helpHelp' },
};

export const FIXED: Readonly<Record<FixedId, ButtonDef>> = {
  more: { id: 'more', kind: 'panel', icon: 'more_vert', label: 'btnMore', description: 'helpMore' },
  close: { id: 'close', kind: 'action', icon: 'close', label: 'btnClose', description: 'helpClose' },
};

export function getButton(id: ButtonId): ButtonDef {
  return id === 'more' || id === 'close' ? FIXED[id] : TOOLS[id];
}

/** 工具目前的狀態（給「更多」按鈕的提示圓點判斷）。 */
export interface ToolActivity {
  progress?: Partial<Record<ButtonId, number | 'indeterminate' | null>>;
  activePanels?: ReadonlySet<ButtonId>;
  toggles?: Partial<Record<ButtonId, { active: boolean }>>;
}

/** 工具是否有進行中的狀態：下載中、面板功能進行中（循環）、或開啟中的切換類工具（深色模式除外）（006 FR-17）。 */
export function isToolOngoing(id: ToolId, { progress, activePanels, toggles }: ToolActivity): boolean {
  return (progress?.[id] ?? null) !== null || !!activePanels?.has(id) || (!!TOOLS[id].ongoing && !!toggles?.[id]?.active);
}
