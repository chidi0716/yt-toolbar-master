// 一鍵下載與右鍵下載和既有功能的組合（constitution 第 7b 點，tasks T56）：
// 鎖定畫質、編輯工具列、隱藏的工具、下載清單、新版本提醒卡片。
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { isToolOngoing } from '@/components/toolbar/buttons';
import { initialPanelState, panelReducer, reminderBlocked } from '@/components/toolbar/panel-state';
import { pickQuality } from '@/features/viewing/quality-logic';
import { pickHeight } from '@/utils/default-format';
import { defaultVideoContainer, defaultVideoHeight, qualityLock, quickDownload } from '@/utils/settings';
import { defaultLayout, moveItem, splitLayout, toggleVisible } from '@/utils/toolbar-layout';
import { QUALITY_HEIGHTS, type QualityCode } from '@/utils/youtube/dom';
import type { ButtonId } from '@/components/toolbar/buttons';
import { buttonProgress, newJob, otherActiveJobs, type JobRecord } from './jobs';
import { existingQuickJob, initialDownloadMode, quickTooltip, toQuickDefaults } from './quick';

const ID = 'jNQXAC9IVRw';
const OTHER = 'bbbbbbbbbbb';
const videoJob = (jobId: string, videoId: string, state: JobRecord['state'], percent: number | null = null): JobRecord => ({
  ...newJob(jobId, { kind: 'video', videoId, title: `T ${videoId}`, label: '1080p MP4', formatId: '137+140', container: 'mp4', section: null }, 1, { size: 1000, approx: false }),
  state,
  percent,
});

describe('鎖定畫質（004）', () => {
  beforeEach(() => fakeBrowser.reset());

  it('預設下載畫質與播放的鎖定畫質是各自的設定，互不影響', async () => {
    await qualityLock.setValue('480');
    expect(await defaultVideoHeight.getValue()).toBe(1080);
    await defaultVideoHeight.setValue('best');
    await defaultVideoContainer.setValue('any');
    expect(await qualityLock.getValue()).toBe('480');
    expect(await quickDownload.getValue()).toBe(true);
  });

  it('同一組可用畫質下，兩者以同一個規則選擇', () => {
    const codes: QualityCode[] = ['hd1080', 'hd720', 'large', 'medium'];
    const heights = codes.map((c) => QUALITY_HEIGHTS[c]);
    expect(pickHeight(heights, 1440)).toBe(QUALITY_HEIGHTS[pickQuality('1440', codes)!]);
    expect(pickHeight(heights, 'best')).toBe(QUALITY_HEIGHTS[pickQuality('max', codes)!]);
  });
});

describe('隱藏的工具與編輯工具列（006）', () => {
  it('「影片」被隱藏：從「更多」打開同樣是點擊，面板直接一鍵下載；下載中「更多」顯示圓點', () => {
    const layout = toggleVisible(defaultLayout(), 'video');
    expect(splitLayout(layout).hidden).toContain('video');
    // 「其他工具」的列與工具列按鈕使用同一個動作（toggle），面板以這次的影片打開。
    const opened = panelReducer(panelReducer(initialPanelState<ButtonId>(), { type: 'toggle', id: 'more' }), { type: 'toggle', id: 'video' });
    expect(opened.openId).toBe('video');
    expect(initialDownloadMode({ quickEnabled: true, clickedForThisVideo: true, helperJustInstalled: false })).toBe('quick');
    const progress = { video: buttonProgress([videoJob('a', ID, 'downloading', 40)], ID, 'video') };
    expect(isToolOngoing('video', { progress })).toBe(true);
  });

  it('改變順序後提示文字仍對應到同一個工具（以工具 ID 對應）', () => {
    const moved = moveItem(defaultLayout(), 0, 5);
    const { left } = splitLayout(moved);
    expect(left).toContain('video');
    const tooltips: Partial<Record<ButtonId, string>> = { video: quickTooltip('video', toQuickDefaults(1080, 'mp4', 192)) };
    expect(tooltips.video).toContain('1080p MP4');
    expect(tooltips.mp3).toBeUndefined();
  });

  it('進入編輯模式時一鍵下載的面板收起，但下載不會被取消（工作還在清單中，再打開面板時顯示它）', () => {
    const open = panelReducer(initialPanelState<ButtonId>(), { type: 'toggle', id: 'video' });
    const closed = panelReducer(open, { type: 'close' });
    expect(closed.openId).toBeNull();
    const jobs = [videoJob('a', ID, 'downloading', 10)];
    expect(existingQuickJob(jobs, ID, 'video')?.jobId).toBe('a');
  });

  it('釘選的一鍵下載面板換到別部影片：不替新影片自動下載', () => {
    const pinned = panelReducer(panelReducer(initialPanelState<ButtonId>(), { type: 'toggle', id: 'video' }), { type: 'pin' });
    expect(panelReducer(pinned, { type: 'navigate' }).openId).toBe('video');
    expect(initialDownloadMode({ quickEnabled: true, clickedForThisVideo: false, helperJustInstalled: false })).toBe('confirm');
  });
});

describe('下載清單（002 FR-3、FR-4）', () => {
  const jobs = [videoJob('menu', OTHER, 'downloading', 20), videoJob('here', ID, 'downloading', 60), videoJob('old', OTHER, 'done', 100)];

  it('右鍵下載的其他影片出現在「其他下載」，這部影片的工作不重複列出，已完成的不列出', () => {
    expect(otherActiveJobs(jobs, ID).map((j) => j.jobId)).toEqual(['menu']);
    expect(otherActiveJobs(jobs, OTHER).map((j) => j.jobId)).toEqual(['here']);
  });

  it('工具列的進度環只看這部影片', () => {
    expect(buttonProgress(jobs, ID, 'video')).toBe(60);
    expect(buttonProgress(jobs, ID, 'mp3')).toBeNull();
  });

  it('一鍵下載的重複判斷不受其他影片的下載影響', () => {
    expect(existingQuickJob(jobs, ID, 'video')?.jobId).toBe('here');
    expect(existingQuickJob([videoJob('menu', OTHER, 'downloading')], ID, 'video')).toBeNull();
  });
});

describe('新版本提醒卡片（008、constitution 第 7c 點）', () => {
  it('一鍵下載的面板展開中、或正在編輯工具列時，卡片延後', () => {
    const open = panelReducer(initialPanelState<ButtonId>(), { type: 'toggle', id: 'mp3' });
    expect(reminderBlocked(open, false)).toBe(true);
    expect(reminderBlocked(initialPanelState(), true)).toBe(true);
    expect(reminderBlocked(panelReducer(open, { type: 'toggle', id: 'mp3' }), false)).toBe(false);
  });
});
