// T06b 實測：首頁即時切換主題後，以站內換頁（頂端列搜尋 → 點影片）進入觀看頁，確認觀看頁的主題屬性與
// 顏色，與「以該主題載入首頁、同樣換頁進入觀看頁」的結果相同。觀看頁直接載入在本環境會被驗證頁擋住，
// 所以只用站內換頁；每個情境只嘗試一次，YouTube 顯示驗證頁時直接結束，不嘗試繞過。
//   npx rolldown -c spikes/T06b/rolldown.config.mjs && node spikes/T06b/probe-watch-spa.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
// 完全相同或近似（見 compare.mjs）才算通過；近似的項目另外列出。
import { compare } from './compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const harness = readFileSync(join(here, '.cache', 'harness.js'), 'utf8');
const shots = process.env.SHOTS ? join(here, '..', '..', process.env.SHOTS) : join(here, '.cache');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
});

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** 載入首頁（可選擇即時切換主題），搜尋並點進影片，回傳觀看頁的狀態與顏色。 */
async function toWatch(pref, toggle, shotName) {
  const context = await browser.newContext({ colorScheme: 'light', locale: 'en-US', viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'PREF', value: pref, domain: '.youtube.com', path: '/' }]);
  const page = await context.newPage();
  const stop = async (why) => {
    console.log(`${why}; stopping`, page.url());
    await browser.close();
    process.exit(2);
  };
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (new URL(page.url()).hostname !== 'www.youtube.com' || (await page.locator('ytd-app').count()) === 0) await stop('verification page');
  await page.waitForTimeout(6000);
  await page.evaluate(harness);
  await page.evaluate((toggle) => {
    window.__probeMarker = 1;
    if (toggle) window.__ytmDark.toggle();
  }, toggle);
  await page.waitForTimeout(1500);
  const box = page.locator('input[name="search_query"]').first();
  await box.click();
  await box.fill('me at the zoo');
  await box.press('Enter');
  await page.waitForTimeout(5000);
  const link = page.locator('ytd-video-renderer a#thumbnail[href="/watch?v=jNQXAC9IVRw"], ytd-video-renderer a#thumbnail[href^="/watch"]').first();
  if (!(await link.count())) await stop('no video in search results');
  await link.click();
  await page.mouse.move(1270, 890);
  await page.waitForTimeout(8000);
  const info = await page.evaluate(() => {
    const flexy = document.querySelector('ytd-watch-flexy');
    return {
      url: location.pathname + location.search.slice(0, 14),
      alive: window.__probeMarker === 1,
      watchVisible: !!flexy && !flexy.hidden && flexy.getBoundingClientRect().height > 0,
      verification: /unusual traffic|not a robot/i.test(document.body.innerText.slice(0, 5000)),
      html: ['dark', 'light'].filter((a) => document.documentElement.hasAttribute(a)),
      themed: [...document.querySelectorAll('[dark],[is-dark-theme],[is-dark-mode],[page-dark-theme]')]
        .map((e) => `${e.tagName.toLowerCase()}[${['dark', 'is-dark-theme', 'is-dark-mode', 'page-dark-theme'].filter((a) => e.hasAttribute(a)).join(',')}]`)
        .filter((v, i, a) => a.indexOf(v) === i),
      pref: (document.cookie.split('; ').find((c) => c.startsWith('PREF=')) ?? '').slice(5),
    };
  });
  // 觀看頁上方（播放器周圍、標題、說明、右側清單）的顏色；播放器內部的畫面不比對
  const colors = await page.evaluate(() => {
    const result = {};
    for (const el of document.querySelectorAll('ytd-app *')) {
      if (el.closest('#movie_player')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.top > innerHeight || r.bottom < 0) continue;
      const cls =
        typeof el.className === 'string'
          ? el.className.trim().split(/\s+/).filter((c) => c && !/^(?:style-scope|x-scope)$/.test(c)).sort().slice(0, 3).join('.')
          : '';
      const key = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (cls ? `.${cls}` : '');
      if (key in result) continue;
      const s = getComputedStyle(el);
      result[key] = [s.backgroundColor, s.color, s.borderTopColor].join(' | ');
    }
    return result;
  });
  if (shotName) await page.screenshot({ path: join(shots, shotName) });
  await context.close();
  return { info, colors };
}


for (const [label, nativePref, startPref, target] of [
  ['light -> dark', 'f6=400', 'f6=80000', 'dark'],
  ['dark -> light', 'f6=80000', 'f6=400', 'light'],
]) {
  console.log(`\n=== ${label}`);
  const ref = await toWatch(nativePref, false, null);
  console.log('reference (loaded as target theme)', JSON.stringify(ref.info));
  const got = await toWatch(startPref, true, `T06b-watch-${target}.png`);
  console.log('switched instantly on the homepage', JSON.stringify(got.info));
  check(`${label}: 站內換頁到觀看頁，沒有重新載入、沒有驗證頁`, got.info.alive && got.info.watchVisible && !got.info.verification, got.info.url);
  check(`${label}: 觀看頁的主題屬性與以${target}載入時相同`, JSON.stringify(got.info.themed.sort()) === JSON.stringify(ref.info.themed.sort()), `${got.info.themed} vs ${ref.info.themed}`);
  const c = compare(ref.colors, got.colors);
  console.log('compare', JSON.stringify(c, null, 1));
  check(
    `${label}: 觀看頁顏色與以${target}載入時相同或近似（播放器外的元素）`,
    c.mismatched === 0,
    `mismatched=${c.mismatched} approximate=${c.approximate.length} of ${c.compared}`,
  );
}
await browser.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exitCode = 1;
