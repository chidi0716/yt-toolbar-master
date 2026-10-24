// 階段 4a（002：縮圖、截圖、字幕直接下載、影片／MP3 面板的未連線狀態）在本機假觀看頁上的驗收檢查與截圖。
// 縮圖各尺寸與字幕檔由 lib.mjs 的 route 回應（不連外）；下載的檔案存到 .cache/downloads-<任務>/，
// 以瀏覽器設定檔的偏好指定，並以 Chrome DevTools Protocol 把 Playwright 的下載攔截改回瀏覽器預設，
// 讓檔名維持擴充功能以 downloads API 指定的名稱。
//   npm install --no-save playwright-core@1.56.1 && npm run build
//   PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node spikes/stage1-smoke/downloads-test.mjs
//   ONLY=T17 … # 只跑某個任務
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EXT_ID, WATCH, button, captionRequests, extensionWorker, launch, openWatch, reporter, root, shot, spaNavigate, thumbnailRequests } from './lib.mjs';

const { check, skip, summary } = reporter();
const only = process.env.ONLY;
const want = (task) => !only || only.split(',').includes(task);
if (!process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS) {
  console.log('請以 PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 執行：背景腳本（service worker）的請求才會由假頁面回應。');
  process.exit(2);
}

async function section(task, fn, options = {}) {
  if (!want(task)) return;
  console.log(`\n== ${task}`);
  const downloads = join(root, 'spikes', 'stage1-smoke', '.cache', `downloads-${task}`);
  rmSync(downloads, { recursive: true, force: true });
  mkdirSync(downloads, { recursive: true });
  const context = await launch({
    name: `dl-${task}`,
    lang: options.lang,
    viewport: options.viewport ?? { width: 1280, height: 1000 },
    downloadDir: downloads,
    userAgent: options.userAgent,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (err) => console.log('  pageerror:', String(err).slice(0, 200)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
  try {
    if (options.open !== false) await openWatch(page, options.url ?? WATCH);
    await fn(page, context, downloads);
  } catch (err) {
    check(`${task} script`, false, String(err).split('\n').slice(0, 3).join(' | '));
    await page.screenshot({ path: `${root}/spikes/stage1-smoke/.cache/error-dl-${task}.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

/** 等下載資料夾出現指定名稱的檔案（下載完成、不是 .crdownload）。 */
async function waitForFile(dir, name, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(join(dir, name))) return readFileSync(join(dir, name));
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
const listFiles = (dir) => readdirSync(dir).filter((f) => !f.endsWith('.crdownload')).sort();

/** JPEG／PNG 的寬高（讀檔頭）。 */
function imageSize(buf) {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { type: 'jpg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

const panelText = (page) => page.evaluate(() => document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-panel')?.innerText ?? '');
const tooltipOf = (page, id) =>
  page.evaluate((id) => {
    const tip = document.querySelector('ytm-toolbar').shadowRoot.querySelector(`.ytm-btn[data-button="${id}"] + .ytm-tooltip`);
    return { text: tip?.textContent, notice: tip?.hasAttribute('data-notice') };
  }, id);

// ---------------------------------------------------------------------------
// T17 截圖與縮圖（002 FR-30 至 FR-32、FR-50 至 FR-53）
// ---------------------------------------------------------------------------
await section('T17', async (page, context, dl) => {
  // ---- 縮圖 ----
  await button(page, 'thumbnail').click();
  await page.waitForSelector('ytm-toolbar .ytm-thumb-row', { timeout: 8000 });
  const rows = await page.evaluate(() =>
    [...document.querySelector('ytm-toolbar').shadowRoot.querySelectorAll('.ytm-thumb-row')].map((r) => ({
      key: r.dataset.key,
      size: r.querySelector('.ytm-thumb-size').textContent.replace(/\s+/g, ' '),
      preview: r.querySelector('img').complete && r.querySelector('img').naturalWidth > 0,
    })),
  );
  const requested = [...new Set(thumbnailRequests.filter((r) => r.startsWith('jNQXAC9IVRw/')))].sort();
  check(
    '縮圖面板只列出實際存在的尺寸，404 與 120×90 預設圖不列出（FR-30）',
    rows.map((r) => r.key).join() === 'hqdefault,mqdefault' && requested.length === 4,
    `${rows.map((r) => `${r.key}=${r.size}`).join(', ')}；背景腳本檢查了 ${requested.join(', ')}`,
  );
  check('每個尺寸有預覽小圖（FR-30）', rows.every((r) => r.preview));
  await shot(page, 'T17-thumbnail-panel.png');

  await page.locator('ytm-toolbar .ytm-thumb-row[data-key="hqdefault"]').click();
  const thumbFile = await waitForFile(dl, 'Fixture video [jNQXAC9IVRw].jpg');
  const thumbSize = thumbFile && imageSize(thumbFile);
  check(
    '點尺寸即下載該圖片，檔名「標題 [ID].jpg」、尺寸正確、維持 JPG（FR-31、FR-8）',
    thumbSize?.type === 'jpg' && thumbSize.width === 480 && thumbSize.height === 360,
    `${listFiles(dl).join(', ')} ${JSON.stringify(thumbSize)}`,
  );
  await page.waitForTimeout(200);
  check('下載後該列顯示「已存到下載資料夾」', /Saved to Downloads/.test(await panelText(page)));

  // 全部尺寸都有的影片；200 但內容是 120×90 預設圖的尺寸也要排除
  await page.keyboard.press('Escape');
  await spaNavigate(page, 'next');
  await button(page, 'thumbnail').click();
  await page.waitForSelector('ytm-toolbar .ytm-thumb-row');
  const all = await page.evaluate(() => [...document.querySelector('ytm-toolbar').shadowRoot.querySelectorAll('.ytm-thumb-row')].map((r) => r.querySelector('.ytm-thumb-size').textContent.replace(/\s+/g, '')));
  check('有全部尺寸的影片列出 1280×720、640×480、480×360、320×180（FR-30）', all.join() === '1280×720,640×480,480×360,320×180', all.join());
  await page.locator('ytm-toolbar .ytm-thumb-row').first().click();
  const maxFile = await waitForFile(dl, 'Fixture video aaaaaaaaaaa [aaaaaaaaaaa].jpg');
  check('下載的最高畫質縮圖為 1280×720', JSON.stringify(maxFile && imageSize(maxFile)) === '{"type":"jpg","width":1280,"height":720}');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__fixtureNavigate('bbbbbbbbbbb'));
  await page.waitForTimeout(300);
  await button(page, 'thumbnail').click();
  await page.waitForSelector('ytm-toolbar .ytm-thumb-row');
  const keysB = await page.evaluate(() => [...document.querySelector('ytm-toolbar').shadowRoot.querySelectorAll('.ytm-thumb-row')].map((r) => r.dataset.key));
  check('回應 200 但內容是 120×90 預設圖的尺寸不列出（plan 3.8）', !keysB.includes('maxresdefault') && keysB.length === 3, keysB.join());
  await page.keyboard.press('Escape');

  // ---- 截圖 ----
  await page.evaluate(async () => {
    const v = document.querySelector('video');
    v.currentTime = 12.4;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
  });
  const native = await page.evaluate(() => ({ w: document.querySelector('video').videoWidth, h: document.querySelector('video').videoHeight }));
  await button(page, 'screenshot').click();
  const png = await waitForFile(dl, 'Fixture video bbbbbbbbbbb [bbbbbbbbbbb] 00m12s.png');
  const pngSize = png && imageSize(png);
  check(
    '截圖以原始影片解析度存成 PNG，檔名「標題 [ID] 00m12s.png」（FR-50、FR-51）',
    pngSize?.type === 'png' && pngSize.width === native.w && pngSize.height === native.h,
    `${listFiles(dl).filter((f) => f.endsWith('.png')).join(', ')} ${JSON.stringify(pngSize)} 影片 ${native.w}×${native.h}`,
  );
  await page.waitForTimeout(150);
  const tip = await tooltipOf(page, 'screenshot');
  check('擷取成功後按鈕短暫顯示完成提示（FR-52）', tip.notice && tip.text === 'Screenshot saved', JSON.stringify(tip));
  await shot(page, 'T17-screenshot-saved.png');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(2800);
  const tipAfter = await tooltipOf(page, 'screenshot');
  check('提示數秒後恢復為按鈕名稱', !tipAfter.notice && tipAfter.text === 'Screenshot', JSON.stringify(tipAfter));

  // 截圖的內容只有影片畫面：與直接把 <video> 畫到 canvas 的結果相同，不含 YouTube 的控制列（假頁面的按鈕疊在影片上）
  const pixelCheck = await page.evaluate(async (b64) => {
    const v = document.querySelector('video');
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    // 假頁面的「Play/Pause」「Autoplay」按鈕在影片右下角；截圖該處應是影片畫面（與 <video> 本身相同）
    const fromShot = ctx.getImageData(c.width - 40, c.height - 20, 1, 1).data.join();
    ctx.drawImage(v, 0, 0);
    const fromVideo = ctx.getImageData(c.width - 40, c.height - 20, 1, 1).data.join();
    return { fromShot, fromVideo };
  }, png.toString('base64'));
  check('截圖不含播放器的控制列或疊加資訊（FR-50）', pixelCheck.fromShot === pixelCheck.fromVideo, JSON.stringify(pixelCheck));

  // 影片還沒載入時：顯示錯誤提示（FR-52）
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.removeAttribute('src');
    v.load();
  });
  await button(page, 'screenshot').click();
  await page.waitForTimeout(150);
  const failTip = await tooltipOf(page, 'screenshot');
  check('無法擷取時顯示錯誤提示（FR-52）', failTip.notice && failTip.text === "The video isn't ready yet", JSON.stringify(failTip));

  // 縮圖與截圖不需要橋接程式（FR-32、FR-53）：本環境沒有橋接程式，以上都已完成
  check('縮圖與截圖不需要橋接程式（FR-32、FR-53）', listFiles(dl).length === 3, listFiles(dl).join(', '));
});

// ---------------------------------------------------------------------------
// T21a 字幕直接下載（002 FR-40 至 FR-45）
// ---------------------------------------------------------------------------
const subsState = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('ytm-toolbar').shadowRoot;
    const group = (key) =>
      [...root.querySelectorAll(`.ytm-subs-group[data-group="${key}"] .ytm-subs-track`)].map((l) => ({
        name: l.textContent.trim(),
        lang: l.dataset.lang,
        checked: l.querySelector('input').checked,
        icon: !!l.querySelector('.ytm-subs-auto svg'),
      }));
    return {
      legends: [...root.querySelectorAll('.ytm-subs-legend')].map((l) => l.textContent),
      uploaded: group('uploaded'),
      auto: group('auto'),
      formats: [...root.querySelectorAll('#ytm-subs-format option')].map((o) => `${o.value}:${o.textContent}`),
      format: root.querySelector('#ytm-subs-format')?.value,
    };
  });
const openSubs = async (page) => {
  await button(page, 'subtitles').click();
  await page.waitForFunction(() => {
    const panel = document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-panel');
    return panel && !panel.querySelector('.ytm-spinner');
  });
};
const chooseTrack = (page, group, lang) => page.locator(`ytm-toolbar .ytm-subs-group[data-group="${group}"] .ytm-subs-track[data-lang="${lang}"] input`).check();
const downloadSubs = (page) => page.locator('ytm-toolbar .ytm-subs .ytm-button-primary').click();

await section('T21a', async (page, context, dl) => {
  await openSubs(page);
  const s = await subsState(page);
  check(
    '字幕分為「上傳的字幕」與「自動產生的字幕」兩組，自動產生的以圖示標記（FR-40）',
    s.legends.join('|') === 'Uploaded subtitles|Auto-generated subtitles' &&
      s.uploaded.length === 3 &&
      s.auto.length === 1 &&
      s.auto[0].icon &&
      s.uploaded.every((t) => !t.icon),
    `${s.uploaded.map((t) => t.name).join(', ')} / ${s.auto.map((t) => t.name).join(', ')}`,
  );
  check('網域不是 youtube.com 的字幕不出現在清單中（plan 3.8）', ![...s.uploaded, ...s.auto].some((t) => t.lang === 'xx'));
  check('格式可選 SRT（預設）、VTT、純文字（FR-41）', s.formats.join() === 'srt:SRT,vtt:VTT,txt:Text only (TXT)' && s.format === 'srt', s.formats.join());
  check('預設選中與瀏覽器語言（en-US）相同的字幕，並排在清單最上方（FR-43）', s.uploaded[0].lang === 'en' && s.uploaded[0].checked, JSON.stringify(s.uploaded[0]));
  await shot(page, 'T21a-subtitles-panel.png');

  // SRT（上傳的英文字幕）
  await downloadSubs(page);
  const srt = (await waitForFile(dl, 'Fixture video [jNQXAC9IVRw].en.srt'))?.toString('utf8');
  check(
    '下載的 SRT 時間碼正確（FR-41、FR-44）',
    srt === '1\n00:00:01,000 --> 00:00:04,500\nHello & welcome to the fixture\n\n2\n00:01:02,250 --> 00:01:05,000\nThis is the second line\n',
    JSON.stringify(srt),
  );
  check('字幕以 fmt=vtt 從 YouTube 的字幕網址取得', captionRequests.some((q) => /lang=en/.test(q) && /fmt=vtt/.test(q)), captionRequests.join(' '));
  await page.waitForTimeout(150);
  check('完成後顯示「已存到下載資料夾」', /Saved to Downloads/.test(await panelText(page)));

  // TXT（自動產生的字幕）
  await chooseTrack(page, 'auto', 'en');
  await page.locator('ytm-toolbar #ytm-subs-format').selectOption('txt');
  await downloadSubs(page);
  const txt = (await waitForFile(dl, 'Fixture video [jNQXAC9IVRw].en.txt'))?.toString('utf8');
  check('選 TXT 時沒有時間碼，自動字幕的重複行只保留一次（FR-41）', txt === 'so today we\nare testing\n', JSON.stringify(txt));

  // VTT（中文）
  await chooseTrack(page, 'uploaded', 'zh-TW');
  await page.locator('ytm-toolbar #ytm-subs-format').selectOption('vtt');
  await downloadSubs(page);
  const vtt = (await waitForFile(dl, 'Fixture video [jNQXAC9IVRw].zh-TW.vtt'))?.toString('utf8');
  check('VTT 原樣保留，中文正確（FR-41）', !!vtt && vtt.startsWith('WEBVTT') && vtt.includes('你好，歡迎') && vtt.includes('00:01:02.250 --> 00:01:05.000'), JSON.stringify(vtt?.slice(0, 80)));
  check('字幕直接存到瀏覽器的下載資料夾，不需要橋接程式（FR-44、FR-45）', listFiles(dl).length === 3, listFiles(dl).join(', '));
  await page.keyboard.press('Escape');

  // YouTube 的 XML 格式
  await page.evaluate(() => window.__fixtureNavigate('ccccccccccc'));
  await page.waitForTimeout(300);
  await openSubs(page);
  await downloadSubs(page);
  const xmlSrt = (await waitForFile(dl, 'Fixture video ccccccccccc [ccccccccccc].de.srt'))?.toString('utf8');
  check(
    'YouTube 回傳 XML 格式時也能轉成 SRT（plan 3.8）',
    xmlSrt === "1\n00:00:01,500 --> 00:00:03,500\nIt's XML & fine\n\n2\n00:01:02,250 --> 00:01:05,000\nSecond XML line\n",
    JSON.stringify(xmlSrt),
  );
  await page.keyboard.press('Escape');

  // 直接下載失敗
  await page.evaluate(() => window.__fixtureNavigate('bbbbbbbbbbb'));
  await page.waitForTimeout(300);
  await openSubs(page);
  await downloadSubs(page);
  await page.waitForSelector('ytm-toolbar .ytm-subs-error', { timeout: 5000 });
  const err = await page.evaluate(() => {
    const e = document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-subs-error');
    return { text: e.textContent, retry: !!e.querySelector('button') };
  });
  check('直接下載失敗時顯示錯誤，說明安裝橋接程式可改善，並可重試（FR-44）', /helper program/.test(err.text) && /yt-dlp/.test(err.text) && err.retry, err.text);
  await shot(page, 'T21a-subtitles-direct-failed.png');
  await page.keyboard.press('Escape');

  // 沒有字幕
  await page.evaluate(() => window.__fixtureNavigate('aaaaaaaaaaa'));
  await page.waitForTimeout(300);
  await openSubs(page);
  check('沒有任何字幕時顯示「這部影片沒有字幕」（FR-42）', (await panelText(page)).includes('This video has no subtitles.'));
  await page.keyboard.press('Escape');

  // 直播
  await page.evaluate(() => window.__fixtureNavigate('liveliveliv'));
  await page.waitForTimeout(300);
  await openSubs(page);
  check('直播中的影片，字幕面板顯示無法下載（FR-1）', (await panelText(page)).includes("Live and upcoming videos can't be downloaded."));
});

await section(
  'T21a-zh',
  async (page) => {
    await openSubs(page);
    const s = await subsState(page);
    check('瀏覽器語言為繁體中文時預設選中「Chinese (Taiwan)」並排在最上方（FR-43）', s.uploaded[0].lang === 'zh-TW' && s.uploaded[0].checked, JSON.stringify(s.uploaded.map((t) => t.lang)));
    check('繁體中文介面（NFR-4）', s.legends.join('|') === '上傳的字幕|自動產生的字幕', s.legends.join('|'));
  },
  { lang: 'zh-TW' },
);

// ---------------------------------------------------------------------------
// T22a 影片／MP3 面板的未連線狀態（002 FR-1、FR-2）
// ---------------------------------------------------------------------------
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const setupState = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('ytm-toolbar').shadowRoot;
    const setup = root.querySelector('.ytm-setup');
    if (!setup) return null;
    const link = setup.querySelector('a.ytm-link');
    return {
      title: setup.querySelector('.ytm-setup-title')?.textContent,
      components: [...setup.querySelectorAll('.ytm-setup-components li')].map((li) => `${li.dataset.component}:${li.querySelector('.ytm-setup-state').textContent}`),
      os: setup.querySelector('.ytm-install')?.dataset.os ?? 'other',
      osTitle: setup.querySelector('.ytm-setup-os-title')?.textContent,
      commands: [...setup.querySelectorAll('.ytm-command-text')].map((c) => c.textContent),
      link: link ? { href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel') } : null,
      recheck: setup.querySelector('.ytm-setup-actions .ytm-button-primary')?.textContent,
    };
  });
const openPanel = async (page, id) => {
  await button(page, id).click();
  await page.waitForFunction(() => {
    const panel = document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-panel');
    return panel && !panel.querySelector('.ytm-spinner');
  });
};

for (const [task, ua, os] of [
  ['T22a-mac', MAC_UA, 'mac'],
  ['T22a-win', WIN_UA, 'windows'],
]) {
  await section(
    task,
    async (page, context) => {
      // 008（T45）：作業系統以 runtime.getPlatformInfo 判斷；測試環境是 Linux，改為回報 mac／win。
      await (await extensionWorker(context)).evaluate((o) => {
        chrome.runtime.getPlatformInfo = async () => ({ os: o, arch: 'x86-64', nacl_arch: 'x86-64' });
      }, os === 'mac' ? 'mac' : 'win');
      await openPanel(page, 'video');
      // 作業系統（runtime.getPlatformInfo）取得後才顯示安裝指令。
      await page.waitForSelector('ytm-toolbar .ytm-setup-os-title');
      const s = await setupState(page);
      check(
        `${os}：影片面板列出需要的元件（小幫手未安裝、yt-dlp、ffmpeg 與 deno 無法確認）（FR-2、T15a）`,
        s?.title === "Downloads aren't set up yet" &&
          s.components.join('|') === "host:Not installed|ytDlp:Can't check without the helper|ffmpeg:Can't check without the helper|deno:Can't check without the helper",
        JSON.stringify(s?.components),
      );
      check(
        `${os}：依作業系統顯示對應的一行安裝指令（FR-2、008 FR-1）`,
        s.os === os &&
          s.commands.length === 1 &&
          (os === 'mac'
            ? s.osTitle === 'Install on macOS' && s.commands[0] === 'curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh'
            : s.osTitle === 'Install on Windows' && s.commands[0] === 'irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex'),
        `${s.osTitle}: ${s.commands.join(' / ')}`,
      );
      check(
        `${os}：連到 README 的安裝章節（新分頁）（FR-2）`,
        s.link?.href === 'https://github.com/chidi0716/yt-toolbar-master#install-the-helper' && s.link.target === '_blank' && /noopener/.test(s.link.rel),
        JSON.stringify(s.link),
      );
      await shot(page, `T22a-video-panel-${os}.png`);
      if (os === 'mac') {
        // 重新檢查
        await page.locator('ytm-toolbar .ytm-setup-actions .ytm-button-primary').click();
        const during = await page
          .waitForFunction(() => document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-setup-actions .ytm-button-primary').textContent === 'Checking…', null, { timeout: 1000 })
          .then(() => 'Checking…', () => 'not shown');
        await page.waitForTimeout(700);
        const after = await setupState(page);
        check('「重新檢查」按鈕：檢查中顯示「Checking…」，完成後更新狀態（FR-2）', during === 'Checking…' && after.recheck === 'Check again' && after.components[0] === 'host:Not installed', `${during} → ${after.recheck}`);
        await page.keyboard.press('Escape');
        // MP3 面板相同
        await openPanel(page, 'mp3');
        const mp3 = await setupState(page);
        check('MP3 面板同樣顯示未連線狀態（FR-2）', mp3?.title === "Downloads aren't set up yet" && mp3.os === 'mac');
        await page.keyboard.press('Escape');
        // 縮圖仍可使用（未連線狀態下）
        await openPanel(page, 'thumbnail');
        check('未連線時縮圖面板仍可使用（FR-32）', (await page.locator('ytm-toolbar .ytm-thumb-row').count()) === 2);
        await page.keyboard.press('Escape');
        // 直播、尚未開始的影片
        for (const id of ['liveliveliv', 'upcomingvid']) {
          await page.evaluate((id) => window.__fixtureNavigate(id), id);
          await page.waitForTimeout(300);
          await openPanel(page, 'video');
          const text = await panelText(page);
          await page.keyboard.press('Escape');
          await openPanel(page, 'mp3');
          const mp3Text = await panelText(page);
          check(
            `${id === 'liveliveliv' ? '直播中' : '尚未開始'}的影片，影片與 MP3 面板顯示無法下載、不顯示選項（FR-1）`,
            text.includes("Live and upcoming videos can't be downloaded.") && !text.includes('Check again') && mp3Text.includes("Live and upcoming videos can't be downloaded."),
            text.split('\n').slice(0, 2).join(' / '),
          );
          if (id === 'liveliveliv') await shot(page, 'T22a-live-unavailable.png');
          await page.keyboard.press('Escape');
        }
      }
    },
    { userAgent: ua, viewport: { width: 1280, height: 1250 } },
  );
}

await section(
  'T22a-zh',
  async (page, context) => {
    await (await extensionWorker(context)).evaluate(() => {
      chrome.runtime.getPlatformInfo = async () => ({ os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' });
    });
    await openPanel(page, 'video');
    await page.waitForSelector('ytm-toolbar .ytm-setup-os-title');
    const s = await setupState(page);
    check('繁體中文的未連線說明（NFR-4）', s?.title === '尚未安裝下載功能' && s.osTitle === '在 Windows 上安裝' && s.recheck === '重新檢查', JSON.stringify(s));
    await shot(page, 'T22a-video-panel-zh-TW.png');
  },
  { lang: 'zh-TW', userAgent: WIN_UA, viewport: { width: 1280, height: 1250 } },
);

if (!summary()) process.exitCode = 1;
void EXT_ID;
void skip;
void captionRequests;
