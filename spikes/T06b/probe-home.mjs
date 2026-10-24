// T06b 實測：在 YouTube 首頁執行擴充功能實際的深色模式模組（harness.ts 打包後放進頁面），
// 確認即時切換：不重新載入、下一個畫面就是新主題（沒有白畫面）、整頁顏色與 YouTube 以該主題
// 載入時相同、10 秒內與站內換頁後不會被改回去、重新整理後維持。
// 參考值：分別以 f6=400、f6=80000 載入首頁，收集每種元素（tag#id.class）第一個可見元素的顏色。
// YouTube 顯示驗證頁時直接結束，不嘗試繞過。
//   npx rolldown -c spikes/T06b/rolldown.config.mjs && node spikes/T06b/probe-home.mjs
//   SHOTS=specs/notes/screenshots node spikes/T06b/probe-home.mjs   # 另外輸出 T06b-home-*.png
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
// 完全相同或近似（見 compare.mjs）才算通過；近似的項目另外列出。
import { compare } from './compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '.cache');
mkdirSync(out, { recursive: true });
const harness = readFileSync(join(out, 'harness.js'), 'utf8');
const shots = process.env.SHOTS ? join(here, '..', '..', process.env.SHOTS) : null;

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

async function open(pref, colorScheme = 'light') {
  const context = await browser.newContext({ colorScheme, locale: 'en-US', viewport: { width: 1280, height: 900 } });
  if (pref !== null) await context.addCookies([{ name: 'PREF', value: pref, domain: '.youtube.com', path: '/' }]);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.text().includes('[yt-toolbar-master]')) console.log('  console:', m.text());
  });
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (new URL(page.url()).hostname !== 'www.youtube.com' || (await page.locator('ytd-app').count()) === 0) {
    console.log('verification page; stopping', page.url());
    await browser.close();
    process.exit(2);
  }
  await page.waitForTimeout(6000);
  return page;
}

const sample = (page) =>
  page.evaluate(() => {
    const result = {};
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.top > innerHeight || r.bottom < 0) continue;
      const cls =
        typeof el.className === 'string'
          ? el.className.trim().split(/\s+/).filter((c) => c && !/^(?:style-scope|x-scope)$/.test(c)).sort().slice(0, 3).join('.')
          : '';
      const key = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (cls ? `.${cls}` : '');
      if (key in result) continue;
      const s = getComputedStyle(el);
      result[key] = [s.backgroundColor, s.color, s.borderTopColor, s.fill].join(' | ');
    }
    result['<html>'] = getComputedStyle(document.documentElement).backgroundColor;
    return result;
  });


const state = (page) =>
  page.evaluate(() => ({
    url: location.pathname,
    html: ['dark', 'light'].filter((a) => document.documentElement.hasAttribute(a)),
    masthead: ['dark', 'page-dark-theme'].filter((a) => document.querySelector('ytd-masthead')?.hasAttribute(a)),
    watchFlexy: document.querySelector('ytd-watch-flexy')?.hasAttribute('is-dark-theme') ?? null,
    pref: (document.cookie.split('; ').find((c) => c.startsWith('PREF=')) ?? '').slice(5),
    appBg: getComputedStyle(document.querySelector('ytd-app')).backgroundColor,
    button: window.__ytmDark?.state.get().active ?? null,
    alive: window.__probeMarker === 1,
  }));

const install = async (page) => {
  await page.evaluate(harness);
  await page.evaluate(() => (window.__probeMarker = 1));
};

/** 按下（模擬）深色模式按鈕，記錄下一個畫面的背景色。 */
const press = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const before = getComputedStyle(document.querySelector('ytd-app')).backgroundColor;
        window.__ytmDark.toggle();
        const sync = getComputedStyle(document.querySelector('ytd-app')).backgroundColor;
        requestAnimationFrame(() => {
          const frame1 = getComputedStyle(document.querySelector('ytd-app')).backgroundColor;
          requestAnimationFrame(() => resolve({ before, sync, frame1, frame2: getComputedStyle(document.querySelector('ytd-app')).backgroundColor }));
        });
      }),
  );

const prefTheme = (pref) => {
  const m = /(?:^|&)f6=([0-9a-fA-F]+)/.exec(pref);
  const f = m ? parseInt(m[1], 16) : 0;
  return f & 0x400 ? 'dark' : f & 0x80000 ? 'light' : 'unset';
};

const refs = {};
for (const [theme, pref] of [
  ['dark', 'f6=400'],
  ['light', 'f6=80000'],
]) {
  const page = await open(pref);
  refs[theme] = { colors: await sample(page), bg: (await state(page)).appBg };
  console.log(`reference ${theme}`, JSON.stringify(await state(page)));
  await page.context().close();
}

const scenarios = [
  ['light -> dark', 'f6=80000', 'dark'],
  ['dark -> light', 'f6=400', 'light'],
  ['unset -> dark', null, 'dark'],
];
for (const [label, startPref, target] of scenarios) {
  console.log(`\n=== ${label}`);
  const page = await open(startPref);
  await install(page);
  const start = await state(page);
  console.log('start', JSON.stringify(start));
  if (shots) await page.screenshot({ path: join(shots, `T06b-home-${label.split(' ')[0]}-before.png`) });

  const frames = await press(page);
  const s1 = await state(page);
  check(`${label}: 不重新載入`, s1.alive, JSON.stringify(s1));
  check(
    `${label}: 下一個畫面就是新主題的背景（沒有閃一下舊主題或白畫面）`,
    frames.sync === refs[target].bg && frames.frame1 === refs[target].bg && frames.frame2 === refs[target].bg,
    JSON.stringify(frames),
  );
  check(`${label}: 按鈕狀態與主題偏好`, s1.button === (target === 'dark') && prefTheme(s1.pref) === target, `pref=${s1.pref}`);
  await page.waitForTimeout(1000);
  const c1 = compare(refs[target].colors, await sample(page));
  check(`${label}: 整頁顏色與 YouTube 以${target}載入時相同`, c1.mismatched === 0, JSON.stringify(c1));
  if (shots) await page.screenshot({ path: join(shots, `T06b-home-${label.split(' ')[0]}-after.png`) });

  await page.waitForTimeout(10_000);
  const s10 = await state(page);
  const c10 = compare(refs[target].colors, await sample(page));
  check(`${label}: 10 秒後沒有被改回去`, s10.alive && prefTheme(s10.pref) === target && c10.mismatched === 0, `${JSON.stringify(s10)} mismatched=${c10.mismatched}`);

  // 站內換頁：側欄的 Shorts、You，再回首頁
  for (const sel of ['a[href^="/shorts"]', 'a[href="/feed/you"]', 'a[href="/"]']) {
    const link = page.locator(`ytd-guide-entry-renderer ${sel}, ytd-mini-guide-entry-renderer ${sel}`).first();
    if (!(await link.count())) {
      console.log('  no guide link', sel);
      continue;
    }
    await link.click();
    // 把滑鼠移開，避免側欄項目的滑鼠移入效果影響顏色比對
    await page.mouse.move(700, 880);
    await page.waitForTimeout(4000);
    const s = await state(page);
    check(
      `${label}: 站內換頁到 ${s.url} 後仍是${target}`,
      s.alive && prefTheme(s.pref) === target && s.html.includes(target === 'dark' ? 'dark' : 'light') && (s.masthead.length === 2) === (target === 'dark') && s.watchFlexy === (target === 'dark'),
      JSON.stringify(s),
    );
  }
  await page.waitForTimeout(1000);
  const cNav = compare(refs[target].colors, await sample(page));
  check(`${label}: 換頁回首頁後整頁顏色仍正確`, cNav.mismatched === 0, JSON.stringify(cNav));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const sr = await state(page);
  const cr = compare(refs[target].colors, await sample(page));
  check(`${label}: 重新整理後維持${target}`, sr.html.includes('dark') === (target === 'dark') && cr.mismatched === 0, `${JSON.stringify(sr)} ${JSON.stringify(cr)}`);
  await page.context().close();
}

// 連按兩次：回到原本的主題（以深色載入的頁面切到淺色再切回深色）
{
  console.log('\n=== dark -> light -> dark');
  const page = await open('f6=400');
  await install(page);
  await press(page);
  await page.waitForTimeout(800);
  const frames = await press(page);
  await page.waitForTimeout(1000);
  const s = await state(page);
  const c = compare(refs.dark.colors, await sample(page));
  check('再按一次回到深色，不重新載入、整頁顏色正確', s.alive && s.html.join() === 'dark' && prefTheme(s.pref) === 'dark' && c.mismatched === 0 && frames.frame1 === refs.dark.bg, `${JSON.stringify(s)} ${JSON.stringify(c)}`);
  await page.context().close();
}

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exitCode = 1;
