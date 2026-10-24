// T26／T47 的自動檢查（constitution 第 2、4 點，plan 3.2、3.9）：
// - 權限與主機權限與 plan 3.2 完全一致（新版本提醒不新增任何權限；009 只新增 contextMenus）；
// - GitHub API 的網址只能出現在 utils/update-check.ts；
// - 新版本提醒以外，擴充功能的程式不連到 GitHub。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../wxt.config';

const root = new URL('..', import.meta.url).pathname;

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|html|css|json|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
    }
  };
  for (const dir of ['entrypoints', 'components', 'features', 'utils', 'public']) walk(join(root, dir));
  files.push(join(root, 'wxt.config.ts'));
  return files.map((f) => relative(root, f));
}

type ManifestFn = (env: { browser: string; manifestVersion: number; mode: string; command: string }) => Record<string, unknown>;

describe('權限（plan 3.2、constitution 第 4 點）', () => {
  for (const browser of ['chrome', 'firefox']) {
    it(`${browser}：permissions 與 host_permissions 與 plan 3.2 完全一致`, () => {
      const manifest = (config.manifest as ManifestFn)({ browser, manifestVersion: 3, mode: 'production', command: 'build' });
      expect(manifest.permissions).toEqual(['storage', 'downloads', 'notifications', 'nativeMessaging', 'contextMenus']);
      expect(manifest.host_permissions).toEqual(['*://*.youtube.com/*', 'https://i.ytimg.com/*']);
      expect(manifest).not.toHaveProperty('optional_permissions');
      expect(manifest).not.toHaveProperty('optional_host_permissions');
      // Firefox 的 update_url 是瀏覽器自己的更新檢查（plan 4.10），不是擴充功能的連線，先取出另外檢查。
      const gecko = (manifest.browser_specific_settings as { gecko?: Record<string, unknown> } | undefined)?.gecko;
      if (browser === 'firefox') {
        expect(gecko?.update_url).toBe('https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/updates.json');
      }
      const rest = JSON.parse(JSON.stringify(manifest));
      delete rest.browser_specific_settings?.gecko?.update_url;
      expect(JSON.stringify(rest)).not.toMatch(/github|management|<all_urls>|"tabs"|scripting|webRequest|cookies/);
    });
  }
});

describe('contextMenus（plan 3.2、009 第三節）', () => {
  it('只有 features/downloads/context-menu.ts 使用右鍵選單 API', () => {
    const hits = sourceFiles().filter((f) => /\b(contextMenus|menus)\.(create|update|remove|removeAll|onClicked)\b/.test(readFileSync(join(root, f), 'utf8')));
    expect(hits).toEqual(['features/downloads/context-menu.ts']);
  });

  it('選單只出現在 YouTube 頁面的影片連結上', () => {
    const source = readFileSync(join(root, 'features/downloads/context-menu.ts'), 'utf8');
    expect(source).toContain("documentUrlPatterns: ['*://*.youtube.com/*']");
    expect(source).toContain("targetUrlPatterns: ['*://*.youtube.com/watch*', '*://*.youtube.com/shorts/*', '*://youtu.be/*']");
    expect(source).not.toMatch(/<all_urls>|contexts:\s*\[[^\]]*'(all|page|selection)'/);
  });
});

describe('連線範圍（constitution 第 2 點、plan 3.9）', () => {
  it('api.github.com 只出現在 utils/update-check.ts', () => {
    const hits = sourceFiles().filter((f) => readFileSync(join(root, f), 'utf8').includes('api.github.com'));
    expect(hits).toEqual(['utils/update-check.ts']);
  });

  it('只有 update-check.ts 以 fetch 讀取 GitHub；其他 GitHub 網址只是給使用者的連結或指令', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const source = readFileSync(join(root, f), 'utf8');
      if (f === 'utils/update-check.ts') continue;
      // fetch( 後面直接接 GitHub 網址，或同一個檔案同時 fetch 與 github.com 的網址常數。
      if (/fetch\([^)]*github/i.test(source)) offenders.push(f);
      if (/\bfetch\(/.test(source) && /https:\/\/(?:[a-z.]*\.)?github(?:usercontent)?\.com/.test(source)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
