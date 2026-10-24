// T07a 實測：劇院模式開啟後，右側欄縮圖的實際亮度隨時間的變化，以及同時的不透明度、動畫、
// view transition 狀態。用來找出縮圖在一段時間後又變亮的原因。
// 從首頁以站內換頁進入觀看頁；只嘗試一次，遇到驗證頁就結束。
//   npm run build && node spikes/T07a/probe-thumb-time.mjs
//   SINGLE_TAB=1 node spikes/T07a/probe-thumb-time.mjs   # 擴充功能的瀏覽器只開一個分頁
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const extDir = join(root, '.output', 'chrome-mv3');
const cache = join(here, '.cache');
const profile = join(cache, 'profile-thumb-time');
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
await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
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

// 亮度在另一個瀏覽器計算，不在擴充功能的瀏覽器開第二個分頁（SINGLE_TAB=1 時；否則與先前相同開在同一個瀏覽器）
const decoder = process.env.SINGLE_TAB ? await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true }) : null;
const helper = decoder ? await decoder.newPage() : await context.newPage();
await page.bringToFront();
const luminance = async (clip) => {
  const png = await page.screenshot(clip ? { clip } : {});
  return helper.evaluate(
    async ({ b64, clip }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      // 全畫面截圖時只算右側欄縮圖的範圍
      const area = clip ? [0, 0, c.width, c.height] : [1050, 70, 200, 600];
      const d = ctx.getImageData(...area).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return Math.round((sum / (d.length / 4)) * 10) / 10;
    },
    { b64: png.toString('base64'), clip },
  );
};
const state = () =>
  page.evaluate(() => {
    const sec = document.querySelector('ytd-watch-flexy #secondary');
    const vtn = [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).viewTransitionName !== 'none').map((e) => `${e.tagName.toLowerCase()}#${e.id}=${getComputedStyle(e).viewTransitionName}`);
    return {
      secondaryOpacity: getComputedStyle(sec).opacity,
      htmlClass: document.documentElement.className,
      animations: document.getAnimations().map((a) => `${a.animationName ?? a.constructor.name}:${a.playState}:${a.effect?.target?.tagName?.toLowerCase() ?? ''}`).slice(0, 8),
      viewTransitionNames: vtn.slice(0, 8),
      activeViewTransition: 'activeViewTransition' in document ? String(document.activeViewTransition) : 'n/a',
    };
  });

console.log('before cinema: full-shot sidebar luminance', await luminance(null), JSON.stringify(await state()));
await page.locator('ytm-toolbar .ytm-btn[data-button="cinema"]').click();
for (const t of [300, 1000, 2000, 4000, 8000]) {
  await page.waitForTimeout(t === 300 ? 300 : t - [300, 1000, 2000, 4000, 8000][[300, 1000, 2000, 4000, 8000].indexOf(t) - 1]);
  const clip = { x: 1050, y: 70, width: 200, height: 600 };
  console.log(`${t}ms after cinema: clip ${await luminance(clip)} full ${await luminance(null)}`, JSON.stringify(await state()));
}
await context.close();
await decoder?.close();
