// T37（007 FR-20 至 FR-24）設定頁與彈出視窗的外觀：在假觀看頁切換 YouTube 的主題（<html dark>），
// 確認「跟隨 YouTube」「跟隨系統」「深色」「淺色」。系統設定以 Playwright 的 colorScheme 模擬（預設淺色）。
//   npm run build && node spikes/stage7/appearance-test.mjs
import { join } from 'node:path';
import { EXT_ID, WATCH, launch, openWatch, reporter, shots } from '../stage1-smoke/lib.mjs';

const { check, summary } = reporter();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const context = await launch({ name: 't37', lang: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (err) => console.log('  pageerror:', String(err).slice(0, 200)));
  await openWatch(page, WATCH);
  const setYouTubeDark = async (dark) => {
    await page.evaluate((d) => document.documentElement.toggleAttribute('dark', d), dark);
    await sleep(500);
  };
  const theme = (p) => p.evaluate(() => document.documentElement.dataset.theme ?? null);
  const bg = (p) => p.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

  // 從未記錄前：設定頁依系統（淺色）
  await setYouTubeDark(true);
  const stored = await (await context.serviceWorkers()[0]).evaluate(() => chrome.storage.local.get('lastYouTubeTheme').then((r) => r.lastYouTubeTheme));
  check('內容腳本記下目前的 YouTube 主題（local:lastYouTubeTheme，FR-21、FR-24）', stored === 'dark', String(stored));

  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${EXT_ID}/options.html`);
  await opt.waitForSelector('#page-theme:not([disabled])');
  const info = await opt.evaluate(() => ({
    value: document.querySelector('#page-theme').value,
    options: [...document.querySelectorAll('#page-theme option')].map((o) => o.textContent).join('|'),
    afterLanguage: document.querySelector('#ui-language').closest('.option').nextElementSibling?.querySelector('#page-theme') !== null,
  }));
  check('「介面語言」下方有「外觀」選單：跟隨 YouTube（預設）、跟隨系統、深色、淺色（FR-20）', info.value === 'youtube' && info.options === 'Follow YouTube|Follow the system|Dark|Light' && info.afterLanguage, JSON.stringify(info));
  check('跟隨 YouTube：YouTube 為深色、系統為淺色時，設定頁為深色（驗收 6）', (await theme(opt)) === 'dark' && (await bg(opt)) === 'rgb(15, 15, 15)', `${await theme(opt)} ${await bg(opt)}`);
  await opt.screenshot({ path: join(shots, 'T37-options-dark.png'), clip: { x: 0, y: 0, width: 1280, height: 460 } });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await sleep(300);
  check('彈出視窗開啟時也是深色（FR-22）', (await theme(popup)) === 'dark');
  await popup.close();

  // YouTube 切成淺色：已開啟的設定頁立即變成淺色
  await setYouTubeDark(false);
  await sleep(300);
  check('在 YouTube 切成淺色後，已開啟的設定頁立即變成淺色（FR-22、驗收 6）', (await theme(opt)) === 'light' && (await bg(opt)) === 'rgb(255, 255, 255)', `${await theme(opt)} ${await bg(opt)}`);
  await opt.screenshot({ path: join(shots, 'T37-options-light.png'), clip: { x: 0, y: 0, width: 1280, height: 460 } });

  // 深色、淺色、跟隨系統：不受 YouTube 影響
  const choose = async (v) => {
    await opt.locator('#page-theme').selectOption(v);
    await sleep(300);
  };
  await choose('dark');
  const darkA = await theme(opt);
  await setYouTubeDark(false);
  const darkB = await theme(opt);
  check('選「深色」立即套用，不受 YouTube 主題影響（驗收 7）', darkA === 'dark' && darkB === 'dark', `${darkA} ${darkB}`);
  await choose('light');
  await setYouTubeDark(true);
  check('選「淺色」不受 YouTube 主題影響（驗收 7）', (await theme(opt)) === 'light');
  await choose('system');
  const sysLight = await theme(opt);
  await opt.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  const sysDark = await theme(opt);
  await setYouTubeDark(false);
  const sysDark2 = await theme(opt);
  check('選「跟隨系統」：依系統的深色／淺色，系統改變時立即更新，不受 YouTube 影響（驗收 7）', sysLight === 'light' && sysDark === 'dark' && sysDark2 === 'dark', `${sysLight} ${sysDark} ${sysDark2}`);
  await opt.emulateMedia({ colorScheme: 'light' });
  const synced = await opt.evaluate(() => chrome.storage.sync.get('pageTheme').then((r) => r.pageTheme));
  check('外觀設定存在 sync（FR-24）', synced === 'system', String(synced));
  // 工具列關閉後（✕）在 YouTube 切換主題，設定頁仍跟著變（T37a、Q52）
  await choose('youtube');
  await page.locator('ytm-toolbar .ytm-btn[data-button="close"]').click();
  await page.waitForFunction(() => !document.querySelector('ytm-toolbar'));
  await setYouTubeDark(true);
  const closedDark = await theme(opt);
  await setYouTubeDark(false);
  const closedLight = await theme(opt);
  check('工具列關閉後在 YouTube 切換主題，設定頁仍跟著變（007 FR-21、T37a）', closedDark === 'dark' && closedLight === 'light', `${closedDark} ${closedLight}`);
  // 換頁與重新整理後仍記錄
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await setYouTubeDark(true);
  check('工具列關閉時重新整理後仍記錄主題', (await theme(opt)) === 'dark', await theme(opt));
  await opt.evaluate(() => chrome.storage.sync.set({ enabled: true }));
  await sleep(300);

  // 繁體中文
  await opt.locator('#ui-language').selectOption('zh_TW');
  await sleep(500);
  const zh = await opt.evaluate(() => [...document.querySelectorAll('#page-theme option')].map((o) => o.textContent).join('|') + '|' + document.querySelector('#page-theme').value);
  check('繁體中文的外觀選單，切換語言後選擇保留', zh === '跟隨 YouTube|跟隨系統|深色|淺色|youtube', zh);
  // 工具列不受影響（FR-23）：YouTube 為淺色時，選「深色」不改變工具列
  await setYouTubeDark(false);
  await choose('dark');
  const toolbarDark = await page.evaluate(() => document.documentElement.hasAttribute('dark'));
  check('外觀只影響設定頁與彈出視窗，不改變 YouTube 的主題（FR-23）', toolbarDark === false);
} catch (err) {
  check('appearance script', false, String(err).split('\n').slice(0, 6).join(' | '));
} finally {
  await context.close();
}
if (!summary()) process.exitCode = 1;
