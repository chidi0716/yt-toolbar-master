// 交叉編譯橋接程式（plan 4.8）：npm run build:host
//
// 產出 host/dist/ 下的單一執行檔：
//   yte-host-darwin-arm64、yte-host-darwin-amd64、yte-host-windows-amd64.exe
// 並組出「手動安裝」用的資料夾（008 FR-16；執行檔＋安裝／解除安裝腳本，
// 原生訊息設定檔由小幫手的 --install --offline 寫入）：
//   yt-toolbar-master-host-macos/、yt-toolbar-master-host-windows/
// 以 Node 撰寫，在 macOS、Windows、Linux 上都能執行；需要已安裝 Go。
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hostDir = dirname(fileURLToPath(import.meta.url));
const repoDir = join(hostDir, '..');
const installDir = join(repoDir, 'install');
const distDir = join(hostDir, 'dist');
const { version } = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));

const targets = [
  { goos: 'darwin', goarch: 'arm64' },
  { goos: 'darwin', goarch: 'amd64' },
  { goos: 'windows', goarch: 'amd64' },
];

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const binaryName = ({ goos, goarch }) => `yte-host-${goos}-${goarch}${goos === 'windows' ? '.exe' : ''}`;

const ldflags = `-s -w -X main.version=${version}`;

for (const target of targets) {
  const out = join(distDir, binaryName(target));
  console.log(`building ${target.goos}/${target.goarch} -> ${out}`);
  execFileSync(
    'go',
    ['build', '-trimpath', '-ldflags', ldflags, '-o', out, './cmd/yte-host'],
    {
      cwd: hostDir,
      stdio: 'inherit',
      // GOTOOLCHAIN=local：只用已安裝的 Go，不自動下載其他版本。
      env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: '0', GOTOOLCHAIN: 'local' },
    },
  );
}

const packages = [
  {
    name: 'yt-toolbar-master-host-macos',
    os: 'darwin',
    scripts: [join('macos', 'install.sh'), join('macos', 'uninstall.sh')],
  },
  {
    name: 'yt-toolbar-master-host-windows',
    os: 'windows',
    scripts: [join('windows', 'install.ps1'), join('windows', 'uninstall.ps1')],
  },
];

for (const pkg of packages) {
  const dir = join(distDir, pkg.name);
  mkdirSync(dir, { recursive: true });
  for (const target of targets.filter((t) => t.goos === pkg.os)) {
    copyFileSync(join(distDir, binaryName(target)), join(dir, binaryName(target)));
  }
  for (const script of pkg.scripts) {
    const dest = join(dir, script.split(/[\\/]/).pop());
    copyFileSync(join(installDir, script), dest);
    if (dest.endsWith('.sh')) chmodSync(dest, 0o755);
  }
  console.log(`package -> ${dir}`);
}
