// 本機假觀看頁測試共用的工具：啟動載入擴充功能的 Chromium、以 route 提供假頁面與測試影片。
// 瀏覽器對 www.youtube.com 的請求全部由本機檔案回應，其他網址一律拒絕，不會連外。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '..', '..');
export const extDir = join(root, '.output', 'chrome-mv3');
export const shots = process.env.SHOTS ?? join(root, 'specs', 'notes', 'screenshots');
export const EXT_ID = 'bkjlangdjfpllnkcpfpdlajchbginjdj';
export const WATCH = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
mkdirSync(shots, { recursive: true });

const fixture = readFileSync(join(here, 'fixtures', 'watch.html'), 'utf8');
// 階段 2b、2c：觀看頁的附加模擬，以及首頁、搜尋、Shorts 的假頁面。
const fixtureFile = (name) => (existsSync(join(here, 'fixtures', name)) ? readFileSync(join(here, 'fixtures', name), 'utf8') : null);
const pageFixtures = {
  home: fixtureFile('home.html'),
  search: fixtureFile('search.html'),
  shorts: fixtureFile('shorts.html'),
};
/** 依網址路徑選擇假頁面：首頁、訂閱、頻道用首頁；搜尋；Shorts；其他都是觀看頁。 */
export function fixtureFor(pathname) {
  if (pathname === '/' || pathname.startsWith('/feed/') || pathname.startsWith('/@')) return pageFixtures.home ?? fixture;
  if (pathname === '/results') return pageFixtures.search ?? fixture;
  if (pathname.startsWith('/shorts/')) return pageFixtures.shorts ?? fixture;
  return fixture;
}
const video = readFileSync(join(here, 'fixtures', 'test.webm'));
const thumb = readFileSync(join(here, 'fixtures', 'thumb.jpg'));

// 階段 4a：縮圖各尺寸（fixtures/thumbs/，以 Pillow 產生的純色圖）。依實測，不存在的尺寸回傳 404 與 120×90 的預設圖
// （spikes/stage4a/results-thumbnails.txt）；bbbbbbbbbbb 的 maxresdefault 模擬「200 但內容是預設圖」。
const thumbImage = (name) => readFileSync(join(here, 'fixtures', 'thumbs', name));
const THUMB_FILES = { maxresdefault: '1280x720.jpg', sddefault: '640x480.jpg', hqdefault: '480x360.jpg', mqdefault: '320x180.jpg' };
const THUMB_MISSING = {
  jNQXAC9IVRw: { maxresdefault: 404, sddefault: 404 },
  bbbbbbbbbbb: { maxresdefault: 200 },
};
export const thumbnailRequests = [];
function thumbnailResponse(id, key) {
  thumbnailRequests.push(`${id}/${key}`);
  const missing = THUMB_MISSING[id]?.[key];
  if (missing) return { status: missing, contentType: 'image/jpeg', body: thumbImage('placeholder-120x90.jpg') };
  return { status: 200, contentType: 'image/jpeg', body: thumbImage(THUMB_FILES[key]) };
}

// 階段 4a：字幕（/api/timedtext）。lang、kind=asr 決定內容；fail=1 回傳空白（模擬直接下載失敗）；
// xml=1 不論 fmt 都回傳 YouTube 的 XML 格式。自動字幕依 YouTube 的捲動格式（含只有空白的行與逐字時間標籤）。
export const captionRequests = [];
const CAPTION_TEXT = {
  en: ['Hello & welcome to the fixture', 'This is the second line'],
  'zh-TW': ['你好，歡迎', '這是第二行字幕'],
  ja: ['こんにちは', '二行目です'],
};
function captionResponse(url) {
  captionRequests.push(url.search);
  const p = url.searchParams;
  if (p.get('fail') === '1') return { status: 200, contentType: 'text/html', body: '' };
  if (p.get('xml') === '1') {
    const body = '<?xml version="1.0" encoding="utf-8" ?><transcript><text start="1.5" dur="2">It&amp;#39;s XML &amp;amp; fine</text><text start="62.25" dur="2.75">Second XML line</text></transcript>';
    return { status: 200, contentType: 'text/xml', body };
  }
  if (p.get('fmt') !== 'vtt') return { status: 200, contentType: 'text/xml', body: '<transcript></transcript>' };
  if (p.get('kind') === 'asr') {
    const body = [
      'WEBVTT', 'Kind: captions', 'Language: en', '',
      '00:00:00.320 --> 00:00:02.750 align:start position:0%', ' ', 'so<00:00:00.640><c> today</c><00:00:00.960><c> we</c>', '',
      '00:00:02.750 --> 00:00:02.760 align:start position:0%', 'so today we', ' ', '',
      '00:00:02.760 --> 00:00:05.110 align:start position:0%', 'so today we', 'are<00:00:03.100><c> testing</c>', '',
      '00:00:05.110 --> 00:00:05.120 align:start position:0%', 'are testing', ' ', '',
    ].join('\n');
    return { status: 200, contentType: 'text/vtt', body };
  }
  const [a, b] = CAPTION_TEXT[p.get('lang')] ?? ['?', '?'];
  const body = `WEBVTT\nKind: captions\nLanguage: ${p.get('lang')}\n\n00:00:01.000 --> 00:00:04.500\n${a.replace('&', '&amp;')}\n\n00:01:02.250 --> 00:01:05.000\n${b}\n`;
  return { status: 200, contentType: 'text/vtt; charset=utf-8', body };
}

/**
 * 啟動載入擴充功能的 Chromium。階段 4 另外可以指定：
 * - profile：設定檔資料夾（預設在 .cache/ 下依 name、lang 命名）；keepProfile 為 true 時沿用（模擬重新啟動瀏覽器）；
 * - nativeHost：橋接程式執行檔的路徑，寫入設定檔資料夾中的 NativeMessagingHosts/（Chromium 以 --user-data-dir 時從這裡讀取）；
 * - env：瀏覽器的環境變數（橋接程式會繼承，例如 HOME、PATH）。
 */
export async function launch({ lang = 'en-US', name = 'fixture', viewport, colorScheme, downloadDir, userAgent, profile, keepProfile = false, nativeHost, env, uiLanguage } = {}) {
  viewport ??= { width: 1280, height: 900 };
  profile ??= join(here, '.cache', `profile-${name}-${lang}`);
  if (!keepProfile) rmSync(profile, { recursive: true, force: true });
  if (nativeHost) {
    mkdirSync(join(profile, 'NativeMessagingHosts'), { recursive: true });
    writeFileSync(
      join(profile, 'NativeMessagingHosts', 'com.chidi0716.yt_toolbar_master.json'),
      JSON.stringify({
        name: 'com.chidi0716.yt_toolbar_master',
        description: 'yt-toolbar-master helper (test)',
        path: nativeHost,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXT_ID}/`],
      }),
    );
  }
  if (downloadDir && !keepProfile) {
    // 下載資料夾設在工作目錄內（瀏覽器設定檔的偏好）；測試再以 CDP 把下載行為改回瀏覽器預設，
    // 讓擴充功能以 downloads API 指定的檔名存檔。
    mkdirSync(join(profile, 'Default'), { recursive: true });
    writeFileSync(
      join(profile, 'Default', 'Preferences'),
      JSON.stringify({ download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true } }),
    );
  }
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    // HEADED=1 時以有視窗的模式執行（搭配 xvfb-run），切換分頁才會改變 document.visibilityState。
    headless: !process.env.HEADED,
    locale: lang,
    viewport,
    ...(colorScheme ? { colorScheme } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(env ? { env } : {}),
    args: [
      `--lang=${lang}`,
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      // 讓測試影片可以在沒有使用者操作時播放。
      '--autoplay-policy=no-user-gesture-required',
      // 沒有被 route 處理的請求（例如擴充功能背景腳本的請求未被攔截時）一律無法解析網域，確保不會連外。
      '--host-resolver-rules=MAP * ~NOTFOUND',
    ],
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.hostname === 'www.youtube.com' && url.pathname === '/__fixture/test.webm') {
      // 支援 Range 請求，瀏覽器才能跳轉到還沒下載的位置。
      const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers()['range'] ?? '');
      if (!range) {
        return route.fulfill({
          status: 200,
          contentType: 'video/webm',
          headers: { 'Accept-Ranges': 'bytes' },
          body: video,
        });
      }
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
      return route.fulfill({
        status: 206,
        contentType: 'video/webm',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${video.length}` },
        body: video.subarray(start, end + 1),
      });
    }
    // 假頁面共用的腳本（fixtures/*.js）
    const script = /^\/__fixture\/([a-z0-9-]+\.js)$/.exec(url.pathname);
    if (url.hostname === 'www.youtube.com' && script && fixtureFile(script[1]) !== null) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: fixtureFile(script[1]) });
    }
    if (url.hostname === 'www.youtube.com' && url.pathname === '/api/timedtext') {
      return route.fulfill(captionResponse(url));
    }
    if (url.hostname === 'www.youtube.com') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixtureFor(url.pathname) });
    }
    // 縮圖各尺寸（階段 4a）
    const sized = /^\/vi\/([A-Za-z0-9_-]{11})\/(maxresdefault|sddefault|hqdefault|mqdefault)\.jpg$/.exec(url.pathname);
    if (url.hostname === 'i.ytimg.com' && sized && (THUMB_MISSING[sized[1]] || ['aaaaaaaaaaa', 'ccccccccccc'].includes(sized[1]))) {
      return route.fulfill(thumbnailResponse(sized[1], sized[2]));
    }
    // 純音訊模式的縮圖：以測試影片的一格畫面代替。
    if (url.hostname === 'i.ytimg.com' && /^\/vi\/[A-Za-z0-9_-]{11}\/(?:hq|mq)default\.jpg$/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: thumb });
    }
    return route.abort();
  });
  // 介面語言（007）：明確設定，不依賴「跟隨瀏覽器」。預設依瀏覽器語言選繁體中文或英文；'auto' 時不設定。
  const ui = uiLanguage ?? (lang.startsWith('zh') ? 'zh_TW' : 'en');
  if (ui !== 'auto' && !keepProfile) await setUiLanguage(context, ui);
  return context;
}

/** 擴充功能的背景腳本（service worker）。 */
export async function extensionWorker(context) {
  return (
    context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`)) ??
    (await context.waitForEvent('serviceworker', { timeout: 10_000 }))
  );
}

/** 設定介面語言（sync:uiLanguage）：'auto'、'zh_TW' 或 'en'。 */
export async function setUiLanguage(context, value) {
  // service worker 剛啟動時 chrome.storage 可能還沒準備好：稍候再試。
  for (let i = 0; ; i++) {
    const sw = await extensionWorker(context);
    const ok = await sw
      .evaluate((v) => (globalThis.chrome?.storage?.sync ? chrome.storage.sync.set({ uiLanguage: v }).then(() => true) : false), value)
      .catch(() => false);
    if (ok) return;
    if (i >= 50) throw new Error('setUiLanguage: extension storage not available');
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function reporter() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  /** 本環境無法驗證的項目：列出但不算通過或失敗。 */
  const skip = (name, detail = '') => {
    console.log(`SKIP  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const summary = () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    return failed.length === 0;
  };
  return { check, skip, summary, results };
}

/** 等工具列出現並把它與 toolbar 內的按鈕準備好。 */
export async function openWatch(page, url = WATCH) {
  await page.goto(url);
  await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 10_000 });
}

export const button = (page, id) => page.locator(`ytm-toolbar .ytm-btn[data-button="${id}"]`);

export async function pressed(page, id) {
  return page.evaluate((id) => {
    const b = document.querySelector('ytm-toolbar').shadowRoot.querySelector(`.ytm-btn[data-button="${id}"]`);
    return { pressed: b.getAttribute('aria-pressed'), on: b.hasAttribute('data-on'), disabled: b.getAttribute('aria-disabled') };
  }, id);
}

/** 截圖：裁到指定的視窗區域（預設為播放器到工具列下方）。 */
export async function shot(page, name, clip) {
  const area =
    clip ??
    (await page.evaluate(() => {
      const p = document.querySelector('#player').getBoundingClientRect();
      const t = document.querySelector('ytm-toolbar')?.getBoundingClientRect() ?? p;
      const panel = document.querySelector('ytm-toolbar')?.shadowRoot.querySelector('.ytm-panel')?.getBoundingClientRect();
      const top = Math.max(0, Math.min(p.top, t.top) - 16);
      const bottom = Math.max(p.bottom, t.bottom + 40, panel ? panel.bottom + 16 : 0);
      return { x: 0, y: top, width: Math.ceil(Math.max(p.right, t.right) + 24), height: Math.ceil(Math.min(window.innerHeight, bottom) - top) };
    }));
  await page.screenshot({ path: join(shots, name), clip: area });
}

export const viewportShot = (page, name) => page.screenshot({ path: join(shots, name) });

export async function spaNavigate(page, linkId = 'next') {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(`#${linkId}`).click();
  await page.waitForTimeout(400);
}
