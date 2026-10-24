// 以本機的假觀看頁（fixtures/watch.html）檢查 T05：說明面板、設定頁連結、✕ 與彈出視窗連動、
// 繁體中文介面。瀏覽器對 https://www.youtube.com/* 的請求全部由 Playwright 的 route 回應本機檔案，
// 不會連到 YouTube。真實 YouTube 上的檢查見 smoke.mjs。
//   npm install --no-save playwright-core@1.56.1 && npm run build
//   node spikes/stage1-smoke/fixture-test.mjs
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const extDir = join(root, '.output', 'chrome-mv3');
const shots = process.env.SHOTS ?? join(root, 'specs', 'notes', 'screenshots');
const fixture = readFileSync(join(here, 'fixtures', 'watch.html'), 'utf8');
const video = readFileSync(join(here, 'fixtures', 'test.webm'));
const EXT_ID = 'bkjlangdjfpllnkcpfpdlajchbginjdj';
const WATCH = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function launch(lang) {
  const profile = join(here, '.cache', `profile-fixture-${lang}`);
  rmSync(profile, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    locale: lang,
    viewport: { width: 1200, height: 1400 },
    args: [`--lang=${lang}`, `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  // 所有 youtube.com 的請求都回應假頁面；其他網址一律拒絕，確保不連外。
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.hostname === 'www.youtube.com' && url.pathname === '/__fixture/test.webm') {
      return route.fulfill({ status: 200, contentType: 'video/webm', body: video });
    }
    // 假頁面共用的腳本（fixtures/*.js）
    const script = /^\/__fixture\/([a-z0-9-]+\.js)$/.exec(url.pathname);
    if (url.hostname === 'www.youtube.com' && script) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(join(here, 'fixtures', script[1]), 'utf8') });
    }
    if (url.hostname === 'www.youtube.com') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    }
    return route.abort();
  });
  return context;
}

const shotToolbar = async (page, name) => {
  const clip = await page.evaluate(() => {
    const t = document.querySelector('ytm-toolbar').getBoundingClientRect();
    const panel = document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-panel')?.getBoundingClientRect();
    const y = Math.max(0, t.top - 60);
    return { x: 0, y, width: Math.ceil(t.right + 24), height: Math.ceil((panel ? panel.bottom : t.bottom + 40) + 24 - y) };
  });
  await page.screenshot({ path: join(shots, name), clip });
};

const toolbarState = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('ytm-toolbar')?.shadowRoot;
    return {
      count: document.querySelectorAll('ytm-toolbar').length,
      labels: root ? [...root.querySelectorAll('.ytm-btn')].map((b) => b.getAttribute('aria-label')) : [],
      help: root
        ? [...root.querySelectorAll('.ytm-help-item')].map((li) => ({
            id: li.dataset.button,
            name: li.querySelector('.ytm-help-name')?.textContent,
            desc: li.querySelector('.ytm-help-desc')?.textContent,
            icon: !!li.querySelector('svg path'),
          }))
        : [],
    };
  });

// ---------- 英文 ----------
{
  const context = await launch('en-US');
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto(WATCH);
    await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 10_000 });

    // 滑鼠停留時顯示提示文字（FR-7）
    await page.locator('ytm-toolbar .ytm-btn[data-button="mp3"]').hover();
    await page.waitForTimeout(600);
    const tip = await page.evaluate(() => {
      const el = document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-btn[data-button="mp3"] + .ytm-tooltip');
      return { text: el.textContent, opacity: getComputedStyle(el).opacity };
    });
    check('滑鼠停留時顯示提示文字（FR-7）', tip.text === 'MP3' && tip.opacity === '1', JSON.stringify(tip));
    await shotToolbar(page, 'T03-tooltip.png');

    // 直接執行的按鈕（截圖，T17）：點了在提示文字中顯示結果（002 FR-52）
    await page.locator('ytm-toolbar .ytm-btn[data-button="screenshot"]').click();
    await page.waitForTimeout(300);
    const soon = await page.evaluate(() => {
      const tip = document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-btn[data-button="screenshot"] + .ytm-tooltip');
      return { text: tip.textContent, notice: tip.hasAttribute('data-notice') };
    });
    check('直接執行的按鈕（截圖）在提示文字中顯示結果', soon.notice && soon.text !== 'Screenshot', JSON.stringify(soon));
    await page.mouse.move(5, 5);

    await page.locator('ytm-toolbar .ytm-btn[data-button="help"]').click();
    await page.waitForTimeout(300);
    let s = await toolbarState(page);
    check(
      '說明面板列出全部 14 顆按鈕的圖示、名稱與說明（FR-17）',
      s.help.length === 14 && s.help.every((i, n) => i.icon && i.name === s.labels[n] && (i.desc ?? '').length > 5),
      s.help.map((i) => i.name).join(', '),
    );
    await shotToolbar(page, 'T05-help-panel-en.png');

    const optionsPage = context.waitForEvent('page', { timeout: 10_000 });
    await page.locator('ytm-toolbar .ytm-help .ytm-link').click();
    const opened = await optionsPage.catch(() => null);
    if (opened) await opened.waitForLoadState();
    check('說明面板的連結開啟擴充功能的設定頁', opened?.url() === `chrome-extension://${EXT_ID}/options.html`, opened?.url());
    await opened?.close();

    // 換頁時說明面板（未釘選）收起，工具列仍只有一條
    await page.bringToFront();
    await page.locator('#next').click();
    await page.waitForTimeout(500);
    s = await toolbarState(page);
    check('站內換頁後工具列只有一條', s.count === 1 && s.help.length === 0);

    // ✕
    await page.locator('ytm-toolbar .ytm-btn[data-button="close"]').click();
    await page.waitForFunction(() => !document.querySelector('ytm-toolbar'), null, { timeout: 5000 });
    await page.reload();
    await page.waitForTimeout(1500);
    check('按 ✕ 後工具列隱藏，重新整理後仍隱藏（FR-15）', (await toolbarState(page)).count === 0);

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 280, height: 120 });
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
    const checkbox = popup.locator('#enabled');
    // 等彈出視窗的腳本跑完（文字已換成語系文字）再操作。
    await popup.waitForFunction(() => !!document.querySelector('h1')?.textContent);
    await popup.waitForTimeout(300);
    const unchecked = !(await checkbox.isChecked());
    await popup.screenshot({ path: join(shots, 'T05-popup-en-disabled.png') });
    await checkbox.check();
    await page.bringToFront();
    const back = await page
      .waitForFunction(() => !!document.querySelector('ytm-toolbar'), null, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check('彈出視窗的「啟用」反映 ✕，打開後工具列重新出現（FR-16）', unchecked && back, `unchecked=${unchecked} back=${back}`);
    await popup.close();
  } catch (err) {
    check('en fixture test', false, String(err).split('\n')[0]);
  } finally {
    await context.close();
  }
}

// ---------- 繁體中文 ----------
{
  const context = await launch('zh-TW');
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto(WATCH);
    await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 10_000 });
    await page.locator('ytm-toolbar .ytm-btn[data-button="help"]').click();
    await page.waitForTimeout(300);
    const s = await toolbarState(page);
    check('繁體中文的按鈕名稱與說明（NFR-4）', s.labels[0] === '影片' && s.labels[5] === '連結' && s.labels[13] === '關閉' && s.help[0]?.name === '影片', s.labels.join('、'));
    await shotToolbar(page, 'T05-help-panel-zh-TW.png');

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 280, height: 120 });
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await popup.waitForFunction(() => !!document.querySelector('h1')?.textContent);
    const text = (await popup.locator('main').innerText()).replace(/\s+/g, ' ');
    check('彈出視窗的繁體中文文字', text.includes('啟用'), text);
    await popup.screenshot({ path: join(shots, 'T05-popup-zh-TW.png') });

    const options = await context.newPage();
    await options.goto(`chrome-extension://${EXT_ID}/options.html`);
    await options.waitForFunction(() => !!document.querySelector('h1')?.textContent);
    const h1 = await options.locator('h1').innerText();
    check('設定頁的繁體中文標題', h1 === '設定', h1);
  } catch (err) {
    check('zh-TW fixture test', false, String(err).split('\n')[0]);
  } finally {
    await context.close();
  }
}

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
