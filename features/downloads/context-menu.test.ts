import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setLocale } from '@/utils/i18n';
import { defaultVideoHeight, downloadContextMenu, mp3Bitrate, uiLanguage } from '@/utils/settings';
import { MENU_MP3, MENU_PARENT, MENU_PATTERNS, MENU_SETTING_KEYS, MENU_VIDEO, menuItems, menuKind, onContextMenuClicked, rebuildContextMenus } from './context-menu';
import { contextMenuTitles, toQuickDefaults } from './quick';

afterEach(() => setLocale('en'));

describe('右鍵選單項目（009 FR-20、FR-21、FR-25）', () => {
  const titles = { parent: 'YT Toolbar Master', video: 'Download video (1080p MP4)', mp3: 'Download MP3 (192 kbps)' };

  it('父選單是擴充功能名稱，兩個子項目；只在 YouTube 頁面、指向單一影片的連結上出現', () => {
    const items = menuItems(true, titles);
    expect(items.map((i) => [i.id, i.parentId, i.title])).toEqual([
      [MENU_PARENT, undefined, 'YT Toolbar Master'],
      [MENU_VIDEO, MENU_PARENT, 'Download video (1080p MP4)'],
      [MENU_MP3, MENU_PARENT, 'Download MP3 (192 kbps)'],
    ]);
    for (const item of items) {
      expect(item.contexts).toEqual(['link']);
      expect(item.documentUrlPatterns).toEqual(['*://*.youtube.com/*']);
      expect(item.targetUrlPatterns).toEqual(['*://*.youtube.com/watch*', '*://*.youtube.com/shorts/*', '*://youtu.be/*']);
    }
  });

  it('關閉時沒有任何項目', () => {
    expect(menuItems(false, titles)).toEqual([]);
  });

  it('文字跟隨介面語言並代入目前的預設值（FR-26）', () => {
    setLocale('zh_TW');
    expect(contextMenuTitles(toQuickDefaults(1080, 'mp4', 192))).toEqual({ parent: 'YT Toolbar Master', video: '下載影片（1080p MP4）', mp3: '下載 MP3（192 kbps）' });
    setLocale('en');
    expect(contextMenuTitles(toQuickDefaults('best', 'any', 320))).toEqual({ parent: 'YT Toolbar Master', video: 'Download video (Best quality, any format)', mp3: 'Download MP3 (320 kbps)' });
  });

  it('點擊：只處理我們的項目與單一影片的連結', () => {
    expect(menuKind(MENU_VIDEO)).toBe('video');
    expect(menuKind(MENU_MP3)).toBe('mp3');
    expect(menuKind(MENU_PARENT)).toBeNull();
    expect(menuKind('other')).toBeNull();
    // 頻道連結、不合法的連結、其他項目：不做任何事（不丟出例外）
    expect(() => onContextMenuClicked({ menuItemId: MENU_VIDEO, linkUrl: 'https://www.youtube.com/@jawed' })).not.toThrow();
    expect(() => onContextMenuClicked({ menuItemId: 'other', linkUrl: 'https://youtu.be/jNQXAC9IVRw' })).not.toThrow();
    expect(() => onContextMenuClicked({ menuItemId: MENU_MP3 })).not.toThrow();
  });

  it('重建選單的設定鍵與 settings.ts 一致', () => {
    expect(MENU_SETTING_KEYS).toEqual(['downloadContextMenu', 'defaultVideoHeight', 'defaultVideoContainer', 'mp3Bitrate', 'uiLanguage']);
    expect(MENU_PATTERNS.contexts).toEqual(['link']);
  });
});

describe('rebuildContextMenus（plan 3.11）', () => {
  const created: Array<{ id: string; title: string }> = [];
  let removeAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeBrowser.reset();
    created.length = 0;
    removeAll = vi.fn(async () => {
      created.length = 0;
    });
    (fakeBrowser as unknown as { contextMenus: unknown }).contextMenus = {
      removeAll,
      create: (item: { id: string; title: string }, cb?: () => void) => {
        created.push({ id: item.id, title: item.title });
        cb?.();
        return item.id;
      },
    };
  });

  it('依設定與語言建立；關閉時移除全部；設定改變時重建', async () => {
    await uiLanguage.setValue('zh_TW');
    await rebuildContextMenus();
    expect(created.map((c) => c.title)).toEqual(['YT Toolbar Master', '下載影片（1080p MP4）', '下載 MP3（192 kbps）']);

    await defaultVideoHeight.setValue(720);
    await mp3Bitrate.setValue(320);
    await uiLanguage.setValue('en');
    await rebuildContextMenus();
    expect(created.map((c) => c.title)).toEqual(['YT Toolbar Master', 'Download video (720p MP4)', 'Download MP3 (320 kbps)']);

    await downloadContextMenu.setValue(false);
    await rebuildContextMenus();
    expect(created).toEqual([]);
    expect(removeAll).toHaveBeenCalledTimes(3);
  });
});
