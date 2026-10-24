// 階段 4（T16、T18 至 T23）端到端測試：Playwright 的 Chromium 經由原生訊息啟動工作目錄內編譯的真正橋接程式，
// 橋接程式再執行 repo 內的假 yt-dlp（spikes/stage4/build-host.sh）。觀看頁是 spikes/stage1-smoke 的本機假頁面，不連外。
// 橋接程式的家目錄（狀態檔、記錄檔、預設下載資料夾 ~/Downloads）在 spikes/stage4/.cache/e2e/home-*/。
//   sh spikes/stage4/build-host.sh && npm run build
//   PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node spikes/stage4/e2e-test.mjs
//   ONLY=connected,restart … # 只跑某幾段
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXT_ID, WATCH, button, launch, openWatch, reporter, setUiLanguage, shot, shots } from '../stage1-smoke/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const e2e = join(cache, 'e2e');
const HOST = join(cache, 'bin', 'ytm-host');
const LOG = join(e2e, 'yt-dlp.log');
const { check, skip, summary } = reporter();
const only = process.env.ONLY;
const want = (name) => !only || only.split(',').includes(name);

if (!existsSync(HOST)) {
  console.log('請先執行 sh spikes/stage4/build-host.sh');
  process.exit(2);
}
if (!process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS) {
  console.log('請以 PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 執行：背景腳本（service worker）的請求才會由假頁面回應。');
  process.exit(2);
}
mkdirSync(e2e, { recursive: true });

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const TITLE = '測試影片： Fake⧸Video？';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 切換假 yt-dlp 的情境（下一次執行 yt-dlp 時生效）。 */
function scenario(name, delayMs = 0) {
  writeFileSync(join(e2e, 'scenario'), name);
  writeFileSync(join(e2e, 'delay'), String(delayMs));
}
const resetLog = () => rmSync(LOG, { force: true });
/** 假 yt-dlp 每次執行的參數（不含 --version）。 */
const ytRuns = () =>
  existsSync(LOG)
    ? readFileSync(LOG, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((a) => !a.includes('--version'))
    : [];
const argValue = (args, flag) => {
  const i = args.lastIndexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function homeFor(name) {
  const home = join(e2e, `home-${name}`);
  return { home, downloads: join(home, 'Downloads') };
}

async function session(name, fn, { tools = 'tools', keepProfile = false, lang = 'en-US', userAgent = MAC_UA, viewport = { width: 1280, height: 1300 }, open = true } = {}) {
  if (!want(name.split(':')[0])) return;
  console.log(`\n== ${name}`);
  const { home, downloads } = homeFor(name.split(':')[0]);
  if (!keepProfile) rmSync(home, { recursive: true, force: true });
  mkdirSync(downloads, { recursive: true });
  const context = await launch({
    name: `e2e-${name.split(':')[0]}`,
    profile: join(e2e, `profile-${name.split(':')[0]}`),
    keepProfile,
    lang,
    userAgent,
    viewport,
    nativeHost: HOST,
    env: {
      ...process.env,
      HOME: home,
      XDG_STATE_HOME: join(home, '.local', 'state'),
      PATH: `${join(cache, 'bin', tools)}:/usr/bin:/bin`,
    },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (err) => console.log('  pageerror:', String(err).slice(0, 200)));
  try {
    if (open) await openWatch(page, WATCH);
    await fn({ page, context, home, downloads });
  } catch (err) {
    check(`${name} script`, false, String(err).split('\n').slice(0, 4).join(' | '));
    await page.screenshot({ path: join(e2e, `error-${name.replace(/:/g, '-')}.png`) }).catch(() => {});
  } finally {
    await context.close().catch(() => {});
  }
}

// ---- 工具列與面板 ----
const inToolbar = (page, fn, arg) => page.evaluate(([src, a]) => new Function('root', 'arg', src)(document.querySelector('ytm-toolbar').shadowRoot, a), [fn, arg]);
const panelText = (page) => inToolbar(page, "return root.querySelector('.ytm-panel')?.innerText ?? ''");
async function openPanel(page, id) {
  await button(page, id).click();
  await page.waitForFunction(() => {
    const panel = document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-panel');
    return panel && !panel.querySelector('.ytm-spinner');
  });
}
const closePanel = (page) => page.keyboard.press('Escape');
const qualityRows = (page) =>
  inToolbar(
    page,
    `return [...root.querySelectorAll('.ytm-quality-row')].map((b) => ({
      format: b.dataset.format,
      container: b.querySelector('.ytm-quality-container').textContent,
      resolution: b.querySelector('.ytm-quality-resolution').textContent,
      badge: b.querySelector('.ytm-quality-badge').textContent,
      size: b.querySelector('.ytm-quality-size').textContent,
      note: b.querySelector('.ytm-quality-note')?.textContent ?? '',
      disabled: b.disabled,
    }))`,
  );
const jobRows = (page) =>
  inToolbar(
    page,
    `return [...root.querySelectorAll('.ytm-job')].map((j) => ({
      id: j.dataset.job,
      state: j.dataset.state,
      label: j.querySelector('.ytm-job-label')?.textContent,
      stateText: j.querySelector('.ytm-job-state')?.textContent,
      details: j.querySelector('.ytm-job-details')?.textContent ?? '',
      file: j.querySelector('.ytm-job-file')?.textContent ?? '',
      indeterminate: j.querySelector('.ytm-progress')?.hasAttribute('data-indeterminate') ?? null,
      error: j.querySelector('.ytm-job-error')?.dataset.code ?? null,
      errorText: j.querySelector('.ytm-job-error-text')?.textContent ?? '',
      buttons: [...j.querySelectorAll('button')].map((b) => b.textContent.trim()),
    }))`,
  );
const buttonProgress = (page, id) => inToolbar(page, `return root.querySelector('.ytm-btn[data-button="' + arg + '"]').dataset.progress ?? null`, id);
async function waitJob(page, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let rows = [];
  while (Date.now() < deadline) {
    rows = await jobRows(page);
    const hit = rows.find(predicate);
    if (hit) return hit;
    await sleep(100);
  }
  return null;
}
async function waitFile(path, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await sleep(100);
  }
  return false;
}
const listDir = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);

async function setClip(page, id, start, end) {
  await page.locator(`ytm-toolbar #${id}-start`).fill(start);
  await page.locator(`ytm-toolbar #${id}-end`).fill(end);
  await page.locator(`ytm-toolbar #${id}-end`).blur();
  await sleep(100);
}

// ---- 背景腳本（service worker）：通知 ----
async function worker(context) {
  return context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`)) ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
}
/** 記錄背景腳本建立的通知（標題與內容）。 */
async function recordNotifications(context) {
  const sw = await worker(context);
  await sw.evaluate(() => {
    if (globalThis.__notes) return;
    globalThis.__notes = [];
    const create = chrome.notifications.create.bind(chrome.notifications);
    chrome.notifications.create = (id, options, ...rest) => {
      globalThis.__notes.push({ id, title: options.title, message: options.message, iconUrl: options.iconUrl });
      return create(id, options, ...rest);
    };
  });
}
const notes = async (context) => (await worker(context)).evaluate(() => globalThis.__notes ?? []);
const activeNotifications = async (context) => (await worker(context)).evaluate(() => chrome.notifications.getAll());

// ===========================================================================
// 已連線：影片、MP3、字幕、取消、錯誤、關閉分頁、設定頁
// ===========================================================================
await session('connected', async ({ page, context, home, downloads }) => {
  scenario('ok');
  resetLog();
  await recordNotifications(context);

  // ---- T19 影片面板 ----
  await openPanel(page, 'video');
  await page.waitForSelector('ytm-toolbar .ytm-quality-row', { timeout: 10_000 });
  let rows = await qualityRows(page);
  check(
    'T16/T19：影片面板經由橋接程式取得格式，預設只列 MP4（002 FR-10、FR-11）',
    rows.map((r) => `${r.resolution} ${r.container}`).join('|') === '2160p MP4|1080p60 MP4|1080p MP4|720p MP4|360p MP4',
    rows.map((r) => `${r.resolution} ${r.container} ${r.format} ${r.size} ${r.badge}`).join(' | '),
  );
  check(
    'T18/T19：影像加聲音的大小相加；只有估計值時標「~」（FR-12）',
    rows.find((r) => r.format === '137+140')?.size === '138.8 MB' && rows.find((r) => r.format === '18')?.size.startsWith('~'),
    rows.map((r) => `${r.format}=${r.size}`).join(', '),
  );
  check('DRM 與故事板格式不列出（FR-11）', !rows.some((r) => r.format.includes('999') || r.format.includes('sb0')));
  check(
    'T18a：4K 沒有 H.264 時以 AV1＋M4A 合併成 MP4 列在主清單，標「4K」並加註可能無法播放（FR-13、Q43）',
    rows[0]?.format === '401+140' && rows[0].badge === '4K' && rows[0].note === 'AV1: not supported by some players' && rows.slice(1).every((r) => r.note === ''),
    JSON.stringify(rows[0]),
  );
  await shot(page, 'T19-video-panel.png');
  await page.locator('ytm-toolbar .ytm-more-formats').click();
  rows = await qualityRows(page);
  check(
    '「顯示更多格式」列出 WEBM（VP9／AV1 加 Opus）（FR-11、FR-13）',
    rows.some((r) => r.container === 'WEBM' && r.format === '313+251') && rows.some((r) => r.format === '248+251'),
    rows.map((r) => `${r.resolution} ${r.container} ${r.format}`).join(' | '),
  );
  await shot(page, 'T19-video-panel-more.png');
  await page.locator('ytm-toolbar .ytm-more-formats').click();
  // 4K（AV1＋M4A）下載成 MP4
  resetLog();
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="401+140"]').click();
  const uhd = await waitJob(page, (j) => j.state === 'done' && /2160p/.test(j.label));
  const uhdRun = ytRuns().find((a) => a.includes('-f'));
  check(
    'T18a：4K MP4 以 -f 401+140 --merge-output-format mp4 下載',
    !!uhd && uhd.label === '2160p MP4' && argValue(uhdRun, '-f') === '401+140' && argValue(uhdRun, '--merge-output-format') === 'mp4',
    `${uhd?.label} ${JSON.stringify(uhdRun?.slice(-12))}`,
  );
  rmSync(join(downloads, uhd?.file ?? 'none'), { force: true });

  // 整部影片下載（1080p MP4），慢慢送出進度
  scenario('ok', 250);
  resetLog();
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="137+140"]').click();
  const running = await waitJob(page, (j) => j.state === 'downloading' && /%/.test(j.details));
  check('T22：下載中顯示百分比、速度、剩餘時間與「取消」（FR-3、FR-4）', !!running && /\d+%/.test(running.details) && /KB\/s|B\/s/.test(running.details) && /left/.test(running.details) && running.buttons.includes('Cancel'), JSON.stringify(running));
  const ring = await buttonProgress(page, 'video');
  check('T22：工具列的影片按鈕顯示進度環（FR-3）', ring !== null, `data-progress=${ring}`);
  await shot(page, 'T22-progress.png');
  const done = await waitJob(page, (j) => j.state === 'done' && j.label === '1080p MP4', 30_000);
  const file = `${TITLE} [jNQXAC9IVRw].mp4`;
  check('T16：下載完成，檔案存到橋接程式的預設資料夾（~/Downloads）（FR-5、FR-60）', !!done && existsSync(join(downloads, file)), listDir(downloads).join(', '));
  check('T22：完成後顯示檔名與「Show file」', done?.file === file && done.buttons.includes('Show file'), JSON.stringify(done));
  check('T22：完成後工具列按鈕的進度環消失', (await buttonProgress(page, 'video')) === null);
  let run = ytRuns().find((a) => a.includes('-f'));
  check(
    'T16：yt-dlp 的參數：格式、容器、嵌入封面／中繼資料／章節（004 FR-11 預設開啟）',
    !!run && argValue(run, '-f') === '137+140' && argValue(run, '--merge-output-format') === 'mp4' && run.includes('--embed-thumbnail') && run.includes('--embed-metadata') && run.includes('--embed-chapters') && !run.includes('--download-sections'),
    JSON.stringify(run),
  );
  await sleep(300);
  let n = await notes(context);
  check('T16：完成時建立通知，標題「Download complete」、內容為檔名（FR-5）', n.some((x) => x.id === `ytm-job:${done?.id}` && x.title === 'Download complete' && x.message === file), JSON.stringify(n));
  await shot(page, 'T22-done.png');

  // 「Show file」：Linux 上橋接程式回應 UNSUPPORTED_PLATFORM（macOS／Windows 才會開 Finder／檔案總管）
  await page.locator(`ytm-toolbar .ytm-job[data-job="${done.id}"] .ytm-job-foot button`).click();
  await sleep(500);
  const logDir = join(home, '.local', 'state', 'yt-toolbar-master');
  const hostLog = existsSync(logDir) ? listDir(join(logDir, 'logs')).map((f) => readFileSync(join(logDir, 'logs', f), 'utf8')).join('\n') : '';
  check('T16：「Show file」送出 reveal 指令（Linux 上回應 UNSUPPORTED_PLATFORM，由記錄檔確認）', /reveal/.test(hostLog), hostLog.split('\n').filter((l) => /reveal/.test(l)).slice(-1)[0] ?? `no log in ${logDir}`);

  // ---- T19 時間範圍（004 §3）----
  scenario('ok');
  resetLog();
  await setClip(page, 'ytm-video-clip', '1:00', '1:30');
  rows = await qualityRows(page);
  const hint = await inToolbar(page, "return root.querySelector('.ytm-clip-hint')?.textContent ?? null");
  check('T19：裁切時大小依比例估計並標「~」（004 FR-23）', rows.find((r) => r.format === '137+140')?.size === '~17.0 MB', rows.map((r) => `${r.format}=${r.size}`).join(', '));
  check('T19：第一次選擇部分範圍時顯示一次「裁切需要額外處理時間」（004 FR-24）', hint === 'Cutting a part needs extra processing time.', hint);
  await shot(page, 'T19-clip.png');
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="136+140"]').click();
  const clipDone = await waitJob(page, (j) => j.state === 'done' && /720p/.test(j.label));
  const clipFile = `${TITLE} [jNQXAC9IVRw] 01m00s-01m30s.mp4`;
  check('T19：裁切下載完成，檔名標示時間範圍（004 FR-21、Q37）', !!clipDone && existsSync(join(downloads, clipFile)), listDir(downloads).join(', '));
  run = ytRuns().find((a) => a.includes('-f'));
  check('T19：yt-dlp 以 --download-sections *60-90 裁切', !!run && argValue(run, '--download-sections') === '*60-90' && run.includes('--force-keyframes-at-cuts'), JSON.stringify(run));
  check('T19：裁切下載後不再顯示提示', (await inToolbar(page, "return !!root.querySelector('.ytm-clip-hint')")) === false);
  check('T22：工作清單的標籤含範圍', /720p MP4 01:00–01:30/.test(clipDone?.label ?? ''), clipDone?.label);
  // 不合法的範圍：畫質按鈕停用
  await setClip(page, 'ytm-video-clip', '2:00', '1:00');
  rows = await qualityRows(page);
  check('T19：開始晚於結束時無法下載（004 FR-25）', rows.every((r) => r.disabled), (await panelText(page)).split('\n').filter((l) => /must|after|before/i.test(l)).join(' / '));
  await setClip(page, 'ytm-video-clip', '0:00', '4:05');
  rows = await qualityRows(page);
  check('T19：回到整部影片時大小不再是估計值', rows.find((r) => r.format === '137+140')?.size === '138.8 MB' && rows.every((r) => !r.disabled));
  await closePanel(page);

  // ---- T20 MP3 ----
  await openPanel(page, 'mp3');
  await page.waitForSelector('ytm-toolbar #ytm-mp3-bitrate');
  check('T20：MP3 面板預設 192 kbps，含時間範圍（FR-20、FR-21）', (await page.locator('ytm-toolbar #ytm-mp3-bitrate').inputValue()) === '192' && (await page.locator('ytm-toolbar #ytm-mp3-clip').count()) === 1);
  await page.locator('ytm-toolbar #ytm-mp3-bitrate').selectOption('320');
  // 與播放器同步：「設為目前時間」
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.pause();
    v.currentTime = 2;
  });
  await page.locator('ytm-toolbar #ytm-mp3-clip .ytm-clip-sync [role="switch"]').click();
  const nowButtons = await page.locator('ytm-toolbar #ytm-mp3-clip .ytm-clip-now').count();
  await page.locator('ytm-toolbar #ytm-mp3-clip .ytm-clip-now[data-which="start"]').click();
  await sleep(200);
  const startValue = await page.locator('ytm-toolbar #ytm-mp3-clip-start').inputValue();
  check('T20：開啟「與播放器同步」後出現「設為目前時間」，按下後開始時間為播放器目前時間（FR-23）', nowButtons === 2 && startValue === '00:00:02', `${nowButtons} buttons, start=${startValue}`);
  // 拖動把手：播放器跟著跳轉（FR-23）
  {
    const thumb = page.locator('ytm-toolbar #ytm-mp3-clip .ytm-range-thumb').nth(1);
    const track = await page.locator('ytm-toolbar #ytm-mp3-clip .ytm-range-track').boundingBox();
    const tb = await thumb.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.6, tb.y + tb.height / 2, { steps: 5 });
    await page.mouse.up();
    await sleep(400);
    const end = await page.locator('ytm-toolbar #ytm-mp3-clip-end').inputValue();
    const now = await page.evaluate(() => document.querySelector('video').currentTime);
    const [h, m, sec] = end.split(':').map(Number);
    check('T20：開啟同步時拖動結束把手，播放器跳到該時間點（FR-23）', Math.abs(h * 3600 + m * 60 + sec - now) < 1.01 && end !== '00:00:30', `end=${end} currentTime=${now}`);
  }
  // 不合法的時間（FR-22）
  await page.locator('ytm-toolbar #ytm-mp3-clip-end').fill('00:99:00');
  await sleep(100);
  const invalid = await inToolbar(page, "return { disabled: root.querySelector('.ytm-mp3-footer .ytm-button-primary').disabled, error: root.querySelector('#ytm-mp3-clip-end-error')?.textContent ?? null }");
  check('T20：輸入「00:99:00」時輸入框標示錯誤、「下載」停用（FR-22）', invalid.disabled && !!invalid.error, JSON.stringify(invalid));
  await page.locator('ytm-toolbar #ytm-mp3-clip-end').fill('00:00:30');
  await sleep(100);
  await shot(page, 'T20-mp3-panel.png');
  resetLog();
  await page.locator('ytm-toolbar .ytm-mp3-footer .ytm-button-primary').click();
  const mp3Done = await waitJob(page, (j) => j.state === 'done');
  const mp3Files = listDir(downloads).filter((f) => f.endsWith('.mp3'));
  check('T20：MP3 下載完成（含範圍的檔名）', !!mp3Done && mp3Files.length === 1 && / 00m02s-/.test(mp3Files[0]), mp3Files.join(', '));
  run = ytRuns().find((a) => a.includes('-x'));
  check('T20：yt-dlp 參數為 MP3 320 kbps，並裁切', !!run && argValue(run, '--audio-format') === 'mp3' && /^320/.test(argValue(run, '--audio-quality') ?? '') && /^\*2-/.test(argValue(run, '--download-sections') ?? ''), JSON.stringify(run));
  await closePanel(page);
  await openPanel(page, 'mp3');
  await sleep(300);
  check('T20：重新開啟後記得位元率 320 kbps（FR-20）', (await page.locator('ytm-toolbar #ytm-mp3-bitrate').inputValue()) === '320');
  await closePanel(page);

  // ---- T22 取消 ----
  scenario('slow');
  await openPanel(page, 'video');
  await page.waitForSelector('ytm-toolbar .ytm-quality-row');
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="18"]').click();
  const slow = await waitJob(page, (j) => j.state === 'downloading' && /%/.test(j.details));
  check('T22：慢速下載進行中', !!slow, JSON.stringify(slow));
  await page.locator(`ytm-toolbar .ytm-job[data-job="${slow?.id}"] .ytm-job-foot button`).click();
  await sleep(1500);
  const afterCancel = await jobRows(page);
  const leftovers = listDir(downloads).filter((f) => f.endsWith('.part') || f.endsWith('.ytdl'));
  check('T22：取消後工作從清單移除，暫存檔刪除（FR-4）', !afterCancel.some((j) => j.id === slow?.id) && leftovers.length === 0, `${JSON.stringify(afterCancel.map((j) => j.state))} leftovers=${leftovers.join(',')}`);
  check('T22：取消不建立通知', !(await notes(context)).some((x) => x.id === `ytm-job:${slow?.id}`));

  // ---- T22 錯誤訊息（FR-6a）----
  const errorCases = [
    ['login', 'LOGIN_REQUIRED', "This video requires signing in, which isn't supported.", { retry: false }],
    ['bot', 'VERIFICATION_REQUIRED', 'YouTube has changed. Please update yt-dlp.', { retry: true, update: true }],
    ['outdated', 'YTDLP_OUTDATED', 'YouTube has changed. Please update yt-dlp.', { retry: true, update: true }],
    ['network', 'NETWORK', 'Network problem. Try again.', { retry: true }],
    ['diskfull', 'DISK_FULL', "Couldn't write to the download folder.", { retry: true, settings: true }],
    ['format', 'FORMAT_UNAVAILABLE', 'This quality is no longer available. Try another one.', { retry: true }],
    ['unavailable', 'VIDEO_UNAVAILABLE', 'This video is unavailable.', { retry: false }],
    ['crash', 'UNKNOWN', 'The download failed.', { retry: true }],
  ];
  for (const [name, code, text, expect] of errorCases) {
    scenario(name);
    await page.locator('ytm-toolbar .ytm-quality-row[data-format="136+140"]').click();
    const failed = await waitJob(page, (j) => j.state === 'failed' && j.error === code, 10_000);
    const ok =
      !!failed &&
      failed.errorText === text &&
      failed.buttons.includes('Retry') === expect.retry &&
      failed.buttons.includes('Update yt-dlp') === !!expect.update &&
      failed.buttons.includes('Open settings') === !!expect.settings;
    check(`T22：${name} → ${code}：「${text}」${expect.retry ? '、重試' : ''}${expect.update ? '、更新 yt-dlp' : ''}${expect.settings ? '、開啟設定頁' : ''}（FR-6a）`, ok, JSON.stringify(failed ?? (await jobRows(page)).slice(0, 2)));
    if (name === 'bot') await shot(page, 'T22-error-update.png');
    if (name === 'diskfull') await shot(page, 'T22-error-disk.png');
  }
  await sleep(300);
  n = await notes(context);
  check('T16：失敗時建立「Download failed」通知（FR-6）', n.filter((x) => x.title === 'Download failed').length >= errorCases.length, `${n.filter((x) => x.title === 'Download failed').length} failed notifications`);
  // 更新 yt-dlp（假 yt-dlp -U：已是最新版本）
  await page.locator('ytm-toolbar .ytm-job[data-state="failed"] .ytm-update button').first().click();
  await page.waitForFunction(() => document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-update[data-state="done"]'), null, { timeout: 15_000 });
  const updateText = await inToolbar(page, "return root.querySelector('.ytm-update[data-state=\"done\"]').textContent");
  check('T22：「更新 yt-dlp」呼叫 updateYtDlp 並顯示結果', updateText === 'yt-dlp is already up to date.', updateText);
  check('T22：yt-dlp 以 -U 執行', ytRuns().some((a) => a.includes('-U')));
  // 重試（network 失敗的那一個）
  scenario('ok');
  const beforeIds = new Set((await jobRows(page)).map((j) => j.id));
  const retryRow = (await jobRows(page)).find((j) => j.error === 'NETWORK');
  await page.locator(`ytm-toolbar .ytm-job[data-job="${retryRow.id}"] .ytm-job-error button:has-text("Retry")`).click();
  const retried = await waitJob(page, (j) => !beforeIds.has(j.id) && j.state === 'done');
  check('T22：「重試」以同樣的設定（720p MP4）重新下載並完成', !!retried && retried.label === retryRow.label, `${retryRow.label} → ${retried?.label}`);
  await closePanel(page);

  // ---- T21 字幕：直接下載失敗時改用橋接程式 ----
  await page.evaluate(() => window.__fixtureNavigate('bbbbbbbbbbb'));
  await sleep(300);
  resetLog();
  await openPanel(page, 'subtitles');
  await page.locator('ytm-toolbar .ytm-subs-group[data-group="uploaded"] .ytm-subs-track[data-lang="fr"] input').check();
  await page.locator('ytm-toolbar .ytm-subs .ytm-button-primary').click();
  await page.waitForSelector('ytm-toolbar .ytm-subs-via-host', { timeout: 10_000 });
  const subDone = await waitJob(page, (j) => j.state === 'done');
  const subFiles = listDir(downloads).filter((f) => /\.(srt|vtt|txt)$/.test(f));
  run = ytRuns().find((a) => a.includes('--skip-download'));
  check('T21：直接下載失敗時改用 yt-dlp，存到下載資料夾（FR-44）', !!subDone && subFiles.length === 1 && subFiles[0] === `${TITLE} [bbbbbbbbbbb].fr.srt`, subFiles.join(', '));
  check('T21：yt-dlp 參數：--sub-langs fr、--convert-subs srt、上傳的字幕（--write-subs）', !!run && argValue(run, '--sub-langs') === 'fr' && argValue(run, '--convert-subs') === 'srt' && run.includes('--write-subs') && !run.includes('--write-auto-subs'), JSON.stringify(run));
  check('T21：工作清單的標籤為語言與格式', /French SRT/.test(subDone?.label ?? ''), subDone?.label);
  await shot(page, 'T21-subtitles-via-host.png');
  // 自動字幕（subAuto）＋沒有字幕
  scenario('nosubs');
  await page.locator('ytm-toolbar .ytm-subs-group[data-group="auto"] .ytm-subs-track[data-lang="ja"] input').check();
  resetLog();
  await page.locator('ytm-toolbar .ytm-subs .ytm-button-primary').click();
  const noSubs = await waitJob(page, (j) => j.state === 'failed', 10_000);
  run = ytRuns().find((a) => a.includes('--skip-download'));
  check('T21：自動字幕以 --write-auto-subs 下載（subAuto）', !!run && run.includes('--write-auto-subs') && argValue(run, '--sub-langs') === 'ja', JSON.stringify(run));
  check('T21：沒有字幕時顯示「There are no subtitles in this language.」', noSubs?.error === 'NO_SUBTITLES' && noSubs.errorText === 'There are no subtitles in this language.', JSON.stringify(noSubs));
  await closePanel(page);

  // ---- T19 直播（下載時 yt-dlp 判定為直播；面板開啟時的判斷見 downloads-test.mjs 的 T22a）----
  await page.evaluate(() => window.__fixtureNavigate('jNQXAC9IVRw'));
  await sleep(300);
  await openPanel(page, 'video');
  await page.waitForSelector('ytm-toolbar .ytm-quality-row');
  scenario('live');
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="18"]').click();
  const live = await waitJob(page, (j) => j.state === 'failed' && j.error === 'LIVE_NOT_SUPPORTED', 10_000);
  check('T22：下載時 yt-dlp 判定為直播：顯示無法下載（FR-1、FR-6a）', live?.errorText === "Live and upcoming videos can't be downloaded." && !live.buttons.includes('Retry'), JSON.stringify(live));
  await closePanel(page);

  // ---- 關閉分頁後仍會完成（FR-7）----
  scenario('ok', 400);
  await page.evaluate(() => window.__fixtureNavigate('jNQXAC9IVRw'));
  await sleep(300);
  await openPanel(page, 'mp3');
  await page.locator('ytm-toolbar #ytm-mp3-bitrate').selectOption('128');
  await setClip(page, 'ytm-mp3-clip', '0:00', '0:00');
  const fullRange = await page.evaluate(() => Math.floor(document.querySelector('video').duration));
  await setClip(page, 'ytm-mp3-clip', '0:00', `0:${String(fullRange).padStart(2, '0')}`);
  const mp3Count = listDir(downloads).filter((f) => f.endsWith('.mp3')).length;
  await page.locator('ytm-toolbar .ytm-mp3-footer .ytm-button-primary').click();
  await waitJob(page, (j) => j.state === 'downloading');
  const other = await context.newPage();
  await other.goto('chrome-extension://' + EXT_ID + '/options.html');
  await page.close();
  const finished = await (async () => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (listDir(downloads).filter((f) => f.endsWith('.mp3')).length > mp3Count) return true;
      await sleep(200);
    }
    return false;
  })();
  await sleep(500);
  n = await notes(context);
  check('T16：關閉分頁後下載仍然完成並通知（FR-7）', finished && n.filter((x) => x.title === 'Download complete' && x.message.endsWith('.mp3')).length >= 2, `${listDir(downloads).filter((f) => f.endsWith('.mp3')).join(', ')}`);

  // ---- T23 設定頁 ----
  const opt = other;
  await opt.reload();
  await opt.waitForSelector('#downloads-groups .status-row[data-component="deno"]');
  await opt.waitForFunction(() => document.querySelector('#downloads-groups .status-row[data-component="ytDlp"]')?.dataset.ok === 'true', null, { timeout: 10_000 });
  const status = await opt.evaluate(() => [...document.querySelectorAll('#downloads-groups .status-row[data-component]:not([data-component="extension"])')].map((r) => `${r.dataset.component}:${r.dataset.ok}:${r.lastElementChild.textContent}`));
  check('T23：連線狀態列出橋接程式、yt-dlp、ffmpeg、deno 與版本', status.length === 4 && status.every((s) => s.split(':')[1] === 'true') && status[1].includes('2026.10.21'), status.join(' | '));
  const folder = await opt.locator('#downloads-folder').textContent();
  check('T23：下載資料夾顯示預設的系統「下載」資料夾路徑', folder === `System Downloads folder (${downloads})`, folder);
  const desc = await opt.locator('[data-i18n="optionsDownloadsDesc"]').textContent();
  check('T23：說明縮圖、截圖與直接下載的字幕存到瀏覽器的下載位置（plan 3.8）', /Thumbnails, screenshots/.test(desc), desc);
  const presets = await opt.evaluate(() => [...document.querySelectorAll('#downloads-name-preset option')].map((o) => `${o.value}=${o.textContent}`));
  check('T23：檔名格式列出橋接程式的 namePresets', presets.join('|') === 'title-id=Title [ID]|title=Title|channel-title=Channel - Title [ID]|date-title=Upload date Title [ID]', presets.join(' | '));
  check('T23：嵌入資訊預設開啟（004 FR-11）', await opt.locator('#downloads-embed').isChecked());
  await opt.locator('#downloads-choose').click();
  await opt.waitForFunction(() => document.querySelector('#downloads-folder-error').textContent !== '', null, { timeout: 5000 });
  check('T23：選擇資料夾（Linux 不支援 pickFolder 時顯示說明）', (await opt.locator('#downloads-folder-error').textContent()) === "Choosing a folder isn't supported on this system.");
  await opt.locator('#downloads-update').click();
  await opt.waitForFunction(() => /up to date|updated|Couldn/.test(document.querySelector('#downloads-update-result').textContent), null, { timeout: 15_000 });
  check('T23：「更新 yt-dlp」顯示結果', (await opt.locator('#downloads-update-result').textContent()) === 'yt-dlp is already up to date.');
  await opt.locator('#downloads-name-preset').selectOption('channel-title');
  await opt.locator('#downloads-embed').uncheck();
  // 以 storage 指定下載資料夾（等同 pickFolder 的結果），確認之後的下載使用設定
  const custom = join(home, 'Videos');
  await opt.evaluate((dir) => chrome.storage.local.set({ downloadDir: dir }), custom);
  // 先不建立資料夾：下載時顯示「無法寫入下載資料夾」與「開啟設定頁」
  {
    const w = await context.newPage();
    await openWatch(w, WATCH);
    scenario('ok');
    await openPanel(w, 'video');
    await w.waitForSelector('ytm-toolbar .ytm-quality-row');
    await w.locator('ytm-toolbar .ytm-quality-row[data-format="18"]').click();
    await w.waitForSelector('ytm-toolbar .ytm-video > .ytm-job-error', { timeout: 10_000 });
    const e = await inToolbar(w, "const x = root.querySelector('.ytm-video > .ytm-job-error'); return { code: x.dataset.code, text: x.querySelector('.ytm-job-error-text').textContent, buttons: [...x.querySelectorAll('button')].map((b) => b.textContent) }");
    check('T23：設定的資料夾不存在時顯示「無法寫入下載資料夾」並提供「開啟設定頁」（FR-6a）', e.code === 'PERMISSION_DENIED' && e.text === "Couldn't write to the download folder." && e.buttons.includes('Open settings'), JSON.stringify(e));
    await w.close();
  }
  mkdirSync(custom, { recursive: true });
  await sleep(300);
  check('T23：設定的下載資料夾顯示在設定頁，可以「Use default」', (await opt.locator('#downloads-folder').textContent()) === custom && !(await opt.locator('#downloads-reset').isDisabled()));
  await opt.screenshot({ path: join(shots, 'T23-options-downloads.png'), fullPage: true });
  const watch = await context.newPage();
  await openWatch(watch, WATCH);
  scenario('ok');
  resetLog();
  await openPanel(watch, 'video');
  await watch.waitForSelector('ytm-toolbar .ytm-quality-row');
  await watch.locator('ytm-toolbar .ytm-quality-row[data-format="18"]').click();
  const customDone = await waitJob(watch, (j) => j.state === 'done' && /360p/.test(j.label));
  run = ytRuns().find((a) => a.includes('-f'));
  const customFiles = listDir(custom);
  check(
    'T23：之後的下載使用設定的資料夾、檔名格式「頻道 - 標題 [ID]」、不嵌入資訊',
    !!customDone && customFiles.length === 1 && /^.+ - 測試影片/.test(customFiles[0]) && !!run && !run.includes('--embed-thumbnail') && !run.includes('--embed-metadata'),
    `${customFiles.join(', ')} ${JSON.stringify(run)}`,
  );
  await opt.locator('#downloads-reset').click();
  await sleep(200);
  check('T23：「Use default」回到預設資料夾', (await opt.locator('#downloads-folder').textContent()).startsWith('System Downloads folder'));
});

// ===========================================================================
// 瀏覽器重新啟動：關閉期間完成的下載以 missed 補發通知（plan 4.6、002 FR-7）
// ===========================================================================
await session('restart', async ({ page, downloads }) => {
  scenario('ok', 700);
  await openPanel(page, 'video');
  await page.waitForSelector('ytm-toolbar .ytm-quality-row');
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="137+140"]').click();
  const job = await waitJob(page, (j) => j.state === 'downloading');
  check('restart：下載開始', !!job);
  globalThis.__restartJob = job?.id;
  check('restart：結束瀏覽器時檔案還沒完成', !existsSync(join(downloads, `${TITLE} [jNQXAC9IVRw].mp4`)));
});
if (want('restart')) {
  const { downloads } = homeFor('restart');
  const done = await waitFile(join(downloads, `${TITLE} [jNQXAC9IVRw].mp4`), 30_000);
  check('restart：瀏覽器關閉後橋接程式仍完成下載（plan 4.6）', done, listDir(downloads).join(', '));
}
await session(
  'restart:reopen',
  async ({ context }) => {
    // 背景腳本啟動時依 local 的紀錄連線一次，以 jobs 的 missed 補發通知
    const deadline = Date.now() + 10_000;
    let ids = {};
    while (Date.now() < deadline) {
      ids = await activeNotifications(context).catch(() => ({}));
      if (Object.keys(ids).length) break;
      await sleep(200);
    }
    check('restart：重新啟動瀏覽器後補發完成通知（missed）', Object.keys(ids).includes(`ytm-job:${globalThis.__restartJob}`), JSON.stringify(ids));
  },
  { keepProfile: true, open: false },
);

// ===========================================================================
// 缺少元件（T22、T15a）：缺 yt-dlp 時無法下載；只缺 deno 時可以下載並提示
// ===========================================================================
await session(
  'noytdlp',
  async ({ page }) => {
    await openPanel(page, 'video');
    const s = await inToolbar(
      page,
      `const setup = root.querySelector('.ytm-setup');
       return setup && { state: setup.dataset.state, title: setup.querySelector('.ytm-setup-title').textContent,
         components: [...setup.querySelectorAll('.ytm-setup-components li')].map((li) => li.dataset.component + ':' + li.querySelector('.ytm-setup-state').textContent),
         commands: [...setup.querySelectorAll('.ytm-command-text')].map((c) => c.textContent) }`,
    );
    check(
      'T16/T22：已連線但缺 yt-dlp：標題「Some download tools are missing」，列出各元件狀態（FR-2）',
      s?.state === 'connected' && s.title === 'Some download tools are missing' && s.components[0] === 'host:Installed (dev)' && s.components[1] === 'ytDlp:Not installed' && /^ffmpeg:Installed/.test(s.components[2]) && /^deno:Installed/.test(s.components[3]),
      JSON.stringify(s),
    );
    // 008（T45）：缺少元件時也顯示一行安裝指令（可以重複執行，已安裝的部分會跳過）。作業系統以 runtime.getPlatformInfo 為準，
    // 測試環境是 Linux，所以沒有指令（只有說明）；不會依 user agent 顯示 macOS 的指令。
    await page.waitForTimeout(500);
    const commands = await inToolbar(page, `return [...root.querySelectorAll('.ytm-setup .ytm-command-text')].map((c) => c.textContent)`);
    const other = await inToolbar(page, `return root.querySelector('.ytm-setup-os')?.textContent ?? null`);
    check('T16/T45：缺少元件時不顯示套件管理工具的指令或舊的安裝腳本（Linux：只有說明）', commands.length === 0 && /macOS/.test(other ?? ''), JSON.stringify({ commands, other }));
    await shot(page, 'T22-tools-missing.png');
  },
  { tools: 'tools-noytdlp' },
);
await session(
  'nodeno',
  async ({ page, downloads }) => {
    scenario('ok');
    await openPanel(page, 'video');
    await page.waitForSelector('ytm-toolbar .ytm-quality-row');
    const hint = await inToolbar(page, "return root.querySelector('.ytm-deno-hint')?.innerText ?? null");
    check('T16：只缺 deno 時仍可下載，顯示建議安裝 deno 的提示（T15a）', !!hint && /deno is not installed/.test(hint), hint);
    await shot(page, 'T22-deno-hint.png');
    await page.locator('ytm-toolbar .ytm-quality-row[data-format="18"]').click();
    const done = await waitJob(page, (j) => j.state === 'done');
    check('T16：只缺 deno 時下載完成', !!done && listDir(downloads).length === 1, listDir(downloads).join(', '));
  },
  { tools: 'tools-nodeno' },
);

// ===========================================================================
// 006：隱藏的「影片」工具從「更多」使用；下載中時「更多」按鈕顯示提示圓點（006 FR-15、FR-17，T32）
// ===========================================================================
await session('hiddenTool', async ({ page }) => {
  scenario('slow');
  // 編輯工具列：隱藏「影片」
  await button(page, 'more').click();
  await page.waitForSelector('ytm-toolbar .ytm-more-edit');
  await page.locator('ytm-toolbar .ytm-more-edit').click();
  await page.waitForSelector('ytm-toolbar .ytm-toolbar[data-editing]');
  await page.locator('ytm-toolbar .ytm-edit-item[data-item="video"] .ytm-edit-eye').click();
  await page.locator('ytm-toolbar .ytm-edit-actions .ytm-button-primary').click();
  await sleep(300);
  check('T32：「影片」隱藏後不在工具列上', (await button(page, 'video').count()) === 0);
  // 從「更多」的其他工具開啟影片面板
  await button(page, 'more').click();
  await page.locator('ytm-toolbar .ytm-other-item[data-tool="video"] button').click();
  await page.waitForSelector('ytm-toolbar .ytm-quality-row', { timeout: 10_000 });
  const align = await inToolbar(
    page,
    `const p = root.querySelector('.ytm-panel').getBoundingClientRect(); const m = root.querySelector('.ytm-btn[data-button="more"]').getBoundingClientRect(); return { pr: p.right, mr: m.right, pl: p.left, ml: m.left }`,
  );
  check('T32：從「其他工具」開啟影片面板，面板對齊「更多」按鈕（006 FR-15）', Math.abs(align.pr - align.mr) <= 1 || Math.abs(align.pl - align.ml) <= 1, JSON.stringify(align));
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="18"]').click();
  const job = await waitJob(page, (j) => j.state === 'downloading');
  await page.keyboard.press('Escape');
  await sleep(300);
  const dot = await inToolbar(page, `const b = root.querySelector('.ytm-btn[data-button="more"]'); return { dot: b.hasAttribute('data-dot'), label: b.getAttribute('aria-label') }`);
  check('T32：隱藏的「影片」下載中，「更多」按鈕顯示提示圓點（006 FR-17、驗收 7）', !!job && dot.dot, JSON.stringify(dot));
  await shot(page, 'T32-more-dot-download.png');
  await button(page, 'more').click();
  const busy = await inToolbar(page, `return !!root.querySelector('.ytm-other-item[data-tool="video"] .ytm-other-dot')`);
  check('T32：「其他工具」中下載中的「影片」有圓點', busy);
  // 取消後圓點消失
  await page.locator('ytm-toolbar .ytm-other-item[data-tool="video"] button').click();
  await page.waitForSelector(`ytm-toolbar .ytm-job[data-job="${job?.id}"]`);
  await page.locator(`ytm-toolbar .ytm-job[data-job="${job?.id}"] .ytm-job-foot button`).click();
  await sleep(1500);
  await page.keyboard.press('Escape');
  await sleep(300);
  check('T32：取消下載後提示圓點消失', !(await inToolbar(page, `return root.querySelector('.ytm-btn[data-button="more"]').hasAttribute('data-dot')`)));
  scenario('ok');
});

// ===========================================================================
// 007：下載中切換介面語言；通知使用所選語言（T35、T36）
// ===========================================================================
await session('language', async ({ page, context }) => {
  await recordNotifications(context);
  scenario('slow');
  await page.evaluate(() => {
    document.querySelector('ytm-toolbar').__marker = 'same-host';
  });
  await openPanel(page, 'video');
  await page.waitForSelector('ytm-toolbar .ytm-quality-row');
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="18"]').click();
  const before = await waitJob(page, (j) => j.state === 'downloading' && /%/.test(j.details));
  const ringBefore = await buttonProgress(page, 'video');
  await setUiLanguage(context, 'zh_TW');
  await sleep(800);
  const rows = await jobRows(page);
  const after = rows.find((j) => j.id === before?.id);
  const state = await inToolbar(
    page,
    `return { panel: root.querySelector('.ytm-panel-title')?.textContent, sameHost: document.querySelectorAll('ytm-toolbar').length === 1 && document.querySelector('ytm-toolbar').__marker === 'same-host', ring: root.querySelector('.ytm-btn[data-button="video"]').dataset.progress ?? null }`,
  );
  check(
    'T36：下載中切換語言，進度與面板狀態不變，文字換成新語言（007 驗收 2、NFR-1）',
    !!before && after?.state === 'downloading' && after.stateText === '下載中' && after.buttons.includes('取消') && state.panel === '下載影片' && state.sameHost && ringBefore !== null && state.ring !== null,
    JSON.stringify({ before: before?.stateText, after: after && { state: after.state, text: after.stateText, buttons: after.buttons }, ...state }),
  );
  await shot(page, 'T35-download-zh-TW-switched.png');
  // 取消後改為一般下載，確認完成通知的語言
  await page.locator(`ytm-toolbar .ytm-job[data-job="${before?.id}"] .ytm-job-foot button`).click();
  await sleep(1500);
  scenario('ok');
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="136+140"]').click();
  const done = await waitJob(page, (j) => j.state === 'done' && j.id !== before?.id);
  await sleep(500);
  const n = await notes(context);
  const note = n.find((x) => x.id === `ytm-job:${done?.id}`);
  check('T36：下載完成的通知使用所選語言（007 FR-3、驗收 4）', note?.title === '下載完成', JSON.stringify(note));
  // 錯誤訊息依錯誤代碼轉成所選語言（007 FR-7）
  scenario('network');
  await page.locator('ytm-toolbar .ytm-quality-row[data-format="18"]').click();
  const failed = await waitJob(page, (j) => j.state === 'failed', 10_000);
  check('T36：錯誤訊息依錯誤代碼以所選語言顯示，不顯示 yt-dlp 的原始訊息（007 FR-7）', failed?.errorText === '網路連線問題，請重試。' && !/urlopen|ERROR/.test(failed.errorText), failed?.errorText);
  await sleep(500);
  const failNote = (await notes(context)).find((x) => x.id === `ytm-job:${failed?.id}`);
  check('T36：失敗通知使用所選語言', failNote?.title === '下載失敗' && /網路連線問題/.test(failNote.message), JSON.stringify(failNote));
  // 切回英文
  await setUiLanguage(context, 'en');
  await sleep(800);
  const en = (await jobRows(page)).find((j) => j.id === done?.id);
  check('T36：切回英文後工作清單文字為英文', en?.stateText === 'Done' && en.buttons.includes('Show file'), JSON.stringify(en));
  scenario('ok');
});

// ===========================================================================
// 繁體中文介面
// ===========================================================================
await session(
  'zh',
  async ({ page }) => {
    scenario('network');
    await openPanel(page, 'video');
    await page.waitForSelector('ytm-toolbar .ytm-quality-row, ytm-toolbar .ytm-job-error', { timeout: 10_000 });
    const text = await panelText(page);
    check('T22：繁體中文的錯誤訊息（NFR-4）', text.includes('網路連線問題，請重試。') && text.includes('重試'), text.slice(0, 160));
    await shot(page, 'T22-error-zh-TW.png');
    scenario('ok');
    await page.locator('ytm-toolbar .ytm-job-error button').click();
    await page.waitForSelector('ytm-toolbar .ytm-quality-row', { timeout: 10_000 });
    await page.locator('ytm-toolbar .ytm-more-formats').click();
    await shot(page, 'T19-video-panel-zh-TW.png');
    check('T19：繁體中文的「只顯示 MP4」', (await panelText(page)).includes('只顯示 MP4'));
    await page.goto(`chrome-extension://${EXT_ID}/options.html`);
    await page.waitForFunction(() => document.querySelector('#downloads-groups .status-row[data-component="deno"]')?.dataset.ok === 'true', null, { timeout: 10_000 });
    const legends = await page.evaluate(() => [...document.querySelectorAll('#downloads-groups legend')].map((l) => l.textContent));
    check('T23：繁體中文的設定頁下載區', legends.join('|') === '連線狀態|更新|移除下載功能|下載資料夾|下載的檔案', legends.join('|'));
    const box = await page.locator('#downloads').boundingBox();
    await page.screenshot({ path: join(shots, 'T23-options-downloads-zh-TW.png'), clip: { x: 0, y: box.y - 16, width: 1280, height: box.height + 32 }, fullPage: true });
  },
  { lang: 'zh-TW' },
);

skip('點擊系統通知（headless 無法點擊）', '改以「Show file」按鈕與橋接程式記錄檔確認 reveal 指令；onNotificationClicked 只對完成的工作送出 reveal');
if (!summary()) process.exitCode = 1;
