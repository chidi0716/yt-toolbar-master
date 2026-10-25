// 產生 GitHub Release 的所有檔案（plan 4.10、008 FR-50 至 FR-52）。
//
//   npm run release:dry          在本機完成發佈流程的第 1、3、4、5 步（測試、建置小幫手、產生
//                                components.json、預覽 updates.json），不需要任何 Secret 與網路；
//                                Firefox 版不送簽署。
//   node scripts/release.mjs --tag vX.Y.Z
//                                GitHub Actions 使用（.github/workflows/release.yml）：lock 檔與官方
//                                檢查碼及實際下載的檔案比對；有 Mozilla 金鑰（WEB_EXT_API_KEY／SECRET）
//                                且不是預先發行版本時，Firefox 版以 web-ext sign 送 Mozilla 簽署。
//
// 本專案不使用自己的簽章金鑰（008 FR-51）：components.json 列出每個檔案的 SHA256，只從本專案
// GitHub 以 HTTPS 取得。
//
// 沒有 Mozilla 金鑰（或預先發行版本、試跑）時照常完成（008 FR-52）：附上未簽署的
// yt-toolbar-master-<版本>-firefox-temporary.zip，不產生 updates.json，Release 說明加註。
//
// 輸出：release/dist/upload/（要附加到 Release 的檔案）與 release/dist/release-notes.md。
// 選項：--skip-tests（GitHub Actions 已在前一步執行測試）。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toAsciiPowerShell } from './ps1-ascii.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hostDir = join(root, 'host');
const distDir = join(root, 'release', 'dist');
const uploadDir = join(distDir, 'upload');
const toolsDir = join(distDir, '.tools');

const REPO = 'chidi0716/yt-toolbar-master';
const GECKO_ID = 'yt-toolbar-master@chidi0716';

// ---- 參數 ----
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const skipTests = argv.includes('--skip-tests');
const tagIndex = argv.indexOf('--tag');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = tagIndex >= 0 ? argv[tagIndex + 1] : `v${version}`;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail(`package.json version ${version} is not x.y.z`);
if (tag !== `v${version}`) fail(`tag ${tag} does not match package.json version ${version} (expected v${version})`);
const prerelease = version.includes('-');
const hasMozillaKeys = Boolean(process.env.WEB_EXT_API_KEY && process.env.WEB_EXT_API_SECRET);

// Firefox 版是否送 Mozilla 簽署，以及不簽署的原因（印在記錄中）。
let unsignedReason = '';
if (dry) unsignedReason = 'dry run';
else if (prerelease) unsignedReason = 'prerelease (AMO signs each version number only once, plan 4.10)';
else if (!hasMozillaKeys) unsignedReason = 'AMO_JWT_ISSUER / AMO_JWT_SECRET are not set (008 FR-52)';
const signFirefox = unsignedReason === '';

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function step(title) {
  console.log(`\n=== ${title}`);
}

const isWindows = process.platform === 'win32';
function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWindows && (cmd === 'npm' || cmd === 'npx'),
    ...opts,
    env: { ...process.env, GOTOOLCHAIN: 'local', ...(opts.env ?? {}) },
  });
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// ---- 準備 ----
rmSync(distDir, { recursive: true, force: true });
mkdirSync(uploadDir, { recursive: true });
mkdirSync(toolsDir, { recursive: true });

// 第 1 步：測試
if (!skipTests) {
  step('1. tests');
  run('npm', ['test']);
  run('npm', ['run', 'compile']);
  run('go', ['test', './...'], { cwd: hostDir });
}

const ytmRelease = join(toolsDir, isWindows ? 'ytm-release.exe' : 'ytm-release');
run('go', ['build', '-o', ytmRelease, './cmd/ytm-release'], { cwd: hostDir });
const lockPath = join(root, 'release', 'components.lock.json');

// lock 檔：正式發佈時下載每個檔案，與 lock 記錄的 SHA256 及官方檢查碼比對。
step('2. third-party components (release/components.lock.json)');
run(ytmRelease, ['lock-check', '-lock', lockPath, ...(dry ? [] : ['-download'])]);
if (dry) console.log('(dry run: not comparing with the official checksum files; the release workflow does)');

// 第 3 步：三種小幫手與手動安裝的資料夾
step('3. helper builds');
run('node', [join(hostDir, 'build.mjs')]);
const hostDist = join(hostDir, 'dist');
for (const name of ['ytm-host-darwin-arm64', 'ytm-host-darwin-amd64', 'ytm-host-windows-amd64.exe']) {
  copyFileSync(join(hostDist, name), join(uploadDir, name));
  chmodSync(join(uploadDir, name), 0o755);
}
for (const pkg of ['yt-toolbar-master-host-macos', 'yt-toolbar-master-host-windows']) {
  run(ytmRelease, ['zip', '-dir', join(hostDist, pkg), '-out', join(uploadDir, `${pkg}.zip`)]);
}

// 第 4 步：components.json（每個檔案的網址與 SHA256）
step('4. components.json');
const manifestPath = join(uploadDir, 'components.json');
run(ytmRelease, ['manifest', '-lock', lockPath, '-version', version, '-tag', tag, '-helpers', uploadDir, '-out', manifestPath]);
run(ytmRelease, ['check', '-in', manifestPath]);

// 引導腳本與移除腳本
step('5. install and uninstall scripts');
writeScript('install/bootstrap/install.sh', 'install.sh');
writeScript('install/bootstrap/install.ps1', 'install.ps1');
writeScript('install/macos/uninstall.sh', 'uninstall.sh');
writeScript('install/windows/uninstall.ps1', 'uninstall.ps1');

// 擴充功能
step('6. extension packages');
run('npm', ['run', 'zip']);
copyFileSync(findOutput(`-${version}-chrome.zip`), join(uploadDir, `yt-toolbar-master-${version}-chrome.zip`));
const xpiName = `yt-toolbar-master-${version}-firefox.xpi`;
const temporaryName = `yt-toolbar-master-${version}-firefox-temporary.zip`;
// web-ext lint：自行發佈（manifest 有 update_url），以 --self-hosted 檢查；有錯誤時停止。
const lintFirefox = () =>
  run('npx', ['web-ext', 'lint', '--self-hosted', '--source-dir', join(root, '.output', 'firefox-mv3')]);
if (signFirefox) {
  run('npm', ['run', 'build:firefox']);
  lintFirefox();
  run('node', [join(root, 'scripts', 'sign-firefox.mjs')]);
  const signedDir = join(root, '.output', 'firefox-signed');
  const xpis = readdirSync(signedDir)
    .filter((f) => f.endsWith('.xpi'))
    .map((f) => join(signedDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!xpis.length) fail('web-ext sign did not produce an .xpi');
  copyFileSync(xpis[0], join(uploadDir, xpiName));
} else {
  run('npm', ['run', 'zip:firefox']);
  lintFirefox();
  copyFileSync(findOutput(`-${version}-firefox.zip`), join(uploadDir, temporaryName));
  console.log(`(the Firefox package is NOT signed by Mozilla: ${unsignedReason}; attached as ${temporaryName})`);
}

// 第 5 步：Firefox 的更新資訊，只在有簽署的 .xpi 時附上。版本號使用建置出的 manifest 中的版本
// （WXT 會把預先發行標記從 manifest 的 version 去掉），必須與 .xpi 中的版本完全相同。
// 試跑時寫到 release/dist/updates.preview.json（不附加），確認產生方式正確。
step('7. updates.json');
if (signFirefox || dry) {
  const firefoxManifest = JSON.parse(readFileSync(join(root, '.output', 'firefox-mv3', 'manifest.json'), 'utf8'));
  const gecko = firefoxManifest.browser_specific_settings?.gecko ?? {};
  if (gecko.id !== GECKO_ID || gecko.update_url !== `https://github.com/${REPO}/releases/latest/download/updates.json`) {
    fail('the Firefox manifest does not have the expected gecko id and update_url');
  }
  const pkg = join(uploadDir, signFirefox ? xpiName : temporaryName);
  const updates = {
    addons: {
      [GECKO_ID]: {
        updates: [
          {
            version: firefoxManifest.version,
            update_link: `https://github.com/${REPO}/releases/download/${tag}/${xpiName}`,
            update_hash: `sha256:${sha256(pkg)}`,
            update_info_url: `https://github.com/${REPO}/releases/tag/${tag}`,
            applications: { gecko: { strict_min_version: gecko.strict_min_version } },
          },
        ],
      },
    },
  };
  const out = signFirefox ? join(uploadDir, 'updates.json') : join(distDir, 'updates.preview.json');
  writeFileSync(out, `${JSON.stringify(updates, null, 2)}\n`);
  if (!signFirefox) console.log(`(dry run: preview written to ${out}; not attached)`);
} else {
  console.log('(no signed Firefox package: no updates.json, 008 FR-52)');
}

// Release 說明與 SHA256SUMS
step('8. release notes and SHA256SUMS');
const notesTemplate = readFileSync(join(root, 'release', 'notes-template.md'), 'utf8');
const firefoxNotes = signFirefox ? firefoxSignedNotes() : firefoxUnsignedNotes();
// 選用的版本說明 release/notes/<tag>.md：第一行「title: …」為 Release 標題，其後以 <!-- en -->、<!-- zh --> 分成兩種語言。
const highlightsPath = join(root, 'release', 'notes', `${tag}.md`);
const highlights = { title: tag, en: '', zh: '' };
if (existsSync(highlightsPath)) {
  const text = readFileSync(highlightsPath, 'utf8');
  const title = /^title:\s*(.+)$/m.exec(text);
  if (title) highlights.title = title[1].trim();
  const en = /<!-- en -->\n([\s\S]*?)(?=<!-- zh -->|$)/.exec(text);
  const zh = /<!-- zh -->\n([\s\S]*)$/.exec(text);
  highlights.en = en ? `${en[1].trim()}\n` : '';
  highlights.zh = zh ? `${zh[1].trim()}\n` : '';
}
writeFileSync(join(distDir, 'release-title.txt'), `${highlights.title}\n`);
const notes = notesTemplate
  .replaceAll('{{highlights}}', highlights.en)
  .replaceAll('{{highlightsZh}}', highlights.zh)
  .replaceAll('{{firefoxSteps}}', firefoxNotes.en)
  .replaceAll('{{firefoxStepsZh}}', firefoxNotes.zh)
  .replaceAll('{{firefoxFiles}}', firefoxNotes.files)
  .replaceAll('{{version}}', version)
  .replaceAll('{{tag}}', tag);
if (/\{\{\w+\}\}/.test(notes)) fail('unknown placeholder in release/notes-template.md');
writeFileSync(join(distDir, 'release-notes.md'), notes);
const files = readdirSync(uploadDir).filter((f) => f !== 'SHA256SUMS').sort();
writeFileSync(join(uploadDir, 'SHA256SUMS'), files.map((f) => `${sha256(join(uploadDir, f))}  ${f}\n`).join(''));

step(dry ? 'dry run finished' : 'release files ready');
for (const f of readdirSync(uploadDir).sort()) {
  console.log(`  ${f.padEnd(48)} ${statSync(join(uploadDir, f)).size} bytes`);
}
console.log(`  release-notes.md (${prerelease ? 'prerelease' : 'release'} ${tag}, Firefox ${signFirefox ? 'signed' : 'unsigned'})`);

/** Firefox 已簽署時的說明（{{version}} 之後再代入）。 */
function firefoxSignedNotes() {
  return {
    en:
      '**Firefox (signed add-on):** updates install automatically. To update now, open `about:addons`, click the gear icon and choose **Check for Updates**.\n' +
      'First install: download `yt-toolbar-master-{{version}}-firefox.xpi` below and open it in Firefox.',
    zh:
      '**Firefox（簽署版）**：會自動更新。想立即更新：開啟 `about:addons`，按齒輪圖示選「檢查更新」。\n' +
      '第一次安裝：下載下方的 `yt-toolbar-master-{{version}}-firefox.xpi`，用 Firefox 開啟。',
    files:
      '| `yt-toolbar-master-{{version}}-firefox.xpi` | Firefox add-on, signed by Mozilla |\n' +
      '| `updates.json` | Firefox update information |',
  };
}

/** Firefox 未簽署時的說明（008 FR-52）。 */
function firefoxUnsignedNotes() {
  return {
    en:
      '**Firefox:** this version is **not signed by Mozilla yet**, so it can only be loaded as a temporary add-on (it is removed when the browser restarts). ' +
      'Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose `yt-toolbar-master-{{version}}-firefox-temporary.zip`.',
    zh:
      '**Firefox**：這個版本**尚未經 Mozilla 簽署**，只能以暫時附加元件載入（瀏覽器重新啟動後會被移除）。' +
      '開啟 `about:debugging#/runtime/this-firefox`，按「載入暫時附加元件」，選擇 `yt-toolbar-master-{{version}}-firefox-temporary.zip`。',
    files: '| `yt-toolbar-master-{{version}}-firefox-temporary.zip` | Firefox add-on, **not signed** (temporary add-on only) |',
  };
}

/** 複製腳本並代入版本標籤；PowerShell 腳本另外轉成 ASCII（scripts/ps1-ascii.mjs）。 */
function writeScript(src, name) {
  let text = readFileSync(join(root, src), 'utf8');
  text = text.replaceAll('@RELEASE_TAG@', tag);
  if (name.endsWith('.ps1')) text = toAsciiPowerShell(text, src);
  if (text.includes('@RELEASE_TAG@')) fail(`${src}: placeholder left`);
  writeFileSync(join(uploadDir, name), text);
  if (name.endsWith('.sh')) chmodSync(join(uploadDir, name), 0o755);
}

function findOutput(suffix) {
  const dir = join(root, '.output');
  const found = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)) : [];
  if (found.length !== 1) fail(`expected one .output/*${suffix}, found ${found.length}`);
  return join(dir, found[0]);
}
