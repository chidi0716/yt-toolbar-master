import { describe, expect, it } from 'vitest';
import en from '../../public/_locales/en/messages.json';
import zh from '../../public/_locales/zh_TW/messages.json';
import { installCommand } from './host-status';
import { detailSource, INSTALL_COMMANDS, INSTALL_DETAILS, INSTALL_POLL_MS, INSTALL_STEPS, platformToOs, REVIEW_COMMANDS } from './install-guide';

describe('一行安裝指令（008 FR-1、FR-10，plan 3.10）', () => {
  it('指令與 plan 3.10 完全一致', () => {
    expect(INSTALL_COMMANDS.mac).toBe('curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh');
    expect(INSTALL_COMMANDS.windows).toBe('irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex');
  });

  it('不需要 sudo 或系統管理員', () => {
    for (const command of [...Object.values(INSTALL_COMMANDS), ...Object.values(REVIEW_COMMANDS).flat()]) {
      expect(command).not.toMatch(/sudo|RunAs|-Verb/i);
    }
  });

  it('小幫手未安裝、缺少元件、只缺 deno 時都使用同一個指令（可以重複執行，FR-13）；其他系統沒有指令', () => {
    expect(installCommand({ state: 'unreachable' }, 'mac')).toBe(INSTALL_COMMANDS.mac);
    expect(installCommand({ state: 'unreachable' }, 'windows')).toBe(INSTALL_COMMANDS.windows);
    expect(installCommand({ state: 'unreachable' }, 'other')).toBeNull();
  });

  it('先檢視腳本：下載同一個腳本、檢視、再執行', () => {
    expect(REVIEW_COMMANDS.mac[0]).toContain('/releases/latest/download/install.sh');
    expect(REVIEW_COMMANDS.windows[0]).toContain('/releases/latest/download/install.ps1');
  });

  it('作業系統：runtime.getPlatformInfo 的 mac、win，其他都是 other', () => {
    expect(platformToOs('mac')).toBe('mac');
    expect(platformToOs('win')).toBe('windows');
    for (const os of ['linux', 'cros', 'android', 'openbsd', undefined]) expect(platformToOs(os)).toBe('other');
  });

  it('三步驟與「這個指令會做什麼？」的每一項都有兩種語言的文字；依 FR-11 的順序列出來源', () => {
    const keys = [...INSTALL_STEPS.mac, ...INSTALL_STEPS.windows, ...INSTALL_DETAILS.map((d) => d.text)];
    for (const key of keys) {
      expect(en, key).toHaveProperty(key);
      expect(zh, key).toHaveProperty(key);
    }
    expect(INSTALL_STEPS.mac).toHaveLength(3);
    expect(INSTALL_STEPS.windows).toHaveLength(3);
    expect(INSTALL_DETAILS.map((d) => detailSource(d, 'mac'))).toEqual([
      'github.com/chidi0716/yt-toolbar-master',
      'github.com/yt-dlp/yt-dlp',
      'github.com/denoland/deno',
      'ffmpeg.martin-riedl.de',
      '~/Library/Application Support/yt-toolbar-master/',
      null,
    ]);
    expect(detailSource(INSTALL_DETAILS[3]!, 'windows')).toBe('github.com/yt-dlp/FFmpeg-Builds');
    expect(detailSource(INSTALL_DETAILS[4]!, 'windows')).toBe('%LOCALAPPDATA%\\yt-toolbar-master\\');
  });

  it('自動偵測的間隔為 3 秒', () => {
    expect(INSTALL_POLL_MS).toBe(3000);
  });
});
