// T07a 實測：在真實的 YouTube 觀看頁上開啟擴充功能的劇院模式，以 document.elementFromPoint 檢查
// 播放器中央、控制列、工具列按鈕的位置最上層是什麼元素；並列出播放器的祖先中形成堆疊脈絡的元素，
// 以及頁面各區塊的選擇器與位置。觀看頁直接載入在本環境會被驗證頁擋住，所以從首頁以站內換頁
// （頂端列搜尋 → 點影片）進入；只嘗試一次，遇到驗證頁就結束，不嘗試繞過。
//   npm run build && node spikes/T07a/real-cinema.mjs [輸出截圖檔名]
//   PREF=f6=400 …：深色主題；THEATER=1 …：同時開啟 YouTube 自己的劇院模式
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const extDir = join(root, '.output', 'chrome-mv3');
const cache = join(here, '.cache');
const profile = join(cache, 'profile');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
const shotPath = process.argv[2] ? join(root, process.argv[2]) : join(cache, 'real-cinema.png');

const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  locale: 'en-US',
  colorScheme: 'light',
  viewport: { width: 1400, height: 1000 },
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
if (process.env.PREF) {
  await context.addCookies([{ name: 'PREF', value: process.env.PREF, domain: '.youtube.com', path: '/' }]);
}
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
const link = page.locator('ytd-video-renderer a#thumbnail[href^="/watch"]').first();
if (!(await link.count())) await stop('no video in search results');
await link.click();
try {
  await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 20_000 });
} catch {
  await stop('toolbar did not appear');
}
await page.waitForTimeout(3000);
if (/unusual traffic|not a robot/i.test(await page.evaluate(() => document.body.innerText.slice(0, 5000)))) await stop('verification page');

// THEATER=1：先開啟 YouTube 自己的劇院模式（加寬播放器，播放器移到 #full-bleed-container），確認可同時使用（FR-23）
if (process.env.THEATER) {
  await page.locator('#movie_player .ytp-size-button').click();
  await page.waitForTimeout(1500);
  console.log('YouTube theater mode', await page.evaluate(() => document.querySelector('ytd-watch-flexy')?.hasAttribute('theater')));
}

// 播放器的祖先中形成堆疊脈絡的元素
const stacking = await page.evaluate(() => {
  const out = [];
  for (let el = document.querySelector('#movie_player'); el && el !== document.documentElement; el = el.parentElement) {
    const s = getComputedStyle(el);
    const reasons = [];
    if (s.position !== 'static' && s.zIndex !== 'auto') reasons.push(`position:${s.position} z-index:${s.zIndex}`);
    if (s.position === 'fixed' || s.position === 'sticky') reasons.push(`position:${s.position}`);
    if (Number(s.opacity) < 1) reasons.push(`opacity:${s.opacity}`);
    if (s.transform !== 'none') reasons.push('transform');
    if (s.filter !== 'none') reasons.push('filter');
    if (s.isolation === 'isolate') reasons.push('isolation');
    if (s.contain !== 'none') reasons.push(`contain:${s.contain}`);
    if (s.willChange !== 'auto') reasons.push(`will-change:${s.willChange}`);
    out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} position=${s.position} z=${s.zIndex}${reasons.length ? '  <- ' + reasons.join(', ') : ''}`);
  }
  return out;
});
console.log('ancestors of #movie_player:\n  ' + stacking.join('\n  '));

// 頁面各區塊（在 ytd-app 之下、播放器容器之外）
const regions = await page.evaluate(() => {
  const describe = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return `${sel}: (none)`;
    const r = el.getBoundingClientRect();
    return `${sel}: ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} visible=${r.width > 0 && r.height > 0}`;
  };
  return [
    '#masthead-container',
    'tp-yt-app-drawer#guide',
    'ytd-mini-guide-renderer',
    'ytd-watch-flexy #secondary',
    'ytd-watch-flexy #below',
    'ytd-watch-flexy ytd-watch-metadata',
    'ytd-watch-flexy #comments',
    'ytd-watch-flexy #player-container',
    'ytd-watch-flexy #full-bleed-container',
    'ytd-watch-flexy #player-full-bleed-container',
    'ytd-watch-flexy #cinematics-container',
    'ytd-watch-flexy #cinematics',
  ].map(describe);
});
console.log('regions:\n  ' + regions.join('\n  '));
// 觀看頁主要容器的子元素（調暗區域用「容器的其他子元素」表示時，確認播放器不在其中）
const children = await page.evaluate(() =>
  ['ytd-watch-flexy', 'ytd-watch-flexy #columns', 'ytd-watch-flexy #full-bleed-container', 'ytd-watch-flexy #primary-inner', 'ytd-watch-flexy #below'].map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return `${sel}: (none)`;
    const list = [...el.children].map((c) => `${c.tagName.toLowerCase()}${c.id ? '#' + c.id : ''}${c.querySelector('#movie_player') ? '[has player]' : ''}`);
    return `${sel} > ${list.join(', ')}`;
  }),
);
console.log('container children:\n  ' + children.join('\n  '));

const toolbarButton = async (id) =>
  page.evaluate((id) => {
    const b = document.querySelector('ytm-toolbar').shadowRoot.querySelector(`.ytm-btn[data-button="${id}"]`);
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);

/** 指定位置最上層的元素屬於哪裡。 */
const hit = (x, y) =>
  page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      if (el.closest('ytm-toolbar')) return 'toolbar';
      if (el.closest('#movie_player')) return 'player';
      return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''}`;
    },
    { x, y },
  );

// 右側欄第一張看得到的縮圖實際畫出來的平均亮度（截圖後在空白頁以 canvas 計算）
const thumbRect = await page.evaluate(() => {
  const sr = document.querySelector('ytd-watch-flexy #secondary').getBoundingClientRect();
  const el = document.elementFromPoint(sr.left + sr.width / 4, sr.top + 100)?.closest('yt-thumbnail-view-model, ytd-thumbnail');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left) + 4, y: Math.round(r.top) + 4, width: Math.round(r.width) - 8, height: Math.round(r.height) - 8 };
});
const helper = await context.newPage();
await page.bringToFront();
const thumbLuminance = async () => {
  if (!thumbRect) return null;
  const png = await page.screenshot({ clip: thumbRect });
  return helper.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return Math.round((sum / (d.length / 4)) * 10) / 10;
  }, png.toString('base64'));
};
const luminanceBefore = await thumbLuminance();

await page.locator('ytm-toolbar .ytm-btn[data-button="cinema"]').click();
await page.waitForTimeout(800);
console.log('sidebar thumbnail mean luminance', JSON.stringify({ before: luminanceBefore, cinema: await thumbLuminance(), rect: thumbRect }));
const player = await page.locator('#movie_player').boundingBox();
const controls = await page.evaluate(() => {
  const el = document.querySelector('#movie_player .ytp-chrome-bottom') ?? document.querySelector('#movie_player');
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.bottom - Math.min(20, r.height / 2) };
});
const cinemaBtn = await toolbarButton('cinema');
const helpBtn = await toolbarButton('help');
const hits = {
  playerCenter: await hit(player.x + player.width / 2, player.y + player.height / 2),
  playerControls: await hit(controls.x, controls.y),
  toolbarCinema: await hit(cinemaBtn.x, cinemaBtn.y),
  toolbarHelp: await hit(helpBtn.x, helpBtn.y),
  masthead: await hit(700, 28),
  secondary: await page.evaluate(() => {
    const r = document.querySelector('ytd-watch-flexy #secondary')?.getBoundingClientRect();
    return r ? [r.left + r.width / 2, r.top + 100] : null;
  }).then((p) => (p ? hit(p[0], p[1]) : null)),
};
console.log('cinema on, elementFromPoint:', JSON.stringify(hits, null, 1));
const state = await page.evaluate(() => ({
  pressed: document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-btn[data-button="cinema"]').getAttribute('aria-pressed'),
  overlay: !!document.querySelector('.ytm-cinema-overlay'),
  htmlClass: document.documentElement.className,
}));
console.log('state', JSON.stringify(state));
// 整個畫面每 40px 取一點：不屬於播放器與工具列、實際不透明度（含祖先）仍大於 0.1 的元素
const undimmed = await page.evaluate(() => {
  const effective = (el) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.documentElement && parts.length < 8; e = e.parentElement) {
      parts.push(e.tagName.toLowerCase() + (e.id ? `#${e.id}` : ''));
    }
    return parts.reverse().join(' > ');
  };
  const found = new Map();
  for (let y = 4; y < innerHeight; y += 40) {
    for (let x = 4; x < innerWidth; x += 40) {
      const el = document.elementFromPoint(x, y);
      if (!el || el.closest('#movie_player, ytm-toolbar') || el === document.documentElement || el === document.body) continue;
      const o = effective(el);
      if (o <= 0.1) continue;
      // 本身不畫任何東西的容器（背景透明、沒有直接的文字、不是圖片或影片）不算
      const s = getComputedStyle(el);
      const paints =
        !/^rgba\(.*,\s*0\)$|^transparent$/.test(s.backgroundColor) ||
        s.backgroundImage !== 'none' ||
        [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) ||
        ['IMG', 'SVG', 'VIDEO', 'CANVAS', 'svg'].includes(el.tagName);
      if (!paints) continue;
      const key = path(el);
      if (!found.has(key)) found.set(key, { at: [x, y], opacity: Math.round(o * 100) / 100 });
    }
  }
  return [...found.entries()].map(([k, v]) => `${k}  at ${v.at} opacity ${v.opacity}`);
});
console.log(`visible elements not dimmed (outside the player and toolbar): ${undimmed.length}`);
for (const line of undimmed) console.log('  ' + line);
console.log('sidebar thumbnail mean luminance before the full screenshot', await thumbLuminance());
await page.screenshot({ path: shotPath });
console.log('screenshot', shotPath);
console.log('sidebar thumbnail mean luminance after the full screenshot', await thumbLuminance());

// 點變暗的右側欄縮圖：劇院模式關閉，不會開啟那部影片（FR-21）
if (thumbRect) {
  const urlBefore = page.url();
  await page.mouse.click(thumbRect.x + thumbRect.width / 2, thumbRect.y + thumbRect.height / 2);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    cinema: document.documentElement.classList.contains('ytm-cinema'),
    pressed: document.querySelector('ytm-toolbar')?.shadowRoot.querySelector('.ytm-btn[data-button="cinema"]').getAttribute('aria-pressed'),
  }));
  console.log('click on a dimmed sidebar thumbnail', JSON.stringify({ ...after, sameUrl: page.url() === urlBefore, url: page.url() }));
}
await context.close();
