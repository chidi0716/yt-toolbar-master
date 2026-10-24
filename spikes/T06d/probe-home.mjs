// T06d 實測：在 YouTube 首頁（未登入）執行擴充功能實際的深色模式模組（harness.ts 打包後放進頁面），
// 確認由程式操作 YouTube 外觀選單可以切換主題；記錄操作期間每個畫面中 YouTube 的彈出選單是否看得見
// （存在 sessionStorage，重新載入後讀回）、YouTube 是否重新載入頁面、切換後的主題與外觀選單的勾選。
// 英文與繁體中文介面都測，確認不依顯示文字。YouTube 顯示驗證頁時直接結束，不嘗試繞過。
//   npx rolldown -c spikes/T06d/rolldown.config.mjs && node spikes/T06d/probe-home.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const harness = readFileSync(join(here, '.cache', 'harness.js'), 'utf8');
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

async function open(context, hl) {
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.text().includes('[yt-toolbar-master]')) console.log('  console:', m.text());
  });
  await page.goto(`https://www.youtube.com/?hl=${hl}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  if (new URL(page.url()).hostname !== 'www.youtube.com' || (await page.locator('ytd-app').count()) === 0) {
    console.log('verification page; stopping', page.url());
    await browser.close();
    process.exit(2);
  }
  await page.waitForTimeout(5000);
  return page;
}

/** YouTube 外觀選單目前勾選的選項（以動作代號表示，不看文字）。 */
const appearanceChecked = (page) =>
  page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('ytd-masthead #end #buttons ytd-topbar-menu-button-renderer:last-of-type button')?.click();
    await sleep(1200);
    document.querySelector('ytd-popup-container ytd-toggle-theme-compact-link-renderer')?.click();
    await sleep(1200);
    const items = [...document.querySelectorAll('ytd-popup-container #submenu ytd-compact-link-renderer')];
    const checked = items
      .filter((el) => el.data?.icon?.iconType === 'CHECK')
      .map((el) => el.data?.serviceEndpoint?.signalServiceEndpoint?.actions?.[0]?.signalAction?.signal);
    document.querySelector('ytd-masthead #end #buttons ytd-topbar-menu-button-renderer:last-of-type button')?.click();
    await sleep(500);
    return checked.join(',') || null;
  });

for (const [label, locale, hl, startPref, target] of [
  ['light -> dark (en)', 'en-US', 'en', 'f6=80000', 'dark'],
  ['dark -> light (en)', 'en-US', 'en', 'f6=400', 'light'],
  ['light -> dark (zh-TW)', 'zh-TW', 'zh-TW', 'f6=80000', 'dark'],
]) {
  console.log(`\n=== ${label}`);
  const context = await browser.newContext({ locale, viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'PREF', value: `hl=${hl}&${startPref}`, domain: '.youtube.com', path: '/' }]);
  const page = await open(context, hl);
  let loads = 0;
  page.on('load', () => loads++);
  await page.evaluate(harness);
  // 每個畫面記錄：YouTube 的彈出選單是否看得見（顯示中、有大小、實際不透明度 > 0）
  await page.evaluate(() => {
    sessionStorage.setItem('__frames', '[]');
    const t0 = performance.now();
    const visible = () =>
      [...document.querySelectorAll('ytd-popup-container tp-yt-iron-dropdown')].some((d) => {
        if (d.getAttribute('aria-hidden') === 'true' || d.getClientRects().length === 0) return false;
        let o = 1;
        for (let e = d; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        return o > 0;
      });
    const open = () => [...document.querySelectorAll('ytd-popup-container tp-yt-iron-dropdown')].some((d) => d.getClientRects().length > 0 && d.getAttribute('aria-hidden') !== 'true');
    const frames = [];
    const loop = () => {
      frames.push(`${Math.round(performance.now() - t0)}:${open() ? 'open' : '-'}:${visible() ? 'VISIBLE' : '-'}`);
      if (frames.length % 5 === 0) sessionStorage.setItem('__frames', JSON.stringify(frames));
      if (performance.now() - t0 < 8000) requestAnimationFrame(loop);
    };
    addEventListener('beforeunload', () => {
      frames.push(`${Math.round(performance.now() - t0)}:beforeunload`);
      sessionStorage.setItem('__frames', JSON.stringify(frames));
    });
    requestAnimationFrame(loop);
    window.__probeMarker = 1;
  });
  const t0 = Date.now();
  await page.evaluate(() => window.__ytmDark.toggle());
  await page.waitForTimeout(8000);
  const frames = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__frames') ?? '[]'));
  const alive = await page.evaluate(() => window.__probeMarker === 1);
  const dark = await page.evaluate(() => document.documentElement.hasAttribute('dark'));
  const pref = (await context.cookies('https://www.youtube.com/')).find((c) => c.name === 'PREF')?.value;
  const visibleFrames = frames.filter((f) => f.endsWith(':VISIBLE'));
  const openFrames = frames.filter((f) => f.includes(':open:'));
  console.log(`  frames=${frames.length} openFrames=${openFrames.length} visibleFrames=${visibleFrames.length} reloaded=${!alive || loads > 0} elapsed≈${Date.now() - t0}ms`);
  console.log(`  frame log (first 12 with menu open): ${openFrames.slice(0, 12).join(' ')} ${frames.find((f) => f.includes('beforeunload')) ?? ''}`);
  check(`${label}: 切換成功`, dark === (target === 'dark'), `dark=${dark} pref=${pref}`);
  check(`${label}: 操作期間 YouTube 的選單沒有被看見`, visibleFrames.length === 0, visibleFrames.slice(0, 5).join(' '));
  console.log(`  YouTube reloaded the page: ${!alive || loads > 0}`);
  const checked = await appearanceChecked(page);
  check(`${label}: YouTube 外觀選單的勾選改為新主題`, checked === (target === 'dark' ? 'TOGGLE_DARK_THEME_ON' : 'TOGGLE_DARK_THEME_OFF'), String(checked));
  await context.close();
}
// 找不到選項（不處理橋接請求，選項無法被標記）：擴充功能自己關閉 YouTube 的選單，過程中與關閉後都不可見，
// 主題與偏好不變（FR-15）。這也驗證已登入時（YouTube 不重新載入）由擴充功能關閉選單的流程。
{
  console.log('\n=== option not found (bridge disabled)');
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'PREF', value: 'hl=en&f6=80000', domain: '.youtube.com', path: '/' }]);
  const page = await open(context, 'en');
  const prefBefore = (await context.cookies('https://www.youtube.com/')).find((c) => c.name === 'PREF')?.value;
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.evaluate(() => (window.__ytmNoBridge = true));
  await page.evaluate(harness);
  await page.evaluate(() => {
    window.__frames = { open: 0, visible: 0, total: 0 };
    const t0 = performance.now();
    const loop = () => {
      window.__frames.total++;
      for (const d of document.querySelectorAll('ytd-popup-container tp-yt-iron-dropdown')) {
        if (d.getAttribute('aria-hidden') === 'true' || d.getClientRects().length === 0) continue;
        window.__frames.open++;
        let o = 1;
        for (let e = d; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        if (o > 0) window.__frames.visible++;
      }
      if (performance.now() - t0 < 9000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__ytmDark.toggle();
  });
  await page.waitForTimeout(9500);
  const after = await page.evaluate(() => ({
    frames: window.__frames,
    dark: document.documentElement.hasAttribute('dark'),
    busyClass: document.documentElement.classList.contains('ytm-theme-menu-busy'),
    menuOpen: [...document.querySelectorAll('ytd-popup-container tp-yt-iron-dropdown')].some((d) => d.getAttribute('aria-hidden') !== 'true' && d.getClientRects().length > 0),
    notice: window.__ytmDark.state.get().notice ?? null,
  }));
  const prefAfter = (await context.cookies('https://www.youtube.com/')).find((c) => c.name === 'PREF')?.value;
  console.log('  ', JSON.stringify(after), `pref ${prefBefore} -> ${prefAfter}`);
  check('找不到選項：主題與偏好不變', !after.dark && prefAfter === prefBefore);
  check('找不到選項：選單曾打開但沒有被看見，結束後已關閉、暫時的 class 已移除', after.frames.open > 0 && after.frames.visible === 0 && !after.menuOpen && !after.busyClass, JSON.stringify(after.frames));
  check('找不到選項：在 console 記錄原因', logs.some((l) => l.includes('NO_THEME_OPTION')), logs.filter((l) => l.includes('yt-toolbar-master')).join(' | '));
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exitCode = 1;
