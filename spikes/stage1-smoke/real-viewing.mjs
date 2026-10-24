// 階段 2：在真實的 YouTube 觀看頁上檢查觀看輔助功能能否套用到實際的頁面結構（只載入一次頁面）。
// YouTube 顯示驗證頁時直接結束，不嘗試繞過。
//   npm install --no-save playwright-core@1.56.1 && npm run build
//   node spikes/stage1-smoke/real-viewing.mjs
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { reporter } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const extDir = join(root, '.output', 'chrome-mv3');
const shots = process.env.SHOTS ?? join(root, 'specs', 'notes', 'screenshots');
const profile = join(here, '.cache', 'profile-real-viewing');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const { check, skip, summary } = reporter();
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  locale: 'en-US',
  viewport: { width: 1400, height: 1000 },
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const page = context.pages()[0] ?? (await context.newPage());
const button = (id) => page.locator(`ytm-toolbar .ytm-btn[data-button="${id}"]`);
const pressedOf = (id) => button(id).getAttribute('aria-pressed');

try {
  await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (new URL(page.url()).hostname !== 'www.youtube.com' || (await page.locator('ytd-watch-flexy').count()) === 0) {
    console.log('YouTube showed a verification page; stopping without retrying.', page.url());
    process.exit(2);
  }
  await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(2000);
  const playerState = await page.evaluate(() => {
    const v = document.querySelector('#movie_player video');
    return { hasVideo: !!v, duration: v?.duration ?? null, src: !!v?.currentSrc };
  });
  console.log('player', JSON.stringify(playerState));

  // ---- 深色模式（T06a：改寫 PREF 後重新載入）----
  const darkBefore = await page.evaluate(() => document.documentElement.hasAttribute('dark'));
  const reloaded = page.waitForEvent('load', { timeout: 30_000 });
  await button('darkMode').click();
  await reloaded;
  await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(1500);
  const dark = {
    attr: await page.evaluate(() => document.documentElement.hasAttribute('dark')),
    pref: (await context.cookies('https://www.youtube.com/')).find((c) => c.name === 'PREF')?.value ?? null,
    pressed: await pressedOf('darkMode'),
    url: page.url(),
  };
  check('真實 YouTube：深色模式改寫 YouTube 的主題偏好並重新載入（T06a）', dark.attr === !darkBefore && dark.pressed === String(!darkBefore), JSON.stringify(dark));
  await page.screenshot({ path: join(shots, 'T06a-real-dark-mode.png'), clip: { x: 0, y: 0, width: 1000, height: 760 } });

  // ---- 劇院模式 ----
  await button('cinema').click();
  await page.waitForTimeout(500);
  const hits = await page.evaluate(() => {
    const at = (el, fx = 0.5, fy = 0.5) => {
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width * fx, r.top + Math.min(r.height * fy, 20));
      if (!top) return null;
      if (top.closest('ytm-toolbar')) return 'toolbar';
      if (top.classList.contains('ytm-cinema-overlay')) return 'overlay';
      if (top.closest('#movie_player')) return 'player';
      return top.tagName.toLowerCase();
    };
    return {
      player: at(document.querySelector('#movie_player')),
      toolbar: at(document.querySelector('ytm-toolbar'), 0.02),
      title: at(document.querySelector('ytd-watch-metadata #title'), 0.1),
      masthead: at(document.querySelector('#masthead-container'), 0.3),
      secondary: at(document.querySelector('#secondary'), 0.5, 0.05),
    };
  });
  check(
    '真實 YouTube：劇院模式只露出播放器與工具列（T07）',
    hits.player === 'player' && hits.toolbar === 'toolbar' && hits.title === 'overlay' && hits.masthead === 'overlay' && hits.secondary === 'overlay',
    JSON.stringify(hits),
  );
  await page.screenshot({ path: join(shots, 'T07-real-cinema.png'), clip: { x: 0, y: 0, width: 1400, height: 760 } });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('真實 YouTube：Esc 關閉劇院模式', (await page.locator('.ytm-cinema-overlay').count()) === 0 && (await pressedOf('cinema')) === 'false');

  // ---- 浮動播放器 ----
  await button('floating').click();
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(1200);
  const floating = await page.evaluate(() => {
    const c = document.querySelector('ytd-watch-flexy #player-container');
    const r = c?.getBoundingClientRect();
    const v = document.querySelector('#movie_player video')?.getBoundingClientRect();
    return c
      ? {
          floating: c.classList.contains('ytm-floating'),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          video: v ? [Math.round(v.width), Math.round(v.height)] : null,
          vw: document.documentElement.clientWidth,
          vh: window.innerHeight,
        }
      : null;
  });
  check(
    '真實 YouTube：捲出畫面時播放器浮動在右下角（T08）',
    floating?.floating && Math.abs(floating.rect[0] + floating.rect[2] - (floating.vw - 16)) <= 1,
    JSON.stringify(floating),
  );
  await page.screenshot({ path: join(shots, 'T08-real-floating.png') });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  check('真實 YouTube：捲回原位時恢復', !(await page.evaluate(() => document.querySelector('ytd-watch-flexy #player-container')?.classList.contains('ytm-floating'))));
  await button('floating').click();

  // ---- 更多選單 ----
  await button('more').click();
  await page.waitForTimeout(400);
  const autoplay = await page.evaluate(() => {
    const row = document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-more-item[data-item="autoplay"]');
    return { disabled: row?.hasAttribute('data-disabled'), checked: row?.querySelector('[role="switch"]')?.getAttribute('aria-checked') };
  });
  const ytToggle = await page.evaluate(() => document.querySelector('#movie_player .ytp-autonav-toggle-button')?.getAttribute('aria-checked') ?? null);
  if (ytToggle === null) skip('真實 YouTube：自動播放開關與 YouTube 同步（T10）', '這個頁面沒有 YouTube 的自動播放開關（未登入或影片無法播放）');
  else check('真實 YouTube：自動播放開關與 YouTube 同步（T10）', !autoplay.disabled && autoplay.checked === ytToggle, `${JSON.stringify(autoplay)} yt=${ytToggle}`);
  await page.locator('ytm-toolbar .ytm-more-item[data-item="hideComments"] [role="switch"]').click();
  await page.waitForTimeout(300);
  const comments = await page.evaluate(() => {
    const c = document.querySelector('ytd-watch-flexy #comments');
    return c ? getComputedStyle(c).display : 'missing';
  });
  check('真實 YouTube：隱藏留言（T10）', comments === 'none', comments);
  await page.screenshot({ path: join(shots, 'T10-real-more-panel.png'), clip: { x: 0, y: 0, width: 1000, height: 1000 } });
  await page.locator('ytm-toolbar .ytm-more-item[data-item="hideComments"] [role="switch"]').click();
} catch (err) {
  check('real viewing script', false, String(err).split('\n')[0]);
} finally {
  await context.close();
}
if (!summary()) process.exitCode = 1;
