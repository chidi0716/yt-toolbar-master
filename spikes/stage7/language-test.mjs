// 階段 7（007 介面語言，T35、T36）在本機假觀看頁與設定頁上的驗收檢查與截圖。
// 瀏覽器語言為英文（en-US），介面語言從「跟隨瀏覽器」開始。下載中切換與通知的語言見 spikes/stage4/e2e-test.mjs 的 language 段落。
//   npm run build && node spikes/stage7/language-test.mjs
import { EXT_ID, WATCH, button, launch, openWatch, reporter, shot, shots } from '../stage1-smoke/lib.mjs';
import { join } from 'node:path';

const { check, summary } = reporter();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inToolbar = (page, src) => page.evaluate((s) => new Function('root', s)(document.querySelector('ytm-toolbar').shadowRoot), src);

const context = await launch({ name: 't7', lang: 'en-US', uiLanguage: 'auto', viewport: { width: 1280, height: 1100 } });
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (err) => console.log('  pageerror:', String(err).slice(0, 200)));
  await openWatch(page, WATCH);
  const labels = () => inToolbar(page, `return [...root.querySelectorAll('.ytm-btn')].map((b) => b.getAttribute('aria-label')).join('|')`);
  const enLabels = await labels();
  check('瀏覽器為英文、「跟隨瀏覽器」：工具列為英文（FR-2）', enLabels.startsWith('Video|MP3|Thumbnail|'), enLabels.slice(0, 60));

  // 釘選一個面板，並記住工具列的宿主元素（確認切換語言時不重新掛載，NFR-1）
  await page.evaluate(() => {
    document.querySelector('ytm-toolbar').__marker = 'same-host';
  });
  await button(page, 'loop').click();
  await page.locator('ytm-toolbar .ytm-panel #ytm-loop-times').fill('7');
  await page.locator('ytm-toolbar .ytm-panel .ytm-panel-header button').click(); // 釘選
  await sleep(200);
  const pinnedBefore = await inToolbar(page, `return { title: root.querySelector('.ytm-panel-title')?.textContent, times: root.querySelector('#ytm-loop-times')?.value, pinned: root.querySelector('.ytm-panel-header button')?.getAttribute('aria-pressed') ?? root.querySelector('.ytm-panel-header button')?.getAttribute('aria-label') }`);

  // 設定頁
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${EXT_ID}/options.html`);
  await opt.waitForSelector('#ui-language:not([disabled])');
  const optEn = await opt.evaluate(() => ({
    first: document.querySelector('#app .section').id,
    h1: document.querySelector('h1').textContent,
    value: document.querySelector('#ui-language').value,
    options: [...document.querySelectorAll('#ui-language option')].map((o) => o.textContent).join('|'),
    note: document.querySelector('#ui-language-desc').textContent,
  }));
  check('設定頁最上方有「介面語言」選單：跟隨瀏覽器（預設）、繁體中文、English（FR-1）', optEn.first === 'language' && optEn.value === 'auto' && optEn.options === 'Follow the browser|繁體中文|English', JSON.stringify(optEn));
  check('選單下方說明擴充功能名稱等由瀏覽器顯示（FR-5）', /extensions page/.test(optEn.note), optEn.note);
  await opt.screenshot({ path: join(shots, 'T35-options-language-en.png'), clip: { x: 0, y: 0, width: 1280, height: 420 } });

  // 切到繁體中文（以鍵盤操作時焦點在選單上）
  await opt.locator('#ui-language').focus();
  await opt.locator('#ui-language').selectOption('zh_TW');
  await sleep(500);
  const optZh = await opt.evaluate(() => ({
    h1: document.querySelector('h1').textContent,
    lang: document.documentElement.lang,
    toolbar: document.querySelector('#toolbar-title').textContent,
    row: document.querySelector('#toolbar-list .toolbar-row[data-item="video"] .toolbar-name').textContent,
    tidy: document.querySelector('#tidy-title').textContent,
    folder: document.querySelector('#downloads-groups legend')?.textContent,
    value: document.querySelector('#ui-language').value,
    focus: document.activeElement?.id,
  }));
  check(
    '設定頁選「繁體中文」後整頁立即變成中文（FR-3、驗收 1）',
    optZh.h1 === '設定' && optZh.lang === 'zh-TW' && optZh.toolbar === '工具列' && optZh.row === '影片' && optZh.value === 'zh_TW',
    JSON.stringify(optZh),
  );
  check('重新繪製後焦點留在語言選單', optZh.focus === 'ui-language', optZh.focus);
  await opt.screenshot({ path: join(shots, 'T35-options-language-zh-TW.png'), clip: { x: 0, y: 0, width: 1280, height: 420 } });

  // YouTube 分頁
  const zhLabels = await labels();
  const after = await inToolbar(page, `return { title: root.querySelector('.ytm-panel-title')?.textContent, times: root.querySelector('#ytm-loop-times')?.value, pinned: root.querySelector('.ytm-panel-header button')?.getAttribute('aria-pressed') ?? root.querySelector('.ytm-panel-header button')?.getAttribute('aria-label'), tooltip: root.querySelector('.ytm-btn[data-button="video"] + .ytm-tooltip').textContent }`);
  const sameHost = await page.evaluate(() => document.querySelectorAll('ytm-toolbar').length === 1 && document.querySelector('ytm-toolbar').__marker === 'same-host');
  check('已開啟的 YouTube 分頁中，工具列的提示文字變成中文（FR-3、驗收 1）', zhLabels.startsWith('影片|MP3|縮圖') && after.tooltip === '影片', `${zhLabels.slice(0, 40)} ${after.tooltip}`);
  check('釘選的面板仍展開、輸入的值保留，標題換成中文；工具列沒有重新掛載（NFR-1、驗收 2）', sameHost && after.times === '7' && after.title === '循環播放' && after.title !== pinnedBefore.title, JSON.stringify({ before: pinnedBefore, after, sameHost }));
  await shot(page, 'T35-toolbar-zh-TW-switched.png');
  // 收起釘選的面板，看說明面板與「更多」
  await page.locator('ytm-toolbar .ytm-panel .ytm-panel-header button').click();
  await button(page, 'help').click();
  await page.waitForSelector('ytm-toolbar .ytm-help');
  const help = await inToolbar(page, `return [...root.querySelectorAll('.ytm-help-name')].map((n) => n.textContent).slice(0, 3).join('|') + ' / ' + root.querySelector('.ytm-panel-title').textContent`);
  check('說明面板變成中文（驗收 1）', help.startsWith('影片|MP3|縮圖') && help.endsWith('說明'), help);
  await page.keyboard.press('Escape');
  await button(page, 'more').click();
  await page.waitForSelector('ytm-toolbar .ytm-more-edit');
  const more = await inToolbar(page, `return root.querySelector('.ytm-more-edit').textContent + '|' + [...root.querySelectorAll('#ytm-more-qualityLock-select option')].map((o) => o.textContent).slice(0, 2).join(',')`);
  check('「更多」面板（含鎖定畫質的選項）變成中文', more.startsWith('編輯工具列|關閉'), more);
  await page.locator('ytm-toolbar .ytm-more-edit').click();
  await page.waitForSelector('ytm-toolbar .ytm-toolbar[data-editing]');
  const edit = await inToolbar(page, `return root.querySelector('.ytm-edit-help').textContent`);
  check('編輯模式變成中文', edit.startsWith('拖曳調整順序'), edit);
  // 編輯中切回英文：編輯模式保留，文字換成英文
  await opt.locator('#ui-language').selectOption('en');
  await sleep(500);
  const editEn = await inToolbar(page, `return { editing: root.querySelector('.ytm-toolbar').hasAttribute('data-editing'), help: root.querySelector('.ytm-edit-help')?.textContent }`);
  check('編輯模式中切換語言：仍在編輯模式，文字換成英文（NFR-1）', editEn.editing && editEn.help?.startsWith('Drag to reorder'), JSON.stringify(editEn));
  await page.keyboard.press('Escape');

  // 跟隨瀏覽器
  await opt.locator('#ui-language').selectOption('zh_TW');
  await sleep(300);
  await opt.locator('#ui-language').selectOption('auto');
  await sleep(500);
  const back = await labels();
  const optBack = await opt.evaluate(() => document.querySelector('h1').textContent);
  check('選回「跟隨瀏覽器」後依瀏覽器語言（英文）顯示（FR-2、驗收 3）', back === enLabels && optBack === 'Settings', `${back.slice(0, 40)} / ${optBack}`);

  // 彈出視窗（下次開啟時）與重新整理後維持
  await opt.locator('#ui-language').selectOption('zh_TW');
  await sleep(300);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await sleep(300);
  const popupText = await popup.evaluate(() => document.body.innerText);
  check('彈出視窗開啟時使用所選語言（FR-3）', /啟用/.test(popupText), popupText.slice(0, 60));
  await page.reload();
  await page.waitForSelector('ytm-toolbar', { state: 'attached' });
  await sleep(500);
  check('重新整理後維持所選語言（設定保存在 sync，FR-4）', (await labels()).startsWith('影片'));
  const stored = await opt.evaluate(() => chrome.storage.sync.get('uiLanguage').then((r) => r.uiLanguage));
  check('設定存在 sync:uiLanguage（FR-4）', stored === 'zh_TW', String(stored));

  // 數字與時間格式（FR-6）：截圖檔名的時間、MP3 面板
  await button(page, 'mp3').click();
  await sleep(500);
  const mp3 = await inToolbar(page, `return root.querySelector('.ytm-panel').innerText.slice(0, 200)`);
  check('面板文字為中文（MP3 面板的安裝說明或選項）', /下載|安裝|位元率/.test(mp3), mp3.split('\n').slice(0, 3).join(' / '));
} catch (err) {
  check('language script', false, String(err).split('\n').slice(0, 6).join(' | '));
} finally {
  await context.close();
}
if (!summary()) process.exitCode = 1;
