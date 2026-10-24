// T04 控制元件的瀏覽器檢查與截圖。
//   npx vite build --config spikes/stage1-smoke/gallery/vite.config.mjs
//   node spikes/stage1-smoke/gallery-shot.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env.SHOTS ?? join(here, '..', '..', 'specs', 'notes', 'screenshots');
mkdirSync(shots, { recursive: true });
// module script 不能從 file:// 載入，所以用只綁定 127.0.0.1 的暫時伺服器提供建置結果。
const dist = join(here, '.cache', 'gallery-dist');
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join(dist, path === '/' ? 'index.html' : path.replace(/\.\./g, ''));
  try {
    const body = readFileSync(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 520, height: 640 } });
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

await page.goto(url);
const thumbs = page.locator('[role="slider"]');
const end = page.locator('#end');
const start = page.locator('#start');
const download = page.getByRole('button', { name: 'Download' });

// 鍵盤調整把手，輸入框同步
await thumbs.nth(0).focus();
await page.keyboard.press('ArrowRight');
// Preact 的重新繪製是非同步的：等畫面更新再讀取（避免讀到按鍵前的值）。
await page.waitForFunction(() => document.querySelector('[role="slider"]').getAttribute('aria-valuenow') !== '90', null, { timeout: 2000 }).catch(() => {});
check('方向鍵移動開始把手並同步輸入框', (await thumbs.nth(0).getAttribute('aria-valuenow')) === '91' && (await start.inputValue()) === '00:01:31');
await page.keyboard.press('End');
check('開始把手不會超過結束', (await thumbs.nth(0).getAttribute('aria-valuenow')) === '225');
await page.keyboard.press('Home');

// 拖動結束把手
const track = await page.locator('.ytm-range-track').boundingBox();
const endBox = await thumbs.nth(1).boundingBox();
await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
await page.mouse.down();
await page.mouse.move(track.x + track.width * 0.5, endBox.y + endBox.height / 2, { steps: 5 });
await page.mouse.up();
const endNow = Number(await thumbs.nth(1).getAttribute('aria-valuenow'));
check('拖動結束把手', endNow > 100 && endNow < 140, `end=${endNow} input=${await end.inputValue()}`);

// 輸入框改值，滑桿同步
await end.fill('00:03:00');
check('輸入框改值同步滑桿', (await thumbs.nth(1).getAttribute('aria-valuenow')) === '180');

// 不合法的輸入
await end.fill('00:99:00');
check('格式錯誤時輸入框標示錯誤、下載停用', (await end.getAttribute('aria-invalid')) === 'true' && (await download.isDisabled()));
await page.screenshot({ path: join(shots, 'T04-controls-invalid-light.png') });
await start.fill('00:02:00');
await end.fill('00:01:00');
check('開始晚於結束時停用', await download.isDisabled());
await start.fill('00:01:30');
await end.fill('00:03:45');
check('合法時啟用', !(await download.isDisabled()));

// 開關
const sw = page.getByRole('switch', { name: 'Sync with player' });
await sw.click();
check('開關切換 aria-checked', (await sw.getAttribute('aria-checked')) === 'false');
await sw.click();

await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await page.screenshot({ path: join(shots, 'T04-controls-light.png') });
await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
await page.waitForTimeout(300);
await page.screenshot({ path: join(shots, 'T04-controls-dark.png') });

await browser.close();
server.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
