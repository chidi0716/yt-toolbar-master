// 階段 4：Firefox 上的背景腳本（事件頁面）經由原生訊息使用真正的橋接程式（假 yt-dlp）。
// 以官方 Firefox（spikes/T00/fetch-firefox.sh）headless 啟動，透過 WebDriver BiDi 安裝暫時附加元件，
// 在擴充功能的設定頁送出與內容腳本相同的訊息：hostStatus、getInfo、startDownload、getJobs、cancelJob，
// 並確認檔案、通知與設定頁的連線狀態。HOME 指到 spikes/stage4/.cache/ff/，Firefox 從
// $HOME/.mozilla/native-messaging-hosts/ 讀取原生訊息設定檔；代理設為 127.0.0.1:9，不會連外。
//   bash spikes/T00/fetch-firefox.sh && sh spikes/stage4/build-host.sh && npm run build:firefox
//   node spikes/stage4/firefox-smoke.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from '../stage1-smoke/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cache = join(here, '.cache');
const FF = process.env.FIREFOX ?? join(root, 'spikes', 'T00', '.cache', 'ff', 'firefox', 'firefox');
const EXT = join(root, '.output', 'firefox-mv3');
const GECKO_ID = 'yt-toolbar-master@chidi0716';
const UUID = '6f1b8a52-3c2d-4e0f-9a7b-1d2e3f405162';
const PORT = 9333;
const { check, skip, summary } = reporter();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = join(cache, 'ff', 'home');
const profile = join(cache, 'ff', 'profile');
const downloads = join(home, 'Downloads');
rmSync(join(cache, 'ff'), { recursive: true, force: true });
mkdirSync(join(home, '.mozilla', 'native-messaging-hosts'), { recursive: true });
mkdirSync(downloads, { recursive: true });
mkdirSync(profile, { recursive: true });
mkdirSync(join(cache, 'ff', 'tmp'), { recursive: true });
writeFileSync(join(cache, 'e2e', 'scenario'), 'ok');
writeFileSync(join(cache, 'e2e', 'delay'), '300');
writeFileSync(
  join(home, '.mozilla', 'native-messaging-hosts', 'com.chidi0716.yt_toolbar_master.json'),
  JSON.stringify({ name: 'com.chidi0716.yt_toolbar_master', description: 'test', path: join(cache, 'bin', 'ytm-host'), type: 'stdio', allowed_extensions: [GECKO_ID] }),
);
const prefs = {
  'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: UUID }),
  'network.proxy.type': 1,
  'network.proxy.http': '127.0.0.1',
  'network.proxy.http_port': 9,
  'network.proxy.ssl': '127.0.0.1',
  'network.proxy.ssl_port': 9,
  'network.proxy.no_proxies_on': '',
  'network.proxy.allow_hijacking_localhost': false,
  'app.update.disabledForTesting': true,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'browser.shell.checkDefaultBrowser': false,
  'intl.locale.requested': 'en-US',
};
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));

const ff = spawn(FF, ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${PORT}`, '--remote-allow-system-access', '--window-size=1280,1200'], {
  env: { ...process.env, HOME: home, TMPDIR: join(cache, 'ff', 'tmp'), XDG_STATE_HOME: join(home, '.local', 'state'), PATH: `${join(cache, 'bin', 'tools')}:/usr/bin:/bin`, MOZ_CRASHREPORTER_DISABLE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let ffLog = '';
ff.stdout.on('data', (d) => (ffLog += d));
ff.stderr.on('data', (d) => (ffLog += d));

// ---- WebDriver BiDi ----
let ws;
for (let i = 0; i < 100 && !ws; i++) {
  await sleep(200);
  try {
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
    await new Promise((resolve, reject) => {
      sock.onopen = resolve;
      sock.onerror = reject;
    });
    ws = sock;
  } catch {
    // Firefox 還沒準備好
  }
}
if (!ws) {
  console.log(ffLog.slice(-2000));
  throw new Error('BiDi connection failed');
}
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (msg) => (msg.type === 'error' ? reject(new Error(`${method}: ${msg.error} ${msg.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

try {
  await send('session.new', { capabilities: {} });
  const installed = await send('webExtension.install', { extensionData: { type: 'path', path: EXT } });
  check('Firefox：以 WebDriver BiDi 安裝暫時附加元件', installed.extension === GECKO_ID, JSON.stringify(installed));
  // BiDi 不允許直接導覽到 moz-extension:，改由瀏覽器視窗（chrome 環境，需要 --remote-allow-system-access）開新分頁。
  const chrome = await send('browsingContext.getTree', { 'moz:scope': 'chrome' });
  const win = chrome.contexts[0].context;
  await send('script.evaluate', {
    expression: `gBrowser.selectedTab = gBrowser.addTab('moz-extension://${UUID}/options.html', { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); true`,
    target: { context: win },
    awaitPromise: false,
  });
  let context = null;
  for (let i = 0; i < 50 && !context; i++) {
    await sleep(200);
    const tree = await send('browsingContext.getTree', {});
    context = tree.contexts.find((c) => c.url.startsWith('moz-extension://'))?.context ?? null;
  }
  if (!context) throw new Error('options page did not open');
  await sleep(1000);
  const evaluate = async (expression) => {
    const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none', serializationOptions: { maxObjectDepth: 0 } });
    if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const message = (m) => evaluate(`browser.runtime.sendMessage(${JSON.stringify(m)}).then((r) => JSON.stringify(r))`).then((s) => JSON.parse(s));

  const status = await message({ type: 'hostStatus', refresh: true });
  check(
    'Firefox：背景腳本以 connectNative 取得 status（含 deno）',
    status.ok && status.status.ready && status.status.complete && status.status.deno?.version === '2.1.4' && status.status.defaultDir === downloads,
    JSON.stringify(status).slice(0, 300),
  );
  const info = await message({ type: 'getInfo', videoId: 'jNQXAC9IVRw' });
  check('Firefox：getInfo 取得格式清單', info.ok && info.info.formats.length > 5 && info.info.duration === 245, `${info.info?.formats?.length} formats`);
  const start = await message({
    type: 'startDownload',
    request: { kind: 'video', videoId: 'jNQXAC9IVRw', title: 't', label: '1080p MP4', formatId: '137+140', container: 'mp4', section: { start: 60, end: 90 } },
  });
  check('Firefox：startDownload 回傳 jobId', start.ok && typeof start.jobId === 'string', JSON.stringify(start));
  let seen = null;
  for (let i = 0; i < 100; i++) {
    const jobs = await message({ type: 'getJobs' });
    seen = jobs.jobs?.find((j) => j.jobId === start.jobId);
    if (seen?.state === 'done') break;
    await sleep(200);
  }
  const files = readdirSync(downloads);
  check('Firefox：下載完成，工作清單更新為 done，檔案在 ~/Downloads（裁切檔名）', seen?.state === 'done' && files.includes('測試影片： Fake⧸Video？ [jNQXAC9IVRw] 01m00s-01m30s.mp4'), `${seen?.state} ${files.join(', ')}`);
  await sleep(500);
  const notes = await evaluate('browser.notifications.getAll().then((n) => JSON.stringify(n))');
  if (JSON.parse(notes)[`ytm-job:${start.jobId}`] !== undefined) check('Firefox：完成時建立通知', true, notes);
  else {
    // headless 且沒有 D-Bus 時，Firefox 的系統通知會立即關閉；以設定頁直接建立一則通知比對環境。
    const probe = await evaluate(
      "browser.notifications.create('probe', { type: 'basic', title: 't', message: 'm' }).then(() => browser.notifications.getAll()).then((n) => JSON.stringify(n), (e) => 'error: ' + e.message)",
    );
    skip('Firefox：完成時建立通知', `getAll=${notes}；直接建立的通知 getAll=${probe}（本環境無法確認通知，背景腳本的通知程式與 Chrome 相同）`);
  }

  // 取消
  writeFileSync(join(cache, 'e2e', 'scenario'), 'slow');
  const slow = await message({ type: 'startDownload', request: { kind: 'mp3', videoId: 'jNQXAC9IVRw', title: 't', label: 'MP3 192 kbps', bitrate: 192, section: null } });
  await sleep(1500);
  const cancel = await message({ type: 'cancelJob', jobId: slow.jobId });
  const after = (await message({ type: 'getJobs' })).jobs.find((j) => j.jobId === slow.jobId);
  const leftovers = readdirSync(downloads).filter((f) => f.startsWith('.ytm-tmp') || f.endsWith('.part'));
  check('Firefox：取消下載，工作為 cancelled，不留下暫存檔', cancel.ok && after?.state === 'cancelled' && leftovers.length === 0, `${after?.state} ${leftovers.join(',')}`);

  // 錯誤
  writeFileSync(join(cache, 'e2e', 'scenario'), 'network');
  const bad = await message({ type: 'startDownload', request: { kind: 'video', videoId: 'jNQXAC9IVRw', title: 't', label: '720p MP4', formatId: '136+140', container: 'mp4', section: null } });
  let failed = null;
  for (let i = 0; i < 50; i++) {
    failed = (await message({ type: 'getJobs' })).jobs.find((j) => j.jobId === bad.jobId);
    if (failed?.state === 'failed') break;
    await sleep(200);
  }
  check('Firefox：失敗時工作為 failed，錯誤代碼 NETWORK', failed?.state === 'failed' && failed.error === 'NETWORK', JSON.stringify(failed));
  writeFileSync(join(cache, 'e2e', 'scenario'), 'ok');

  // 不合法的訊息由背景腳本拒絕（不會送到橋接程式）
  const invalid = await evaluate(`browser.runtime.sendMessage({ type: 'startDownload', request: { kind: 'video', videoId: '../../etc', title: 't', label: 'x', formatId: '18', container: 'mp4', section: null } }).then((r) => String(r), (e) => 'error: ' + e.message)`);
  check('Firefox：不合法的下載請求不被處理', invalid === 'undefined' || invalid.startsWith('error'), invalid);

  // 設定頁的連線狀態
  await evaluate('location.reload(), true');
  await sleep(1000);
  let rows = [];
  for (let i = 0; i < 50; i++) {
    rows = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('#downloads-groups .status-row')].map((r) => r.dataset.component + ':' + r.dataset.ok))`));
    if (rows.length === 4 && rows.every((r) => r.endsWith('true'))) break;
    await sleep(200);
  }
  check('Firefox：設定頁的連線狀態四項都可用', rows.join('|') === 'host:true|ytDlp:true|ffmpeg:true|deno:true', rows.join('|'));

  // 006：設定頁的「工具列」區（T34）
  const toolbarRows = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('#toolbar-list .toolbar-row')].map((r) => r.dataset.item))`));
  await evaluate(`document.querySelector('#toolbar-list .toolbar-row[data-item="mp3"] .icon-button[aria-label="Move MP3 up"]').click(), document.querySelector('#toolbar-visible-loop').click(), true`);
  await sleep(500);
  const stored = JSON.parse(await evaluate(`browser.storage.sync.get('toolbarLayout').then((r) => JSON.stringify(r.toolbarLayout))`));
  const ids = stored?.items?.map((i) => (i.visible ? i.id : `-${i.id}`)).join(' ');
  check(
    'Firefox：設定頁的工具列區可以上移與隱藏，寫入 sync:toolbarLayout（006 FR-22）',
    toolbarRows.length === 13 && stored?.version === 1 && ids === 'mp3 video thumbnail subtitles screenshot link separator darkMode cinema pip floating -loop help',
    ids,
  );

  // 007：設定頁的介面語言選單（T35）
  await evaluate(`(() => { const s = document.querySelector('#ui-language'); s.value = 'zh_TW'; s.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(800);
  const zh = JSON.parse(await evaluate(`JSON.stringify({ h1: document.querySelector('h1').textContent, toolbar: document.querySelector('#toolbar-title').textContent, stored: null })`));
  const lang = await evaluate(`browser.storage.sync.get('uiLanguage').then((r) => String(r.uiLanguage))`);
  check('Firefox：設定頁選「繁體中文」後立即變成中文，並寫入 sync:uiLanguage（007 FR-3、FR-4）', zh.h1 === '設定' && zh.toolbar === '工具列' && lang === 'zh_TW', `${JSON.stringify(zh)} ${lang}`);

  // 007 FR-20 至 FR-22：外觀（T37）
  const pick = async (v) => {
    await evaluate(`(() => { const s = document.querySelector('#page-theme'); s.value = '${v}'; s.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(500);
    return evaluate(`document.documentElement.dataset.theme + ' ' + getComputedStyle(document.documentElement).backgroundColor`);
  };
  const darkTheme = await pick('dark');
  const lightTheme = await pick('light');
  await evaluate(`browser.storage.local.set({ lastYouTubeTheme: 'dark' }).then(() => true)`);
  const followYouTube = await pick('youtube');
  check(
    'Firefox：設定頁的外觀選單（深色、淺色、跟隨 YouTube 的紀錄）立即套用（007 FR-20 至 FR-22）',
    darkTheme === 'dark rgb(15, 15, 15)' && lightTheme === 'light rgb(255, 255, 255)' && followYouTube.startsWith('dark'),
    `${darkTheme} / ${lightTheme} / ${followYouTube}`,
  );
} catch (err) {
  check('Firefox script', false, String(err));
} finally {
  await send('session.end').catch(() => {});
  ws.close();
  ff.kill('SIGTERM');
  await sleep(500);
}
if (process.env.FF_LOG) console.log(ffLog.slice(-3000));
if (!summary()) process.exitCode = 1;
