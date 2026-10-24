// T08a 重現：浮動播放器開啟（不捲動）後開劇院模式，記錄之後 3 秒內播放器容器的位置、尺寸、
// 是否浮動，以及工具列是否可見。TARGET=fixture（預設）使用本機假觀看頁；TARGET=real 從 YouTube 首頁
// 以站內換頁（搜尋 → 點影片）進入真實觀看頁，只嘗試一次，遇到驗證頁就結束，不嘗試繞過。
// THEATER=1：先開啟 YouTube 自己的劇院模式（真實頁面）。SCROLL=1：開劇院模式前先捲動讓播放器浮出。
// KEEP_SCROLL=1：與 SCROLL=1 一起用，開劇院模式時維持捲動位置（播放器正在浮動），FR-45。
// ACTION=yt-theater：開浮動播放器後改為切換 YouTube 自己的劇院模式（而不是擴充功能的劇院模式），FR-46。
//   npm run build && node spikes/T08a/repro.mjs
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { button, launch, openWatch } from '../stage1-smoke/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cache = join(here, '.cache');
mkdirSync(cache, { recursive: true });
const real = process.env.TARGET === 'real';

let context;
let page;
if (real) {
  const profile = join(cache, 'profile-real');
  rmSync(profile, { recursive: true, force: true });
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    locale: 'en-US',
    viewport: { width: 1400, height: 1000 },
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: [`--disable-extensions-except=${join(root, '.output', 'chrome-mv3')}`, `--load-extension=${join(root, '.output', 'chrome-mv3')}`],
  });
  page = context.pages()[0] ?? (await context.newPage());
  const stop = async (why) => {
    console.log(`${why}; stopping`, page.url());
    await context.close();
    process.exit(2);
  };
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  if (new URL(page.url()).hostname !== 'www.youtube.com' || (await page.locator('ytd-app').count()) === 0) await stop('verification page');
  await page.waitForTimeout(5000);
  const box = page.locator('input[name="search_query"]').first();
  await box.click();
  await box.fill('me at the zoo');
  await box.press('Enter');
  await page.waitForTimeout(5000);
  const link = page.locator('ytd-video-renderer a#thumbnail[href^="/watch"]').first();
  if (!(await link.count())) await stop('no video in search results');
  await link.click();
  try {
    await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 20_000 });
  } catch {
    await stop('toolbar did not appear');
  }
  await page.waitForTimeout(3000);
  if (process.env.THEATER) {
    await page.locator('#movie_player .ytp-size-button').click();
    await page.waitForTimeout(1500);
  }
} else {
  context = await launch({ name: 'T08a-repro' });
  page = context.pages()[0] ?? (await context.newPage());
  await openWatch(page);
}

const sample = () =>
  page.evaluate(() => {
    const c = document.querySelector('ytd-watch-flexy #player-container');
    const r = c.getBoundingClientRect();
    const tb = document.querySelector('ytm-toolbar');
    const tr = tb?.getBoundingClientRect();
    const hit = tr ? document.elementFromPoint(tr.left + 20, tr.top + tr.height / 2) : null;
    return {
      t: Math.round(performance.now()),
      floating: c.classList.contains('ytm-floating'),
      rect: [r.left, r.top, r.width, r.height].map(Math.round).join(','),
      cinema: document.documentElement.classList.contains('ytm-cinema'),
      toolbar: tb ? (hit?.closest('ytm-toolbar') ? 'visible' : `covered by ${hit?.tagName.toLowerCase()}`) : 'missing',
      scrollY: Math.round(scrollY),
    };
  });

await button(page, 'floating').click();
await page.waitForTimeout(500);
if (process.env.SCROLL) {
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(800);
}
console.log(`before ${process.env.ACTION ?? 'cinema'}`, JSON.stringify(await sample()));
if (process.env.SCROLL && !process.env.KEEP_SCROLL) await page.evaluate(() => window.scrollTo(0, 0));
if (process.env.ACTION === 'yt-theater') await page.locator('#movie_player .ytp-size-button').click();
else if (process.env.KEEP_SCROLL) await button(page, 'cinema').evaluate((b) => b.click()); // 不讓 Playwright 先捲動到按鈕
else await button(page, 'cinema').click();
const seen = [];
for (let i = 0; i < 15; i++) {
  seen.push(await sample());
  await page.waitForTimeout(200);
}
const changes = seen.filter((s, i) => i === 0 || JSON.stringify({ ...s, t: 0 }) !== JSON.stringify({ ...seen[i - 1], t: 0 }));
for (const s of changes) console.log(`after ${process.env.ACTION ?? 'cinema'}`, JSON.stringify(s));
await page.screenshot({ path: join(cache, `repro-${real ? 'real' : 'fixture'}.png`) });
await context.close();
