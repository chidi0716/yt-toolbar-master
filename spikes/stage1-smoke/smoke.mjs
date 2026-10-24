// 階段 1 煙霧測試：以 Playwright 的 Chromium 載入 .output/chrome-mv3，打開 YouTube 影片頁，
// 逐項檢查 001 中能在本環境自動驗證的驗收條件，並截圖。
//
// 這不是正式的測試套件，需要先另外安裝（不寫入 package.json）：
//   npm install --no-save playwright-core@1.56.1
//   npm run build
//   node spikes/stage1-smoke/smoke.mjs
//
// 環境變數：
//   CHROMIUM    Chromium 執行檔（預設 /opt/pw-browsers/chromium-1194/chrome-linux/chrome）
//   HTTPS_PROXY 若有設定，Chromium 會經由這個 proxy 連線
//   SHOTS       截圖資料夾（預設 specs/notes/screenshots）
//   ONLY        只跑名稱包含這個字串的檢查
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const extDir = join(root, '.output', 'chrome-mv3');
const profile = join(here, '.cache', 'profile');
const shots = process.env.SHOTS ?? join(root, 'specs', 'notes', 'screenshots');
const WATCH = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const EXT_ID = 'bkjlangdjfpllnkcpfpdlajchbginjdj';

rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
mkdirSync(shots, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  locale: 'en-US',
  viewport: { width: 1400, height: 1000 },
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
// 截圖只取工具列附近（播放器下緣到面板下方），避免收進不相關的推薦影片。
const shot = async (page, name, { wide = false } = {}) => {
  const clip = await page.evaluate((wide) => {
    const host = document.querySelector('ytm-toolbar');
    const player = document.querySelector('#movie_player');
    if (!host || !player) return null;
    const t = host.getBoundingClientRect();
    const p = player.getBoundingClientRect();
    const y = Math.max(0, t.top - 140);
    return { x: 0, y, width: wide ? window.innerWidth : Math.min(window.innerWidth, Math.ceil(p.right + 16)), height: Math.min(window.innerHeight - y, 480) };
  }, wide);
  await page.screenshot({ path: join(shots, name), ...(clip ? { clip } : {}) });
};

const page = context.pages()[0] ?? (await context.newPage());
page.on('console', (msg) => {
  if (msg.text().includes('[yt-toolbar-master]')) console.log('  console:', msg.text());
});
page.on('pageerror', (err) => console.log('  pageerror:', String(err).slice(0, 200)));

// ---- 在頁面中讀取工具列狀態的小工具 ----
const state = () =>
  page.evaluate(() => {
    const hosts = document.querySelectorAll('ytm-toolbar');
    const host = hosts[0];
    const root = host?.shadowRoot;
    const buttons = root ? [...root.querySelectorAll('.ytm-btn')] : [];
    const panel = root?.querySelector('.ytm-panel');
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), width: Math.round(r.width) };
    };
    const player = document.querySelector('#movie_player');
    const active = root?.activeElement;
    return {
      count: hosts.length,
      hidden: host ? host.hidden || getComputedStyle(host).display === 'none' : null,
      labels: buttons.map((b) => b.getAttribute('aria-label')),
      ids: buttons.map((b) => b.dataset.button),
      expanded: buttons.filter((b) => b.getAttribute('aria-expanded') === 'true').map((b) => b.dataset.button),
      panel: panel
        ? { id: panel.id, rect: rect(panel), pinned: panel.hasAttribute('data-pinned'), visible: getComputedStyle(panel).visibility }
        : null,
      buttonRects: Object.fromEntries(buttons.map((b) => [b.dataset.button, rect(b)])),
      toolbar: rect(root?.querySelector('.ytm-toolbar')),
      player: rect(player),
      metadataTop: rect(document.querySelector('ytd-watch-metadata'))?.top ?? null,
      focused: active?.dataset?.button ?? active?.className ?? null,
      url: location.href,
    };
  });

// Playwright 的 CSS 選擇器會穿透開放的 Shadow DOM，並在點擊前確認元素穩定、沒有被遮住。
const clickButton = (id) => page.locator(`ytm-toolbar .ytm-btn[data-button="${id}"]`).click();
const clickInPanel = (selector) => page.locator(`ytm-toolbar .ytm-panel ${selector}`).click();

const waitToolbar = async (present = true, timeout = 15_000) => {
  try {
    await page.waitForFunction((p) => !!document.querySelector('ytm-toolbar') === p, present, { timeout });
    return true;
  } catch {
    return false;
  }
};

const clickOutside = async () => {
  const box = await page.locator('ytd-watch-metadata #title').first().boundingBox();
  await page.mouse.click(box.x + 5, box.y + box.height / 2);
};

const spaNavigateToRelated = async () => {
  const before = page.url();
  // 側欄中看得見、且不是目前影片的影片連結（YouTube 內部換頁，不重新載入）。點縮圖區域，
  // 點不到就換下一個候選。
  for (let attempt = 0; attempt < 4; attempt++) {
    const point = await page.evaluate((skip) => {
      const current = new URL(location.href).searchParams.get('v');
      const links = [...document.querySelectorAll('#secondary a[href^="/watch?v="]')].filter((a) => {
        const v = new URL(a.href).searchParams.get('v');
        const r = a.getBoundingClientRect();
        return v && v !== current && !a.href.includes('list=') && r.width > 60 && r.height > 40;
      });
      const a = links[skip];
      if (!a) return null;
      a.scrollIntoView({ block: 'center' });
      const r = a.getBoundingClientRect();
      return { x: r.left + Math.min(40, r.width / 2), y: r.top + Math.min(40, r.height / 2) };
    }, attempt);
    if (!point) break;
    await page.mouse.click(point.x, point.y);
    try {
      await page.waitForFunction((u) => location.href !== u && location.pathname === '/watch', before, { timeout: 8_000 });
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.scrollTo(0, 0));
      return;
    } catch {
      await page.keyboard.press('Escape');
    }
  }
  throw new Error('could not navigate to a related video');
};

try {
  // ---------- 影片頁：位置、順序 ----------
  const t0 = Date.now();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('ytd-watch-metadata', { timeout: 30_000 });
  const tMeta = Date.now();
  const appeared = await waitToolbar(true, 15_000);
  const tBar = Date.now();
  check('影片頁出現工具列', appeared, `goto→metadata ${tMeta - t0}ms, metadata→toolbar ${tBar - tMeta}ms`);
  await page.waitForTimeout(1500);
  let s = await state();
  check('只有一條工具列', s.count === 1, `count=${s.count}`);
  check(
    '工具列在播放器與標題之間',
    s.toolbar && s.player && s.toolbar.top >= s.player.top && s.metadataTop !== null && s.toolbar.top < s.metadataTop,
    `player.top=${s.player?.top} toolbar.top=${s.toolbar?.top} title.top=${s.metadataTop}`,
  );
  check('工具列寬度與播放器相同', s.toolbar && s.player && Math.abs(s.toolbar.width - s.player.width) <= 1, `toolbar=${s.toolbar?.width} player=${s.player?.width}`);
  const expectedOrder = ['video', 'mp3', 'thumbnail', 'subtitles', 'screenshot', 'darkMode', 'cinema', 'pip', 'floating', 'loop', 'more', 'help', 'close'];
  check('按鈕順序正確', JSON.stringify(s.ids) === JSON.stringify(expectedOrder), s.labels.join(', '));
  check('每顆按鈕都有無障礙標籤', s.labels.every((l) => l && l.length > 0));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'T03-toolbar-light.png');

  // ---------- 面板：單一、Esc、點外面、焦點 ----------
  await clickButton('video');
  await page.waitForTimeout(400);
  s = await state();
  check('點按鈕展開面板', s.panel?.id === 'ytm-panel-video' && s.expanded.join() === 'video');
  check('面板左緣對齊按鈕', s.panel && Math.abs(s.panel.rect.left - s.buttonRects.video.left) <= 1, `panel=${s.panel?.rect.left} button=${s.buttonRects.video.left}`);
  check('展開後焦點在面板內', s.focused === 'ytm-icon-btn', `focused=${s.focused}`);
  await shot(page, 'T03-panel-video.png');

  await clickButton('mp3');
  await page.waitForTimeout(300);
  s = await state();
  check('一次只有一個面板', s.panel?.id === 'ytm-panel-mp3' && s.expanded.join() === 'mp3', `expanded=${s.expanded}`);

  await clickButton('mp3');
  await page.waitForTimeout(300);
  s = await state();
  check('再點一次按鈕收起', s.panel === null && s.focused === 'mp3', `focused=${s.focused}`);

  await clickButton('mp3');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  s = await state();
  check('Esc 收起且焦點回到按鈕', s.panel === null && s.focused === 'mp3', `focused=${s.focused}`);

  await clickButton('loop');
  await page.waitForTimeout(300);
  await clickOutside();
  await page.waitForTimeout(300);
  s = await state();
  check('點外面收起', s.panel === null);

  // 右側按鈕：超出播放器右緣時改成右緣對齊
  await clickButton('help');
  await page.waitForTimeout(400);
  s = await state();
  const helpRight = s.buttonRects.help.right;
  check(
    '靠右的面板改成右緣對齊按鈕且不超出播放器',
    s.panel && Math.abs(s.panel.rect.right - helpRight) <= 1 && s.panel.rect.right <= s.player.right + 1,
    `panel.right=${s.panel?.rect.right} button.right=${helpRight} player.right=${s.player.right}`,
  );
  await shot(page, 'T03-panel-help-right-aligned.png');
  await page.keyboard.press('Escape');

  // ---------- 釘選 ----------
  await clickButton('loop');
  await page.waitForTimeout(300);
  await clickInPanel('.ytm-panel-header .ytm-icon-btn');
  await page.waitForTimeout(200);
  await clickOutside();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  s = await state();
  check('釘選後點外面、按 Esc 都不收起', s.panel?.id === 'ytm-panel-loop' && s.panel.pinned);
  await shot(page, 'T03-panel-pinned.png');

  await spaNavigateToRelated();
  s = await state();
  check('換頁後釘選的面板仍展開、工具列只有一條', s.count === 1 && s.panel?.id === 'ytm-panel-loop' && s.panel.pinned, `url=${s.url}`);

  await clickInPanel('.ytm-panel-header .ytm-icon-btn');
  await page.waitForTimeout(300);
  s = await state();
  check('按取消釘選後收起', s.panel === null, JSON.stringify(s.panel));

  // ---------- 連續換頁 5 次 ----------
  let navOk = true;
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    await clickButton('thumbnail');
    await page.waitForTimeout(200);
    await spaNavigateToRelated();
    const st = await state();
    seen.add(new URL(st.url).searchParams.get('v'));
    if (st.count !== 1) navOk = false;
    if (st.panel !== null) navOk = false; // 未釘選的面板換頁後收起
  }
  check('連續換頁 5 次，工具列始終只有一條', navOk && seen.size === 5, `videos=${[...seen].join(',')}`);

  // ---------- 鍵盤 ----------
  await page.evaluate(() => document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-btn').focus());
  await page.keyboard.press('Tab');
  s = await state();
  const tabOk = s.focused === 'mp3';
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  s = await state();
  const enterOk = s.panel?.id === 'ytm-panel-mp3' && s.focused === 'ytm-icon-btn';
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  s = await state();
  const backOk = s.panel === null && s.focused === 'mp3';
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  s = await state();
  const spaceOk = s.panel?.id === 'ytm-panel-mp3';
  await page.keyboard.press('Escape');
  check('鍵盤：Tab 移動、Enter／空白鍵展開、焦點進出面板', tabOk && enterOk && backOk && spaceOk, `tab=${tabOk} enter=${enterOk} back=${backOk} space=${spaceOk}`);

  // ---------- 劇院模式寬度 ----------
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('ytd-watch-metadata #title').first().click();
  await page.keyboard.press('t');
  await page.waitForTimeout(1500);
  s = await state();
  const theater = await page.evaluate(() => document.querySelector('ytd-watch-flexy')?.hasAttribute('theater'));
  check('YouTube 劇院模式下工具列仍在', theater && s.count === 1 && !s.hidden, `theater=${theater} toolbar.width=${s.toolbar?.width} player.width=${s.player?.width}`);
  await shot(page, 'T03-youtube-theater.png', { wide: true });
  await page.keyboard.press('t');
  await page.waitForTimeout(1000);

  // ---------- 全螢幕 ----------
  await page.locator('#movie_player').click({ position: { x: 20, y: 20 } }).catch(() => {});
  const fs = await page.evaluate(async () => {
    try {
      await document.querySelector('#movie_player').requestFullscreen();
      await new Promise((r) => setTimeout(r, 500));
      const host = document.querySelector('ytm-toolbar');
      const hiddenInFs = !!document.fullscreenElement && (host.hidden || getComputedStyle(host).display === 'none');
      await document.exitFullscreen();
      await new Promise((r) => setTimeout(r, 500));
      return { hiddenInFs, shownAfter: !host.hidden };
    } catch (e) {
      return { error: String(e) };
    }
  });
  check('全螢幕時工具列不顯示', fs.hiddenInFs === true && fs.shownAfter === true, JSON.stringify(fs));

  // ---------- 其他頁面不出現 ----------
  await page.locator('ytd-topbar-logo-renderer a, a#logo').first().click();
  await page.waitForFunction(() => location.pathname === '/', null, { timeout: 15_000 });
  const goneOnHome = await waitToolbar(false, 5000);
  check('在 YouTube 內換到首頁時工具列移除', goneOnHome);
  for (const [name, url] of [
    ['首頁', 'https://www.youtube.com/'],
    ['搜尋頁', 'https://www.youtube.com/results?search_query=zoo'],
    ['Shorts', 'https://www.youtube.com/shorts'],
  ]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const st = await state();
    check(`${name}沒有工具列`, st.count === 0 && (name !== 'Shorts' || new URL(st.url).pathname.startsWith('/shorts/')), `url=${st.url}`);
  }

  // ---------- 深色主題 ----------
  await context.addCookies([{ name: 'PREF', value: 'f6=400', domain: '.youtube.com', path: '/' }]);
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitToolbar(true, 20_000);
  await page.waitForTimeout(2000);
  const colors = await page.evaluate(() => {
    const root = document.querySelector('ytm-toolbar').shadowRoot;
    return {
      dark: document.documentElement.hasAttribute('dark'),
      icon: getComputedStyle(root.querySelector('.ytm-btn')).color,
    };
  });
  await clickButton('video');
  await page.waitForTimeout(400);
  const panelBg = await page.evaluate(() => getComputedStyle(document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-panel')).backgroundColor);
  check('深色主題時顏色跟著變', colors.dark && colors.icon === 'rgb(241, 241, 241)' && panelBg === 'rgb(40, 40, 40)', `${JSON.stringify(colors)} panel=${panelBg}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'T03-panel-video-dark.png');
  await page.keyboard.press('Escape');

  // ---------- T05 說明面板 ----------
  await clickButton('help');
  await page.waitForTimeout(400);
  const help = await page.evaluate(() => {
    const root = document.querySelector('ytm-toolbar').shadowRoot;
    return {
      items: [...root.querySelectorAll('.ytm-help-item')].map((li) => ({
        id: li.dataset.button,
        name: li.querySelector('.ytm-help-name')?.textContent,
        desc: li.querySelector('.ytm-help-desc')?.textContent,
        icon: !!li.querySelector('svg path'),
      })),
      labels: [...root.querySelectorAll('.ytm-btn')].map((b) => b.getAttribute('aria-label')),
      link: root.querySelector('.ytm-help .ytm-link')?.textContent,
    };
  });
  check(
    '說明面板列出全部按鈕的圖示、名稱與說明',
    help.items.length === 14 &&
      help.items.every((i, n) => i.icon && i.name === help.labels[n] && i.desc && i.desc.length > 5),
    `${help.items.length} items`,
  );
  await shot(page, 'T05-help-panel-dark.png');
  const optionsPage = context.waitForEvent('page', { timeout: 10_000 });
  await clickInPanel('.ytm-link');
  const opened = await optionsPage.catch(() => null);
  if (opened) await opened.waitForLoadState();
  check('說明面板的連結開啟設定頁', opened?.url() === `chrome-extension://${EXT_ID}/options.html`, opened?.url());
  await opened?.close();
  await page.bringToFront();
  await page.keyboard.press('Escape');

  // ---------- T05 ✕ 與彈出視窗 ----------
  await clickButton('close');
  const closedNow = await waitToolbar(false, 5000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('ytd-watch-metadata', { timeout: 30_000 });
  await page.waitForTimeout(4000);
  const stillClosed = (await state()).count === 0;
  check('按 ✕ 後工具列隱藏，重新整理後仍隱藏', closedNow && stillClosed);

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 320, height: 160 });
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  const checkbox = popup.locator('#enabled');
  await popup.waitForFunction(() => !!document.querySelector('h1')?.textContent);
  await popup.waitForTimeout(300);
  const uncheckedInPopup = !(await checkbox.isChecked());
  await popup.screenshot({ path: join(shots, 'T05-popup-disabled.png') });
  await checkbox.check();
  await page.bringToFront();
  const back = await waitToolbar(true, 10_000);
  check('彈出視窗的「啟用」與 ✕ 連動，打開後工具列重新出現', uncheckedInPopup && back, `popupUnchecked=${uncheckedInPopup} back=${back}`);
  await popup.close();
} catch (err) {
  check('smoke script', false, String(err).split('\n')[0]);
  await shot(page, 'smoke-error.png').catch(() => {});
} finally {
  await context.close();
}

// ---------- 繁體中文介面（NFR-4） ----------
{
  const zhProfile = join(here, '.cache', 'profile-zh');
  rmSync(zhProfile, { recursive: true, force: true });
  const zh = await chromium.launchPersistentContext(zhProfile, {
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    locale: 'zh-TW',
    viewport: { width: 1400, height: 1000 },
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: ['--lang=zh-TW', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const zp = zh.pages()[0] ?? (await zh.newPage());
  try {
    await zp.goto(WATCH, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await zp.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 30_000 });
    await zp.waitForTimeout(1500);
    await zp.locator('ytm-toolbar .ytm-btn[data-button="help"]').click();
    await zp.waitForTimeout(400);
    const labels = await zp.evaluate(() =>
      [...document.querySelector('ytm-toolbar').shadowRoot.querySelectorAll('.ytm-btn')].map((b) => b.getAttribute('aria-label')),
    );
    check('繁體中文介面', labels[0] === '影片' && labels[12] === '關閉', labels.join('、'));
    await shot(zp, 'T05-help-panel-zh-TW.png');
    const popup = await zh.newPage();
    await popup.setViewportSize({ width: 320, height: 160 });
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await popup.waitForFunction(() => !!document.querySelector('h1')?.textContent);
    const text = await popup.locator('main').innerText();
    check('彈出視窗的繁體中文文字', text.includes('啟用'), text.replace(/\s+/g, ' '));
    await popup.screenshot({ path: join(shots, 'T05-popup-zh-TW.png') });
  } catch (err) {
    check('zh-TW smoke', false, String(err).split('\n')[0]);
  } finally {
    await zh.close();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
