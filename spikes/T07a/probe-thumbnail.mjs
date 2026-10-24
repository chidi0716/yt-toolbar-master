// T07a 實測：劇院模式開啟後，右側推薦影片的縮圖看起來仍然很亮。列出縮圖 <img> 到 #secondary 之間
// 每個祖先的不透明度、定位與會讓它脫離一般繪製順序的屬性，並截取右側欄的圖。
// 從首頁以站內換頁進入觀看頁；只嘗試一次，遇到驗證頁就結束。
//   npm run build && node spikes/T07a/probe-thumbnail.mjs
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const extDir = join(root, '.output', 'chrome-mv3');
const cache = join(here, '.cache');
const profile = join(cache, 'profile-thumb');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  locale: 'en-US',
  viewport: { width: 1400, height: 1000 },
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const page = context.pages()[0] ?? (await context.newPage());
const stop = async (why) => {
  console.log(`${why}; stopping`, page.url());
  await context.close();
  process.exit(2);
};
await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
if (new URL(page.url()).hostname !== 'www.youtube.com' || (await page.locator('ytd-app').count()) === 0) await stop('verification page');
await page.waitForTimeout(5000);
const box = page.locator('input[name="search_query"]').first();
await box.click();
await box.fill('me at the zoo');
await box.press('Enter');
await page.waitForTimeout(5000);
await page.locator('ytd-video-renderer a#thumbnail[href^="/watch"]').first().click();
try {
  await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 20_000 });
} catch {
  await stop('toolbar did not appear');
}
await page.waitForTimeout(4000);
await page.locator('ytm-toolbar .ytm-btn[data-button="cinema"]').click();
await page.mouse.move(500, 400);
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const sr = document.querySelector('ytd-watch-flexy #secondary').getBoundingClientRect();
  // 畫面上看得到的縮圖：右側欄左邊 1/4、上方 100px 的位置
  const img = document.elementFromPoint(sr.left + sr.width / 4, sr.top + 100);
  if (!img) return 'no img';
  const chain = [];
  let product = 1;
  for (let el = img; el && el !== document.documentElement; el = el.parentElement) {
    const s = getComputedStyle(el);
    product *= Number(s.opacity);
    const flags = [];
    for (const p of ['position', 'zIndex', 'opacity', 'transform', 'willChange', 'filter', 'mixBlendMode', 'isolation', 'contentVisibility', 'viewTransitionName', 'backdropFilter', 'animationName', 'transitionProperty', 'display']) {
      const v = s[p];
      if (v && !['static', 'auto', '1', 'none', 'normal', 'visible', 'all', 'block', 'inline', 'flex'].includes(v)) flags.push(`${p}=${v}`);
    }
    chain.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''} ${flags.join(' ')}`);
    if (el.id === 'secondary') break;
  }
  const r = img.getBoundingClientRect();
  return { effectiveOpacity: product, rect: [r.left, r.top, r.width, r.height].map(Math.round), inSecondary: !!img.closest('#secondary'), chain };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: join(cache, 'thumb-cinema.png'), clip: { x: 980, y: 56, width: 420, height: 500 } });
// 同一張圖，關閉 GPU 合成的影響：以 CDP 截圖（fromSurface: false）比較
const cdp = await context.newCDPSession(page);
const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 980, y: 56, width: 420, height: 500, scale: 1 } });
const { writeFileSync } = await import('node:fs');
writeFileSync(join(cache, 'thumb-cinema-cdp.png'), Buffer.from(shot.data, 'base64'));
await context.close();
