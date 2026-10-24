// 階段 2b、2c（004 第 1、4 節、005 頁面整理）在本機假頁面上的驗收檢查與截圖。
// 假頁面：fixtures/watch.html（＋ stage2c-watch.js 的附加模擬）、home.html、search.html、shorts.html。
//   npm install --no-save playwright-core@1.56.1 && npm run build
//   node spikes/stage1-smoke/convenience-test.mjs            # 全部
//   ONLY=T27 node spikes/stage1-smoke/convenience-test.mjs   # 只跑某個任務
import { EXT_ID, WATCH, button, launch, openWatch, reporter, shot, spaNavigate } from './lib.mjs';

const { check, skip, summary } = reporter();
const only = process.env.ONLY;
const want = (task) => !only || only.split(',').includes(task);

/**
 * 每個任務用一個新的瀏覽器設定檔。options.open 為 false 時不先打開觀看頁；
 * options.permissions 給剪貼簿等權限。
 */
async function section(task, fn, options = {}) {
  if (!want(task)) return;
  console.log(`\n== ${task}`);
  const context = await launch({ name: `conv-${task}`, lang: options.lang, viewport: options.viewport });
  if (options.permissions) await context.grantPermissions(options.permissions, { origin: 'https://www.youtube.com' });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (err) => console.log('  pageerror:', String(err).slice(0, 200)));
  try {
    if (options.open !== false) await openWatch(page, options.url ?? WATCH);
    await fn(page, context);
  } catch (err) {
    check(`${task} script`, false, String(err).split('\n').slice(0, 3).join(' | '));
    const { root } = await import('./lib.mjs');
    await page.screenshot({ path: `${root}/spikes/stage1-smoke/.cache/error-conv-${task}.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

const openMore = async (page) => {
  if ((await page.locator('ytm-toolbar .ytm-more').count()) === 0) await button(page, 'more').click();
  await page.waitForTimeout(200);
};
const fixtureQuality = (page) => page.evaluate(() => window.__fixtureQuality());
const fixtureLog = (page, type) => page.evaluate((type) => window.__fixtureLog.filter((e) => !type || e.type === type), type);

// ---------------------------------------------------------------------------
// T27 鎖定畫質（004 第 1 節）
// ---------------------------------------------------------------------------
await section('T27', async (page) => {
  const select = page.locator('ytm-toolbar #ytm-more-qualityLock-select');
  await openMore(page);
  const options = await select.locator('option').allInnerTexts();
  check(
    '「更多」面板有鎖定畫質下拉選單，選項依序為關閉、最高、2160p–480p，預設關閉（FR-1）',
    options.join('|') === 'Off (automatic)|Highest available|2160p|1440p|1080p|720p|480p' && (await select.inputValue()) === 'off',
    options.join(', '),
  );
  const before = await fixtureQuality(page);
  check('鎖定關閉時不改變 YouTube 的畫質', before.quality === 'medium' && before.range === null, JSON.stringify(before));

  await select.selectOption('1080');
  await page.waitForTimeout(400);
  const q1 = await fixtureQuality(page);
  check('鎖定 1080p 後，有 4K 的影片切換到 1080p（FR-2）', q1.quality === 'hd1080' && q1.range?.join() === 'hd1080,hd1080', JSON.stringify(q1));
  check('面板中顯示目前選擇的畫質（FR-6）', (await select.inputValue()) === '1080');
  check('「更多」按鈕不顯示開啟狀態（FR-6）', (await button(page, 'more').getAttribute('aria-pressed')) !== 'true');
  await shot(page, 'T27-more-quality-lock.png');
  await page.keyboard.press('Escape');

  // 最高只有 720p 的影片
  await spaNavigate(page, 'next');
  await page.waitForTimeout(600);
  const q2 = await fixtureQuality(page);
  check('換到最高只有 720p 的影片，播放畫質為 720p（FR-2）', q2.quality === 'hd720', JSON.stringify(q2));

  // YouTube 自動改變畫質
  await page.evaluate(() => window.__fixtureAutoQuality('small'));
  await page.waitForTimeout(500);
  const q3 = await fixtureQuality(page);
  const autoLog = (await fixtureLog(page, 'quality')).slice(-2).map((e) => `${e.quality}:${e.source}`);
  check('播放途中 YouTube 自動改變畫質時切回鎖定的畫質（FR-3）', q3.quality === 'hd720', autoLog.join(' → '));

  // 使用者從齒輪手動改成 480p
  await page.locator('#movie_player .ytp-settings-button').click();
  await page.locator('#movie_player .ytp-settings-menu button[data-quality="large"]').click();
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('playing')));
  await page.waitForTimeout(300);
  const q4 = await fixtureQuality(page);
  check('手動在 YouTube 齒輪改成 480p，這部影片維持 480p（FR-4）', q4.quality === 'large', JSON.stringify(q4));
  // 之後 YouTube 自動調整也不再強制（這部影片已交給使用者）
  await page.evaluate(() => window.__fixtureAutoQuality('medium'));
  await page.waitForTimeout(400);
  check('手動選擇後，這部影片不再被強制切換（FR-4）', (await fixtureQuality(page)).quality === 'medium');

  // 換下一部影片恢復鎖定
  await spaNavigate(page, 'next2');
  await page.waitForTimeout(600);
  const q5 = await fixtureQuality(page);
  check('換下一部影片恢復鎖定 1080p（FR-4）', q5.quality === 'hd1080', JSON.stringify(q5));

  // 重新整理後仍生效
  await page.reload();
  await page.waitForSelector('ytm-toolbar', { state: 'attached' });
  await page.waitForTimeout(800);
  const q6 = await fixtureQuality(page);
  await openMore(page);
  check('重新整理後設定仍生效（FR-5）', q6.quality === 'hd1080' && (await select.inputValue()) === '1080', JSON.stringify(q6));

  // 最高可用畫質
  await page.goto(WATCH);
  await page.waitForSelector('ytm-toolbar', { state: 'attached' });
  await openMore(page);
  await select.selectOption('max');
  await page.waitForTimeout(400);
  check('「最高可用畫質」使用影片的最高畫質（FR-1）', (await fixtureQuality(page)).quality === 'hd2160');

  // 關閉：交還給 YouTube
  await select.selectOption('off');
  await page.waitForTimeout(300);
  const released = (await fixtureLog(page)).some((e) => e.type === 'range' && e.min === 'auto');
  await page.evaluate(() => window.__fixtureAutoQuality('hd720'));
  await page.waitForTimeout(400);
  const q7 = await fixtureQuality(page);
  check('選「關閉」後交還給 YouTube 自動決定畫質', released && q7.quality === 'hd720' && q7.range === null, JSON.stringify(q7));
}, { viewport: { width: 1280, height: 1300 } });

// ---------------------------------------------------------------------------
// T28 複製連結（004 第 4 節）
// ---------------------------------------------------------------------------
const linkRows = (page) =>
  page.evaluate(() =>
    [...document.querySelector('ytm-toolbar').shadowRoot.querySelectorAll('.ytm-copylink-row')].map((row) => ({
      kind: row.dataset.kind,
      name: row.querySelector('.ytm-copylink-name').textContent,
      preview: row.querySelector('.ytm-copylink-preview').textContent,
      full: row.querySelector('.ytm-copylink-preview').title,
      status: row.querySelector('.ytm-copylink-status').textContent,
    })),
  );
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const seek = (page, s) =>
  page.evaluate(async (s) => {
    const v = document.querySelector('video');
    v.pause();
    v.currentTime = s;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
  }, s);

await section(
  'T28',
  async (page, context) => {
    const order = await page.evaluate(() =>
      [...document.querySelector('ytm-toolbar').shadowRoot.querySelectorAll('.ytm-group')].map((g) =>
        [...g.querySelectorAll('.ytm-btn')].map((b) => b.dataset.button),
      ),
    );
    check(
      '工具列左組在「截圖」右邊加入「連結」按鈕（FR-30、001 FR-6）',
      order[0].join() === 'video,mp3,thumbnail,subtitles,screenshot,link',
      order[0].join(),
    );

    await button(page, 'help').click();
    await page.waitForTimeout(200);
    const helpLink = await page.evaluate(() => {
      const li = document.querySelector('ytm-toolbar').shadowRoot.querySelector('.ytm-help-item[data-button="link"]');
      return li ? { name: li.querySelector('.ytm-help-name').textContent, desc: li.querySelector('.ytm-help-desc').textContent, icon: !!li.querySelector('svg path') } : null;
    });
    check('說明面板同步列出「連結」（FR-30、001 FR-17）', helpLink?.name === 'Link' && helpLink.icon && helpLink.desc.length > 10, JSON.stringify(helpLink));
    await page.keyboard.press('Escape');

    await button(page, 'link').click();
    await page.waitForSelector('ytm-toolbar .ytm-copylink-row');
    let rows = await linkRows(page);
    check(
      '連結面板有三個選項，順序為目前時間、Markdown、不含時間（FR-31）',
      rows.map((r) => r.kind).join() === 'time,markdown,plain',
      rows.map((r) => r.name).join(', '),
    );
    check(
      '目前時間是 0 秒時，選項 1 與 3 相同，不加 ?t=0（FR-33）',
      rows[0].full === 'https://youtu.be/jNQXAC9IVRw' && rows[2].full === rows[0].full && rows[1].full === '[Fixture video（00:00）](https://youtu.be/jNQXAC9IVRw)',
      rows.map((r) => r.full).join(' | '),
    );

    // 播放到 23.6 秒（假影片長 30 秒；83 秒的例子由單元測試涵蓋）
    await seek(page, 23.6);
    await page.waitForTimeout(200);
    rows = await linkRows(page);
    check(
      '預覽顯示實際會複製的文字，時間隨播放位置更新並無條件捨去（FR-31、FR-32）',
      rows[0].full === 'https://youtu.be/jNQXAC9IVRw?t=23' && rows[1].full === '[Fixture video（00:23）](https://youtu.be/jNQXAC9IVRw?t=23)' && rows[2].full === 'https://youtu.be/jNQXAC9IVRw',
      rows.map((r) => r.full).join(' | '),
    );
    await seek(page, 3);
    await page.evaluate(() => document.querySelector('video').play());
    await page.waitForTimeout(2300);
    await page.evaluate(() => document.querySelector('video').pause());
    const playing = (await linkRows(page))[0].full;
    check('播放中預覽的時間跟著前進（FR-32）', /\?t=(5|6)$/.test(playing), playing);

    // 複製
    await seek(page, 23.6);
    await page.locator('ytm-toolbar .ytm-copylink-row[data-kind="markdown"]').click();
    await page.waitForTimeout(150);
    const copiedMd = await clipboard(page);
    rows = await linkRows(page);
    check(
      '點 Markdown 選項複製 [標題（00:23）](https://youtu.be/ID?t=23)，並顯示「已複製」（FR-31）',
      copiedMd === '[Fixture video（00:23）](https://youtu.be/jNQXAC9IVRw?t=23)' && rows[1].status === 'Copied',
      `${copiedMd} / ${rows[1].status}`,
    );
    await shot(page, 'T28-link-panel-copied.png');
    await page.waitForTimeout(2200);
    check('「已複製」約 2 秒後消失（FR-31）', (await linkRows(page))[1].status === '');
    await page.locator('ytm-toolbar .ytm-copylink-row[data-kind="time"]').click();
    await page.waitForTimeout(150);
    check('點目前時間的連結複製 https://youtu.be/ID?t=23（FR-31）', (await clipboard(page)) === 'https://youtu.be/jNQXAC9IVRw?t=23');
    await page.locator('ytm-toolbar .ytm-copylink-row[data-kind="plain"]').click();
    await page.waitForTimeout(150);
    check('點不含時間的連結複製 https://youtu.be/ID（FR-31）', (await clipboard(page)) === 'https://youtu.be/jNQXAC9IVRw');

    // 換頁後（釘選面板）更新為新影片
    await page.locator('ytm-toolbar .ytm-panel-pin, ytm-toolbar [aria-label="Pin panel"]').first().click();
    await spaNavigate(page, 'next');
    await page.waitForTimeout(500);
    rows = await linkRows(page);
    check(
      '釘選的面板換頁後顯示新影片的連結與標題',
      rows[2]?.full === 'https://youtu.be/aaaaaaaaaaa' && rows[1]?.full.startsWith('[Fixture video aaaaaaaaaaa（'),
      rows.map((r) => r.full).join(' | '),
    );

    // 播放清單中的影片：不帶播放清單參數
    await page.goto('https://www.youtube.com/watch?v=bbbbbbbbbbb&list=PLabcdefghijklmnop&index=3&pp=xyz');
    await page.waitForSelector('ytm-toolbar', { state: 'attached' });
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
    await seek(page, 12.2);
    await button(page, 'link').click();
    await page.waitForSelector('ytm-toolbar .ytm-copylink-row');
    await page.locator('ytm-toolbar .ytm-copylink-row[data-kind="time"]').click();
    await page.waitForTimeout(150);
    const fromList = await clipboard(page);
    check('從播放清單打開的影片，複製的連結不含播放清單參數（FR-35）', fromList === 'https://youtu.be/bbbbbbbbbbb?t=12', fromList);

    // 複製失敗：瀏覽器拒絕剪貼簿存取
    const cdp = await context.newCDPSession(page);
    for (const allowWithoutSanitization of [false, true]) {
      await cdp.send('Browser.setPermission', {
        permission: { name: 'clipboard-write', allowWithoutSanitization },
        setting: 'denied',
        origin: 'https://www.youtube.com',
      });
    }
    await page.locator('ytm-toolbar .ytm-copylink-row[data-kind="markdown"]').click();
    await page.waitForTimeout(300);
    const manual = await page.evaluate(() => {
      const root = document.querySelector('ytm-toolbar').shadowRoot;
      const ta = root.querySelector('.ytm-copylink-manual-text');
      return {
        error: root.querySelector('.ytm-copylink-manual [role="alert"]')?.textContent ?? null,
        value: ta?.value ?? null,
        selected: ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : null,
        focused: root.activeElement === ta,
      };
    });
    if (manual.error === null && manual.value === null) {
      skip('複製失敗時顯示錯誤與可以手動選取的文字框（FR-34）', '本環境無法讓瀏覽器拒絕剪貼簿寫入');
    } else {
      check(
        '複製失敗時顯示錯誤，並改為顯示可以手動選取的文字框（FR-34）',
        !!manual.error && manual.value === '[Fixture video（00:12）](https://youtu.be/bbbbbbbbbbb?t=12)' && manual.selected === manual.value && manual.focused,
        JSON.stringify(manual),
      );
      await shot(page, 'T28-link-panel-copy-failed.png');
    }
  },
  { permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 1100 } },
);

// ---------------------------------------------------------------------------
// T29 設定頁分類與 CSS 開關機制（005 共通需求、plan 3.7.2）
// ---------------------------------------------------------------------------
const OPTIONS_URL = `chrome-extension://${EXT_ID}/options.html`;
const readOptions = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#tidy-groups fieldset')].map((f) => ({
      category: f.dataset.category,
      legend: f.querySelector('legend').textContent,
      options: [...f.querySelectorAll('.option')].map((o) => ({
        id: o.dataset.option,
        name: o.querySelector('.option-name').textContent,
        desc: o.querySelector('.option-desc').textContent,
        checked: o.querySelector('input').checked,
        role: o.querySelector('input').getAttribute('role'),
      })),
    })),
  );
const openOptions = async (context) => {
  const options = await context.newPage();
  await options.goto(OPTIONS_URL);
  await options.waitForFunction(() => [...document.querySelectorAll('#tidy-groups input')].length === 7 && [...document.querySelectorAll('#tidy-groups input')].every((i) => !i.disabled));
  return options;
};
const setOption = async (options, id, on) => {
  const input = options.locator(`.option[data-option="${id}"] input`);
  if ((await input.isChecked()) !== on) await input.click();
};
const htmlHas = (page, cls) => page.evaluate((cls) => document.documentElement.classList.contains(cls), cls);

await section(
  'T29',
  async (page, context) => {
    const options = await openOptions(context);
    options.setViewportSize({ width: 900, height: 1100 });
    const groups = await readOptions(options);
    check(
      '設定頁「頁面整理」區依四個類別分組：觀看頁、干擾、Shorts、介面（005 FR-1）',
      groups.map((g) => `${g.category}:${g.options.map((o) => o.id).join('+')}`).join(' ') ===
        'watch:originalAudio+hideEndCards distractions:autoContinue+noThumbnailPreview shorts:shortsToWatch+hideShorts interface:fullTitles',
      groups.map((g) => `${g.legend}(${g.options.map((o) => o.name).join(', ')})`).join(' / '),
    );
    check(
      '每個選項是一個開關，附一行說明（005 FR-1）',
      groups.every((g) => g.options.every((o) => o.role === 'switch' && o.desc.length > 20 && o.name !== o.desc)),
    );
    check('所有選項預設關閉（005 FR-2）', groups.every((g) => g.options.every((o) => !o.checked)));
    check(
      '保留下載設定區',
      await options.evaluate(() => !!document.querySelector('#downloads h2')?.textContent),
    );
    await options.screenshot({ path: `${(await import('./lib.mjs')).shots}/T29-options-en.png`, fullPage: true });

    // 設定存在 sync 區（005 FR-4）
    await setOption(options, 'fullTitles', true);
    await options.waitForTimeout(200);
    const stored = await options.evaluate(() => chrome.storage.sync.get('tidyFullTitles'));
    check('設定存在 sync 區，跟著瀏覽器帳號同步（005 FR-4）', stored.tidyFullTitles === true, JSON.stringify(stored));
    await setOption(options, 'fullTitles', false);
    // 另一個設定頁分頁同步顯示
    const options2 = await openOptions(context);
    await setOption(options, 'hideShorts', true);
    await options2.waitForTimeout(300);
    check('另一個開著的設定頁同步顯示變更', await options2.locator('.option[data-option="hideShorts"] input').isChecked());
    await setOption(options, 'hideShorts', false);
    await options2.close();

    // 003 的隱藏留言改用 CSS 開關機制：在 <html> 加上 class，並在 document_start 的內容腳本處理
    await page.bringToFront();
    await openMore(page);
    await page.locator('ytm-toolbar .ytm-more-item[data-item="hideComments"] [role="switch"]').click();
    await page.waitForTimeout(300);
    const viaClass = await page.evaluate(() => ({
      cls: document.documentElement.classList.contains('ytm-hide-comments'),
      hidden: getComputedStyle(document.querySelector('#comments')).display === 'none',
      style: !!document.getElementById('ytm-tidy-styles'),
      oldStyleRule: [...(document.getElementById('ytm-page-styles')?.sheet?.cssRules ?? [])].some((r) => r.cssText.includes('ytm-hide-comments')),
    }));
    check('「隱藏留言」改用 <html> class 開關機制（plan 3.7.2）', viaClass.cls && viaClass.hidden && viaClass.style && !viaClass.oldStyleRule, JSON.stringify(viaClass));

    // 重新整理：document_start 的內容腳本在工具列出現之前就套用
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        window.__classAtDomReady = document.documentElement.className;
        window.__toolbarAtDomReady = !!document.querySelector('ytm-toolbar');
      });
    });
    await page.reload();
    await page.waitForSelector('ytm-toolbar', { state: 'attached' });
    const early = await page.evaluate(() => ({ cls: window.__classAtDomReady, toolbar: window.__toolbarAtDomReady }));
    check(
      '重新整理後，頁面解析完成時（工具列出現之前）<html> 已有 class',
      /\byte-hide-comments\b/.test(early.cls ?? '') && early.toolbar === false,
      JSON.stringify(early),
    );

    // 繁體中文
    const zh = await launch({ name: 'conv-T29-zh', lang: 'zh-TW' });
    const zhPage = await zh.newPage();
    await zhPage.setViewportSize({ width: 900, height: 1100 });
    await zhPage.goto(OPTIONS_URL);
    await zhPage.waitForFunction(() => document.querySelectorAll('#tidy-groups .option').length === 7);
    const zhGroups = await readOptions(zhPage);
    check(
      '設定頁的繁體中文類別與選項名稱（NFR-4）',
      zhGroups.map((g) => g.legend).join('、') === '觀看頁、干擾、Shorts、介面' && zhGroups[0].options[0].name === '永遠使用原始語音',
      zhGroups.map((g) => `${g.legend}：${g.options.map((o) => o.name).join('、')}`).join('；'),
    );
    await zhPage.screenshot({ path: `${(await import('./lib.mjs')).shots}/T29-options-zh-TW.png`, fullPage: true });
    await zh.close();
  },
);

// ---------------------------------------------------------------------------
// T30 只靠樣式的選項（005）
// ---------------------------------------------------------------------------
/** 元素是否實際顯示（自己與祖先都不是 display: none，且有大小）。 */
const visibleCount = (page, selector) =>
  page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((el) => el.getClientRects().length > 0).length, selector);
/** 標題是否完整顯示、是否與下一行文字重疊。 */
const titleState = (page, selector) =>
  page.evaluate((selector) =>
    [...document.querySelectorAll(selector)]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const box = el.closest('h3') ?? el;
        const next = box.nextElementSibling?.getBoundingClientRect();
        return {
          truncated: el.scrollHeight > el.clientHeight + 1,
          height: Math.round(r.height),
          overlap: next ? r.bottom > next.top + 1 : false,
        };
      }),
    selector,
  );
/** 首頁格狀清單每一列顯示幾個項目（依 top 分組）。 */
const gridRows = (page) =>
  page.evaluate(() => {
    const rows = new Map();
    for (const el of document.querySelectorAll('#contents > ytd-rich-item-renderer')) {
      if (el.getClientRects().length === 0) continue;
      const top = Math.round(el.getBoundingClientRect().top);
      rows.set(top, (rows.get(top) ?? 0) + 1);
    }
    return [...rows.values()];
  });

await section(
  'T30',
  async (page, context) => {
    const { shots } = await import('./lib.mjs');
    const options = await openOptions(context);

    // ---- 開關立即生效（FR-3）：觀看頁開著時從設定頁開關 ----
    const classes = { hideEndCards: 'ytm-hide-end-cards', noThumbnailPreview: 'ytm-no-thumbnail-preview', hideShorts: 'ytm-hide-shorts', fullTitles: 'ytm-full-titles' };
    const immediate = {};
    for (const [id, cls] of Object.entries(classes)) {
      await setOption(options, id, true);
      await page.waitForTimeout(250);
      immediate[id] = await htmlHas(page, cls);
      await setOption(options, id, false);
      await page.waitForTimeout(250);
      immediate[id] = immediate[id] && !(await htmlHas(page, cls));
    }
    check('開關任一選項，已開啟的 YouTube 分頁立即生效，不需重新整理（005 FR-3）', Object.values(immediate).every(Boolean), JSON.stringify(immediate));

    // ---- 片尾推薦卡片與結尾畫面（FR-20 至 FR-22）----
    await page.bringToFront();
    const endState = () =>
      page.evaluate(() => {
        const vis = (sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0);
        return {
          cards: vis('.ytp-ce-element'),
          wall: vis('.ytp-endscreen-content'),
          grid: vis('.ytp-fullscreen-grid-stills-container'),
          countdown: vis('.ytp-autonav-endscreen-countdown-overlay'),
        };
      });
    const playToEnd = () =>
      page.evaluate(async () => {
        const v = document.querySelector('video');
        v.currentTime = v.duration - 1.5;
        await v.play();
        await new Promise((r) => v.addEventListener('ended', r, { once: true }));
      });
    // 先確認假頁面在沒有開啟選項時會顯示
    await page.evaluate(() => {
      const t = document.querySelector('.ytp-autonav-toggle-button');
      if (t.getAttribute('aria-checked') === 'true') t.closest('button').click();
    });
    await seek(page, 24);
    await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('timeupdate')));
    const cardsOff = await endState();
    await playToEnd();
    await page.waitForTimeout(200);
    const endOff = await endState();
    check('（假頁面）未開啟時片尾卡片與結尾畫面會顯示', cardsOff.cards && endOff.wall && endOff.grid, JSON.stringify({ cardsOff, endOff }));

    await setOption(options, 'hideEndCards', true);
    await page.bringToFront();
    await page.waitForTimeout(250);
    await seek(page, 24);
    await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('timeupdate')));
    const cardsOn = await endState();
    check('影片最後幾秒沒有推薦卡片（FR-20）', !cardsOn.cards && (await page.evaluate(() => document.querySelector('.ytp-ce-element').classList.contains('ytp-ce-element-show'))), JSON.stringify(cardsOn));
    await playToEnd();
    await page.waitForTimeout(200);
    const endOn = await endState();
    check('播完後沒有推薦格狀畫面（FR-21）', !endOn.wall && !endOn.grid, JSON.stringify(endOn));
    await page.screenshot({ path: `${shots}/T30-end-screen-hidden.png`, clip: await page.evaluate(() => { const r = document.querySelector('#movie_player').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });

    // 自動播放下一部仍正常（FR-22）
    await page.evaluate(() => document.querySelector('.ytp-autonav-toggle-button').closest('button').click());
    const urlBefore = page.url();
    await playToEnd();
    await page.waitForTimeout(300);
    const countdown = (await endState()).countdown;
    await page.waitForTimeout(2300);
    const autonav = await page.evaluate(() => window.__fixtureAutonavFired);
    check('自動播放下一部的倒數照常顯示，倒數結束後換到下一部（FR-22）', countdown && autonav && page.url() !== urlBefore, `countdown=${countdown} url=${page.url()}`);

    // ---- 停用縮圖自動預覽（FR-40、FR-41）----
    const hoverThumb = async (p, selector) => {
      await p.mouse.move(5, 300);
      const box = await p.locator(selector).first().boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForTimeout(900);
      return p.evaluate(({ x, y }) => {
        const prev = document.querySelector('#video-preview');
        const top = document.elementFromPoint(x, y);
        return {
          previewVisible: !!prev && prev.getClientRects().length > 0,
          topIsThumbnail: !!top?.closest('a#thumbnail'),
          img: getComputedStyle(document.querySelector('a#thumbnail img')).display !== 'none',
        };
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    };
    const home = await context.newPage();
    await home.goto('https://www.youtube.com/');
    await home.waitForSelector('#contents ytd-rich-item-renderer');
    const previewOff = await hoverThumb(home, '#contents ytd-rich-item-renderer a#thumbnail');
    await setOption(options, 'noThumbnailPreview', true);
    await home.bringToFront();
    await home.waitForTimeout(250);
    const previewOn = await hoverThumb(home, '#contents ytd-rich-item-renderer a#thumbnail');
    check('（假頁面）未開啟時滑鼠停在縮圖上會播放預覽', previewOff.previewVisible && !previewOff.topIsThumbnail, JSON.stringify(previewOff));
    check('開啟後滑鼠停在縮圖上不顯示預覽，縮圖維持靜態圖片（FR-40）', !previewOn.previewVisible && previewOn.topIsThumbnail && previewOn.img, JSON.stringify(previewOn));
    const thumbHref = await home.locator('#contents ytd-rich-item-renderer a#thumbnail').first().getAttribute('href');
    await home.locator('#contents ytd-rich-item-renderer a#thumbnail').first().click();
    await home.waitForURL((u) => u.pathname === '/watch');
    check('點擊縮圖仍正常開啟影片（FR-41）', new URL(home.url()).pathname + new URL(home.url()).search === thumbHref, home.url());

    // 搜尋結果、觀看頁推薦清單也不顯示預覽
    await home.goto('https://www.youtube.com/results?search_query=fixture');
    await home.waitForSelector('ytd-video-renderer');
    const previewSearch = await hoverThumb(home, 'ytd-video-renderer a#thumbnail');
    await home.goto(WATCH);
    await home.waitForSelector('#related a#thumbnail');
    const previewRelated = await hoverThumb(home, '#related a#thumbnail');
    check('搜尋結果與推薦清單的縮圖也不播放預覽（FR-40）', !previewSearch.previewVisible && !previewRelated.previewVisible, JSON.stringify({ previewSearch, previewRelated }));

    // ---- 隱藏 Shorts（FR-60 至 FR-63）----
    await home.goto('https://www.youtube.com/');
    await home.waitForSelector('#contents ytd-rich-item-renderer');
    const shortsVisible = (p) =>
      p.evaluate(() => ({
        links: [...document.querySelectorAll('a[href^="/shorts/"]')].filter((a) => a.getClientRects().length > 0).length,
        guide: ['#fixture-guide-shorts', '#fixture-mini-shorts'].filter((s) => document.querySelector(s)?.getClientRects().length > 0).length,
      }));
    const homeBefore = { ...(await shortsVisible(home)), rows: await gridRows(home) };
    await home.screenshot({ path: `${shots}/T30-home-before.png` });
    await setOption(options, 'hideShorts', true);
    await home.bringToFront();
    await home.waitForTimeout(250);
    const homeAfter = { ...(await shortsVisible(home)), rows: await gridRows(home) };
    check('（假頁面）未開啟時首頁有 Shorts 區塊、Shorts 項目與導覽入口', homeBefore.links > 0 && homeBefore.guide === 2, JSON.stringify(homeBefore));
    check('首頁看不到 Shorts 區塊、個別 Shorts 項目（FR-60）', homeAfter.links === 0, JSON.stringify(homeAfter));
    check('左側導覽與迷你導覽的 Shorts 入口隱藏（FR-61）', homeAfter.guide === 0);
    check(
      '隱藏後格狀清單重新排列，沒有空位（FR-62）',
      homeAfter.rows.slice(0, -1).every((n) => n === 4) && (await visibleCount(home, '#contents > ytd-rich-item-renderer')) === 9,
      `每列 ${homeAfter.rows.join(',')}（隱藏前 ${homeBefore.rows.join(',')}）`,
    );
    await home.goto('https://www.youtube.com/feed/subscriptions');
    await home.waitForSelector('#contents ytd-rich-item-renderer');
    check('訂閱頁看不到 Shorts（FR-60）', (await shortsVisible(home)).links === 0);
    await home.goto('https://www.youtube.com/results?search_query=fixture');
    await home.waitForSelector('ytd-video-renderer');
    const search = {
      ...(await shortsVisible(home)),
      results: await visibleCount(home, 'ytd-item-section-renderer #contents > [data-fixture="video"]'),
    };
    check('搜尋結果看不到 Shorts 區塊與個別 Shorts 項目，一般結果照常顯示（FR-60）', search.links === 0 && search.guide === 0 && search.results === 4, JSON.stringify(search));
    await home.goto(WATCH);
    await home.waitForSelector('#related');
    const related = { links: (await shortsVisible(home)).links, videos: await visibleCount(home, '#related [data-fixture="video"]') };
    check('觀看頁推薦清單看不到 Shorts，一般推薦照常顯示（FR-60）', related.links === 0 && related.videos === 2, JSON.stringify(related));
    await home.goto('https://www.youtube.com/shorts/abcdefghijk');
    await home.waitForTimeout(500);
    check(
      '直接開啟 Shorts 網址不受「隱藏 Shorts」影響（FR-63）',
      new URL(home.url()).pathname === '/shorts/abcdefghijk' && (await visibleCount(home, '#fixture-short-player')) === 1,
    );

    // ---- 顯示完整影片標題（FR-70、FR-71）----
    await home.goto('https://www.youtube.com/');
    await home.waitForSelector('#contents ytd-rich-item-renderer');
    const titleSel = '#video-title, .ytLockupMetadataViewModelTitle';
    const titlesBefore = await titleState(home, titleSel);
    await setOption(options, 'fullTitles', true);
    await home.bringToFront();
    await home.waitForTimeout(250);
    const titlesAfter = await titleState(home, titleSel);
    await home.screenshot({ path: `${shots}/T30-home-after.png` });
    check('（假頁面）未開啟時長標題被截斷', titlesBefore.some((t) => t.truncated), JSON.stringify(titlesBefore.map((t) => t.height)));
    check(
      '首頁的長標題完整顯示，且不與下一行文字重疊（FR-70、FR-71）',
      titlesAfter.every((t) => !t.truncated && !t.overlap) && titlesAfter.some((t) => t.height > 52),
      JSON.stringify(titlesAfter.map((t) => t.height)),
    );
    const titlePages = {};
    for (const [name, url, sel] of [
      ['search', 'https://www.youtube.com/results?search_query=fixture', titleSel],
      ['channel', 'https://www.youtube.com/@fixture/videos', titleSel],
      ['related', WATCH, '#related #video-title, #related .ytLockupMetadataViewModelTitle'],
    ]) {
      await home.goto(url);
      await home.waitForTimeout(400);
      const s = await titleState(home, sel);
      titlePages[name] = s.length > 0 && s.every((t) => !t.truncated && !t.overlap);
      if (name === 'search') await home.screenshot({ path: `${shots}/T30-search-after.png` });
    }
    check('搜尋、頻道、觀看頁推薦清單的標題也完整顯示（FR-70）', Object.values(titlePages).every(Boolean), JSON.stringify(titlePages));

    // ---- 關閉工具列後仍生效（FR-6）----
    await options.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await options.waitForFunction(() => !!document.querySelector('h1')?.textContent);
    await options.waitForTimeout(300);
    await options.locator('#enabled').uncheck();
    await home.bringToFront();
    await home.waitForTimeout(400);
    const afterClose = await home.evaluate(() => ({
      toolbar: !!document.querySelector('ytm-toolbar'),
      classes: ['ytm-hide-end-cards', 'ytm-no-thumbnail-preview', 'ytm-hide-shorts', 'ytm-full-titles'].filter((c) => document.documentElement.classList.contains(c)),
    }));
    await home.reload();
    await home.waitForTimeout(600);
    const afterReload = await home.evaluate(() => document.documentElement.className);
    check(
      '關閉工具列（「啟用」關閉）後，頁面整理的選項仍照設定生效（005 FR-6）',
      !afterClose.toolbar && afterClose.classes.length === 4 && afterReload.split(' ').filter((c) => c.startsWith('ytm-')).length === 4,
      `${JSON.stringify(afterClose)} reload=${afterReload}`,
    );
  },
  { viewport: { width: 1400, height: 1000 } },
);

// ---------------------------------------------------------------------------
// T31 需要程式的選項（005）
// ---------------------------------------------------------------------------
const audioNow = (page) => page.evaluate(() => window.__fixtureAudio());

await section(
  'T31',
  async (page, context) => {
    const { shots } = await import('./lib.mjs');
    const options = await openOptions(context);

    // ---- 永遠使用原始語音（FR-10 至 FR-13）----
    await page.bringToFront();
    await page.goto('https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await page.waitForSelector('ytm-toolbar', { state: 'attached' });
    await page.evaluate(() => document.querySelector('video').play());
    await page.waitForTimeout(1500);
    const dubbedOff = await audioNow(page);
    check('（假頁面）未開啟時，有自動配音的影片預設播放自動配音', dubbedOff.id === 'es.3', JSON.stringify(dubbedOff));
    await page.evaluate(() => {
      const v = document.querySelector('video');
      v.currentTime = 6;
    });
    await page.waitForTimeout(300);
    await setOption(options, 'originalAudio', true);
    await page.bringToFront();
    await page.waitForTimeout(600);
    const switched = await page.evaluate(() => ({ ...window.__fixtureAudio(), paused: document.querySelector('video').paused }));
    check(
      '開啟後立即切換到原始語音，影片繼續播放、沒有跳回開頭（FR-10、FR-13、005 FR-3）',
      switched.id === 'en.4' && switched.time > 5.5 && !switched.paused,
      JSON.stringify(switched),
    );

    // 手動改成配音：這部影片維持配音
    await page.locator('#movie_player .ytp-settings-button').click();
    await page.locator('#movie_player .ytp-settings-menu button[data-audio="es.3"]').click();
    await page.evaluate(() => {
      const v = document.querySelector('video');
      v.dispatchEvent(new Event('loadedmetadata'));
      v.dispatchEvent(new Event('playing'));
    });
    await page.waitForTimeout(500);
    check('手動改成配音後，這部影片維持配音（FR-12）', (await audioNow(page)).id === 'es.3');

    // 換到下一部有自動配音的影片：恢復自動切換
    await page.evaluate(() => window.__fixtureNavigate('ddddddddddd'));
    await page.waitForTimeout(600);
    check('換到下一部影片再恢復自動切換（FR-12）', (await audioNow(page)).id === 'en.4');

    // 只有一個語音軌、預設就是原始語音
    const switchesBefore = (await fixtureLog(page, 'audio')).filter((e) => e.source === 'api').length;
    await page.evaluate(() => window.__fixtureNavigate('bbbbbbbbbbb'));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__fixtureNavigate('ccccccccccc'));
    await page.waitForTimeout(500);
    const apiSwitches = (await fixtureLog(page, 'audio')).filter((e) => e.source === 'api');
    check(
      '只有一個語音軌、或預設就是原始語音時不做任何事（FR-11）',
      (await audioNow(page)).id === 'en.4' && switchesBefore === 2 && apiSwitches.length === 2,
      JSON.stringify(apiSwitches),
    );
    // 重新載入有自動配音的影片
    await page.goto('https://www.youtube.com/watch?v=ddddddddddd');
    await page.waitForSelector('ytm-toolbar', { state: 'attached' });
    await page.evaluate(() => document.querySelector('video').play());
    await page.waitForTimeout(800);
    check('直接打開有自動配音的影片時播放原始語音（FR-10）', (await audioNow(page)).id === 'en.4');
    await setOption(options, 'originalAudio', false);

    // ---- 自動關閉「要繼續觀看嗎？」（FR-30、FR-31）----
    const fresh = await context.newPage();
    await openWatch(fresh);
    await fresh.evaluate(() => document.querySelector('video').play());
    await fresh.waitForTimeout(500);
    await fresh.evaluate(() => window.__fixtureShowContinueDialog());
    await fresh.waitForTimeout(800);
    const offState = await fresh.evaluate(() => ({ dialog: window.__fixtureDialogVisible(), paused: document.querySelector('video').paused }));
    check('（假頁面）未開啟時對話框維持顯示、影片暫停', offState.dialog && offState.paused, JSON.stringify(offState));
    await fresh.screenshot({ path: `${shots}/T31-continue-dialog-fixture.png`, clip: { x: 0, y: 0, width: 1280, height: 700 } });
    await fresh.evaluate(() => document.querySelector('#confirm-button button').click());
    await setOption(options, 'autoContinue', true);
    await fresh.bringToFront();
    await fresh.waitForTimeout(300);
    await fresh.evaluate(() => window.__fixtureShowContinueDialog());
    await fresh.waitForTimeout(800);
    const onState = await fresh.evaluate(() => ({
      dialog: window.__fixtureDialogVisible(),
      paused: document.querySelector('video').paused,
      confirmed: window.__fixtureLog.filter((e) => e.type === 'dialog-confirm').length,
    }));
    check('「要繼續觀看嗎？」出現時被自動關閉並繼續播放（FR-30）', !onState.dialog && !onState.paused && onState.confirmed === 2, JSON.stringify(onState));
    // 再出現一次（對話框被重複使用）
    await fresh.evaluate(() => window.__fixtureShowContinueDialog());
    await fresh.waitForTimeout(800);
    check('對話框再次出現時同樣被關閉', !(await fresh.evaluate(() => window.__fixtureDialogVisible())) && !(await fresh.evaluate(() => document.querySelector('video').paused)));

    // 使用者自己按暫停：不會被自動播放
    await fresh.locator('#fixture-play').click();
    await fresh.waitForTimeout(1500);
    const userPaused = await fresh.evaluate(() => document.querySelector('video').paused);
    // 使用者剛操作過時出現的其他確認對話框：不受影響
    await fresh.evaluate(() => window.__fixtureShowOtherDialog());
    await fresh.waitForTimeout(800);
    const other = await fresh.evaluate(() => ({ dialog: window.__fixtureDialogVisible(), paused: document.querySelector('video').paused }));
    check('自己按暫停的影片不會被自動播放，使用者自己開啟的對話框不受影響（FR-31）', userPaused && other.dialog && other.paused, JSON.stringify({ userPaused, other }));
    await fresh.close();
    await setOption(options, 'autoContinue', false);

    // ---- Shorts 改用一般播放器（FR-50 至 FR-52）----
    await page.bringToFront();
    await page.goto('https://www.youtube.com/shorts/abcdefghijk');
    await page.waitForTimeout(500);
    check('（假頁面）未開啟時 Shorts 網址維持 Shorts 頁', new URL(page.url()).pathname === '/shorts/abcdefghijk');
    await setOption(options, 'shortsToWatch', true);
    await page.bringToFront();
    await page.waitForURL((u) => u.pathname === '/watch', { timeout: 5000 });
    check('開啟時已開著的 Shorts 頁立即轉成一般觀看頁（005 FR-3）', page.url() === 'https://www.youtube.com/watch?v=abcdefghijk', page.url());

    // 直接輸入 Shorts 網址
    await page.goto('https://www.youtube.com/');
    await page.waitForSelector('#contents ytd-rich-item-renderer');
    await page.goto('https://www.youtube.com/shorts/typedxxxxxx');
    await page.waitForURL((u) => u.pathname === '/watch', { timeout: 5000 });
    await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 10_000 });
    check('直接輸入 Shorts 網址時以一般觀看頁播放，工具列可以使用（FR-50、FR-52）', page.url() === 'https://www.youtube.com/watch?v=typedxxxxxx', page.url());
    await page.screenshot({ path: `${shots}/T31-shorts-as-watch.png`, clip: { x: 0, y: 0, width: 1280, height: 700 } });
    await page.goBack();
    await page.waitForTimeout(800);
    check('按上一頁回到首頁，不會回到 Shorts 而被轉回來（FR-51）', new URL(page.url()).pathname === '/', page.url());

    // 在 YouTube 站內點擊 Shorts（首頁的 Shorts 區塊，站內換頁）
    await page.locator('#fixture-shorts-section a.reel-item-endpoint').first().click();
    await page.waitForURL((u) => u.pathname === '/watch', { timeout: 5000 });
    const clicked = page.url();
    await page.waitForSelector('ytm-toolbar', { state: 'attached', timeout: 10_000 });
    await page.goBack();
    await page.waitForTimeout(800);
    const back1 = page.url();
    await page.goForward();
    await page.waitForTimeout(800);
    const forward = page.url();
    check(
      '站內點擊 Shorts 時以一般觀看頁播放；上一頁回到首頁、下一頁回到觀看頁，沒有轉換循環（FR-50、FR-51）',
      clicked === 'https://www.youtube.com/watch?v=short1xxxxx' && new URL(back1).pathname === '/' && forward === clicked,
      `${clicked} → back ${back1} → forward ${forward}`,
    );

    // 觀看頁推薦清單中的 Shorts
    await page.goto(WATCH);
    await page.waitForSelector('#related');
    await page.locator('#fixture-related-shorts a.reel-item-endpoint').first().click();
    await page.waitForURL((u) => u.pathname === '/watch' && u.searchParams.get('v') === 'rsh1xxxxxxx', { timeout: 5000 });
    check('觀看頁推薦清單中的 Shorts 也以一般觀看頁播放（FR-50）', true, page.url());
  },
  { viewport: { width: 1280, height: 900 } },
);

if (!summary()) process.exitCode = 1;
void EXT_ID;
void skip;
