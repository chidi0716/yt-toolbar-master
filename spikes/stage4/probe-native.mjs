// 階段 4：確認 Playwright 的 Chromium 能否透過原生訊息啟動工作目錄內編譯的橋接程式（spikes/stage4/build-host.sh）。
// 原生訊息設定檔放在 --user-data-dir（Playwright 的持久設定檔資料夾）中的 NativeMessagingHosts/；
// 橋接程式的家目錄（狀態、記錄檔、預設下載資料夾）以 HOME 指到 spikes/stage4/.cache/home。
//   node spikes/stage4/probe-native.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cache = join(here, '.cache');
const profile = join(cache, 'profile-probe');
const home = join(cache, 'home-probe');
rmSync(profile, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
mkdirSync(join(profile, 'NativeMessagingHosts'), { recursive: true });
mkdirSync(join(home, 'Downloads'), { recursive: true });
writeFileSync(
  join(profile, 'NativeMessagingHosts', 'com.chidi0716.yt_toolbar_master.json'),
  JSON.stringify({
    name: 'com.chidi0716.yt_toolbar_master',
    description: 'test',
    path: join(cache, 'bin', 'ytm-host'),
    type: 'stdio',
    allowed_origins: ['chrome-extension://bkjlangdjfpllnkcpfpdlajchbginjdj/'],
  }),
);
const extDir = join(root, '.output', 'chrome-mv3');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  env: { ...process.env, HOME: home, XDG_STATE_HOME: join(home, '.local', 'state'), PATH: `${join(cache, 'bin', 'tools')}:/usr/bin:/bin` },
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
});
const page = await context.newPage();
await page.goto('chrome-extension://bkjlangdjfpllnkcpfpdlajchbginjdj/options.html');
const res = await page.evaluate(
  () =>
    new Promise((resolve) => {
      try {
        const port = chrome.runtime.connectNative('com.chidi0716.yt_toolbar_master');
        const out = [];
        port.onMessage.addListener((m) => {
          out.push(m);
          if (out.length === 2) resolve(out);
        });
        port.onDisconnect.addListener(() => resolve({ disconnected: chrome.runtime.lastError?.message, out }));
        port.postMessage({ id: '1', cmd: 'status' });
        port.postMessage({ id: '2', cmd: 'getInfo', args: { videoId: 'jNQXAC9IVRw' } });
      } catch (e) {
        resolve({ error: String(e) });
      }
    }),
);
console.log(JSON.stringify(res, null, 1).slice(0, 3000));
await context.close();
