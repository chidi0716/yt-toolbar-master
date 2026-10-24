// 階段 6（006 自訂工具列，T32–T34）在本機假觀看頁上的驗收檢查與截圖。
// 隱藏的工具下載中的提示圓點需要橋接程式，見 spikes/stage4/e2e-test.mjs 的 T32 段落。
//   npm run build && node spikes/stage6/toolbar-test.mjs
//   ONLY=edit,options … # 只跑某幾段
import { EXT_ID, WATCH, button, launch, openWatch, reporter, shot, shots } from '../stage1-smoke/lib.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, '.cache'), { recursive: true });

const { check, summary } = reporter();
const only = process.env.ONLY;
const want = (name) => !only || only.split(',').includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_LEFT = 'video mp3 thumbnail subtitles screenshot link';
const DEFAULT_RIGHT = 'darkMode cinema pip floating loop help more close';

async function section(name, fn, { lang = 'en-US', viewport = { width: 1280, height: 1100 } } = {}) {
  if (!want(name)) return;
  console.log(`\n== ${name}`);
  const context = await launch({ name: `t6-${name}`, lang, viewport });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (err) => console.log('  pageerror:', String(err).slice(0, 200)));
  try {
    await openWatch(page, WATCH);
    await fn(page, context);
  } catch (err) {
    check(`${name} script`, false, String(err).split('\n').slice(0, 12).join(' | '));
    await page.screenshot({ path: join(here, '.cache', `error-${name}.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

const inToolbar = (page, src, arg) =>
  page.evaluate(([s, a]) => new Function('root', 'arg', s)(document.querySelector('ytm-toolbar').shadowRoot, a), [src, arg]);
/** 工具列上的按鈕（左組、右組）。 */
const order = (page) =>
  inToolbar(
    page,
    `return { left: [...root.querySelectorAll('.ytm-group[data-group="left"] .ytm-btn')].map((b) => b.dataset.button).join(' '),
              right: [...root.querySelectorAll('.ytm-group[data-group="right"] .ytm-btn')].map((b) => b.dataset.button).join(' ') }`,
  );
/** 編輯模式中的項目（隱藏的以 - 開頭）。 */
const editItems = (page) =>
  inToolbar(page, `return [...root.querySelectorAll('.ytm-edit-item')].map((i) => (i.hasAttribute('data-hidden') ? '-' : '') + i.dataset.item).join(' ')`);
const editing = (page) => inToolbar(page, `return root.querySelector('.ytm-toolbar').hasAttribute('data-editing')`);
const openMore = async (page) => {
  await button(page, 'more').click();
  await page.waitForSelector('ytm-toolbar .ytm-more-edit');
};
const enterEdit = async (page) => {
  await openMore(page);
  await page.locator('ytm-toolbar .ytm-more-edit').click();
  await page.waitForSelector('ytm-toolbar .ytm-toolbar[data-editing]');
};
const editButton = (page, label) => page.locator(`ytm-toolbar .ytm-edit-actions button:has-text("${label}")`);
const eye = (page, id) => page.locator(`ytm-toolbar .ytm-edit-item[data-item="${id}"] .ytm-edit-eye`);
const tile = (page, id) =>
  page.locator(id === 'separator' ? 'ytm-toolbar .ytm-edit-sep' : `ytm-toolbar .ytm-edit-item[data-item="${id}"] .ytm-edit-tool`);

/** 以滑鼠拖曳：把 id 拖到 target 項目的左側（before）或右側（after）。 */
async function dragTo(page, id, target, side = 'before') {
  const a = await tile(page, id).boundingBox();
  const b = await tile(page, target).boundingBox();
  const x = side === 'before' ? b.x + 2 : b.x + b.width - 2;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + (x > a.x ? 8 : -8), a.y + a.height / 2, { steps: 2 });
  await page.mouse.move(x, b.y + b.height / 2, { steps: 8 });
  const indicator = await inToolbar(page, `return !!root.querySelector('.ytm-edit-indicator')`);
  await page.mouse.up();
  await sleep(100);
  return indicator;
}

const storedLayout = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        // 從頁面讀不到擴充功能的 storage，改由工具列的結果判斷；這裡只等待寫入完成。
        setTimeout(resolve, 300);
      }),
  );

// ---------------------------------------------------------------------------
// 進入、取消、Esc（006 FR-1、FR-3、FR-4、FR-10、FR-11、FR-14）
// ---------------------------------------------------------------------------
await section('edit', async (page, context) => {
  const before = await order(page);
  check('預設：左組六個工具，右組六個工具＋「更多」「關閉」（006 FR-23）', before.left === DEFAULT_LEFT && before.right === DEFAULT_RIGHT, JSON.stringify(before));

  await openMore(page);
  const moreText = await inToolbar(page, `return { other: !!root.querySelector('.ytm-other-tools'), last: root.querySelector('.ytm-panel-body, .ytm-panel').lastElementChild?.textContent ?? '', edit: root.querySelector('.ytm-more-edit')?.textContent }`);
  check('「更多」面板最下方有「編輯工具列」；沒有隱藏的工具時不顯示「其他工具」（FR-1、FR-16）', moreText.edit === 'Edit toolbar' && !moreText.other, JSON.stringify(moreText));
  await page.locator('ytm-toolbar .ytm-more-edit').click();
  await page.waitForSelector('ytm-toolbar .ytm-toolbar[data-editing]');
  const state = await inToolbar(
    page,
    `return { panel: !!root.querySelector('.ytm-panel'), actions: [...root.querySelectorAll('.ytm-edit-actions button')].map((b) => b.textContent),
              help: root.querySelector('.ytm-edit-help')?.textContent, eyes: root.querySelectorAll('.ytm-edit-eye').length,
              sep: root.querySelectorAll('.ytm-edit-sep').length, fixed: !!root.querySelector('.ytm-btn[data-button="more"], .ytm-btn[data-button="close"]'),
              focus: root.activeElement?.closest('.ytm-edit-item')?.dataset.item }`,
  );
  check('點「編輯工具列」進入編輯模式，「更多」面板收起（FR-1）', !state.panel, JSON.stringify(state));
  check('右側為「重設為預設」「取消」「完成」，不顯示「更多」「關閉」（FR-3）', state.actions.join('|') === 'Reset to default|Cancel|Done' && !state.fixed, state.actions.join('|'));
  check('所有工具都顯示，每個工具有眼睛切換按鈕，分隔點一個（FR-10、FR-11、FR-12）', (await editItems(page)) === `${DEFAULT_LEFT} separator darkMode cinema pip floating loop help` && state.eyes === 12 && state.sep === 1, await editItems(page));
  check(
    '底部說明文字（FR-14）',
    state.help === 'Drag to reorder. Click the eye icon to show or hide a tool. Hidden tools are available from the “More” menu.',
    state.help,
  );
  check('進入時焦點在第一個工具（鍵盤操作，FR-13）', state.focus === 'video', state.focus);

  // 編輯模式中點工具不會執行原本的功能（FR-5）
  await tile(page, 'darkMode').click();
  await tile(page, 'video').click();
  const noop = await inToolbar(page, `return { panel: !!root.querySelector('.ytm-panel'), editing: root.querySelector('.ytm-toolbar').hasAttribute('data-editing') }`);
  const dark = await page.evaluate(() => document.documentElement.hasAttribute('dark'));
  check('編輯模式中點工具不會執行功能、不展開面板（FR-5）', !noop.panel && noop.editing, JSON.stringify({ ...noop, dark }));

  // 變更後按「取消」
  await eye(page, 'loop').click();
  await dragTo(page, 'mp3', 'video', 'before');
  const changed = await editItems(page);
  await editButton(page, 'Cancel').click();
  await sleep(200);
  check('「取消」放棄變更，工具列與進入前完全相同（FR-4、驗收 1）', !(await editing(page)) && JSON.stringify(await order(page)) === JSON.stringify(before), `${changed} → ${JSON.stringify(await order(page))}`);

  // Esc
  await enterEdit(page);
  await eye(page, 'floating').click();
  await page.keyboard.press('Escape');
  await sleep(200);
  check('按 Esc 取消編輯，工具列與進入前完全相同（FR-4、驗收 1）', !(await editing(page)) && JSON.stringify(await order(page)) === JSON.stringify(before));
  const focus = await inToolbar(page, `return root.activeElement?.dataset.button ?? null`);
  check('離開編輯模式後焦點回到「更多」', focus === 'more', String(focus));

  // 編輯模式中換頁（FR-5）
  await enterEdit(page);
  await eye(page, 'video').click();
  await page.evaluate(() => window.__fixtureNavigate('bbbbbbbbbbb'));
  await sleep(500);
  check('編輯模式中換頁，自動取消編輯（FR-5、驗收 8）', !(await editing(page)) && (await order(page)).left === DEFAULT_LEFT, JSON.stringify(await order(page)));
  void context;
});

// ---------------------------------------------------------------------------
// 隱藏、其他工具、提示圓點、說明面板（FR-15 至 FR-17、FR-25，驗收 2、7、9）
// ---------------------------------------------------------------------------
await section('hidden', async (page) => {
  await enterEdit(page);
  await eye(page, 'loop').click();
  await eye(page, 'floating').click();
  const items = await editItems(page);
  const hiddenLook = await inToolbar(
    page,
    `const i = root.querySelector('.ytm-edit-item[data-item="loop"]'); return { mark: !!i.querySelector('.ytm-edit-hidden-mark'), opacity: getComputedStyle(i.querySelector('.ytm-edit-tool > .ytm-icon')).opacity,
       eyeLabel: i.querySelector('.ytm-edit-eye').getAttribute('aria-label'), outline: getComputedStyle(root.querySelector('.ytm-toolbar')).borderStyle }`,
  );
  check('隱藏的工具半透明並有「隱藏」標記；眼睛按鈕改為「顯示」；工具列有虛線外框（FR-10、FR-11、外觀）', items.includes('-loop') && items.includes('-floating') && hiddenLook.mark && Number(hiddenLook.opacity) < 0.5 && hiddenLook.eyeLabel === 'Show Loop' && hiddenLook.outline === 'dashed', JSON.stringify({ items, ...hiddenLook }));
  await shot(page, 'T33-edit-mode-en.png');
  await editButton(page, 'Done').click();
  await sleep(300);
  const o = await order(page);
  check('按「完成」：工具列不再顯示循環播放與浮動播放器（驗收 2）', o.right === 'darkMode cinema pip help more close', JSON.stringify(o));

  // 「更多」的其他工具
  await openMore(page);
  const other = await inToolbar(
    page,
    `return [...root.querySelectorAll('.ytm-other-item')].map((li) => li.dataset.tool + ':' + li.querySelector('.ytm-other-name').textContent + ':' + (li.querySelector('[role="switch"]')?.getAttribute('aria-checked') ?? 'button'))`,
  );
  check('「更多」面板出現「其他工具」，列出隱藏的工具（圖示＋名稱，切換類顯示開關狀態）（FR-15）', other.join('|') === 'floating:Floating player:false|loop:Loop:button', other.join('|'));
  await shot(page, 'T32-more-other-tools-en.png');
  // 切換類：開關浮動播放器
  await page.locator('ytm-toolbar .ytm-other-item[data-tool="floating"] [role="switch"]').click();
  await sleep(300);
  const floatingOn = await inToolbar(page, `return root.querySelector('.ytm-other-item[data-tool="floating"] [role="switch"]').getAttribute('aria-checked')`);
  check('從「其他工具」開啟浮動播放器，列上的開關變為開啟（FR-15、驗收 2）', floatingOn === 'true');
  const dotFloating = await inToolbar(page, `return root.querySelector('.ytm-btn[data-button="more"]').hasAttribute('data-dot')`);
  check('隱藏的浮動播放器開啟中，「更多」按鈕顯示提示圓點（FR-17）', dotFloating);
  await page.locator('ytm-toolbar .ytm-other-item[data-tool="floating"] [role="switch"]').click();
  await sleep(300);
  check('關閉後提示圓點消失', !(await inToolbar(page, `return root.querySelector('.ytm-btn[data-button="more"]').hasAttribute('data-dot')`)));

  // 面板類：展開循環播放面板，對齊「更多」按鈕
  await page.locator('ytm-toolbar .ytm-other-item[data-tool="loop"] button').click();
  await page.waitForSelector('ytm-toolbar .ytm-panel #ytm-loop-times');
  const align = await inToolbar(
    page,
    `const p = root.querySelector('.ytm-panel').getBoundingClientRect(); const m = root.querySelector('.ytm-btn[data-button="more"]').getBoundingClientRect();
     return { panelLeft: p.left, panelRight: p.right, moreLeft: m.left, moreRight: m.right, title: root.querySelector('.ytm-panel-title')?.textContent, more: !!root.querySelector('.ytm-more') }`,
  );
  check(
    '點「循環播放」：收起「更多」，展開循環播放面板，對齊「更多」按鈕（FR-15、驗收 2）',
    !align.more && align.title === 'Loop' && (Math.abs(align.panelRight - align.moreRight) <= 1 || Math.abs(align.panelLeft - align.moreLeft) <= 1),
    JSON.stringify(align),
  );
  await shot(page, 'T32-hidden-loop-panel.png');
  // 循環中
  await page.locator('ytm-toolbar .ytm-panel #ytm-loop-times').fill('99');
  await page.locator('ytm-toolbar .ytm-panel .ytm-button-primary').click();
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(300);
  const dotLoop = await inToolbar(page, `const b = root.querySelector('.ytm-btn[data-button="more"]'); return { dot: b.hasAttribute('data-dot'), label: b.getAttribute('aria-label'), focus: root.activeElement?.dataset.button }`);
  check('隱藏的循環播放進行中，「更多」按鈕顯示提示圓點與說明（FR-17、驗收 7）', dotLoop.dot && dotLoop.label === 'More (a hidden tool is in use)', JSON.stringify(dotLoop));
  check('從「更多」開啟的面板收起後焦點回到「更多」', dotLoop.focus === 'more', dotLoop.focus);
  await shot(page, 'T32-more-dot.png');

  // 執行類：截圖
  await openMore(page);
  await page.waitForSelector('ytm-toolbar .ytm-other-item[data-tool="loop"] .ytm-other-dot');
  check('「其他工具」中進行中的工具有圓點', true);
  await page.keyboard.press('Escape');

  // 說明面板
  await button(page, 'help').click();
  await page.waitForSelector('ytm-toolbar .ytm-help');
  const help = await inToolbar(page, `return { items: [...root.querySelectorAll('.ytm-help-item')].map((i) => i.dataset.button).join(' '), note: root.querySelector('.ytm-help-hidden')?.textContent ?? null }`);
  check(
    '說明面板只列出顯示中的工具，最後一行說明隱藏的工具可以從「更多」使用（FR-25、驗收 9）',
    help.items === `${DEFAULT_LEFT} darkMode cinema pip help more close` && help.note === 'Hidden tools are available from the “More” menu.',
    JSON.stringify(help),
  );
  await page.keyboard.press('Escape');

  // 隱藏截圖：從「其他工具」執行
  await enterEdit(page);
  await eye(page, 'screenshot').click();
  await editButton(page, 'Done').click();
  await sleep(300);
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.pause();
    v.currentTime = 1;
  });
  await openMore(page);
  await page.locator('ytm-toolbar .ytm-other-item[data-tool="screenshot"] button').click();
  await sleep(800);
  const shotStatus = await inToolbar(page, `return root.querySelector('.ytm-other-item[data-tool="screenshot"] .ytm-other-desc')?.textContent ?? null`);
  check('執行類（截圖）：從「其他工具」點擊即執行，列上顯示結果（FR-15）', !!shotStatus, String(shotStatus));
});

// ---------------------------------------------------------------------------
// 拖曳、分隔點、重新整理、跨分頁（FR-12、FR-21，驗收 3）
// ---------------------------------------------------------------------------
await section('drag', async (page, context) => {
  const other = await context.newPage();
  await openWatch(other, WATCH);
  await enterEdit(page);
  const ind = await dragTo(page, 'mp3', 'video', 'before');
  await dragTo(page, 'screenshot', 'darkMode', 'before');
  const items = await editItems(page);
  check('拖曳時顯示插入位置的指示線（FR-12）', ind);
  check('把 MP3 拖到最左邊、截圖拖到分隔點右邊（FR-12）', items === 'mp3 video thumbnail subtitles link separator screenshot darkMode cinema pip floating loop help', items);
  // 拖曳分隔點
  await dragTo(page, 'separator', 'link', 'before');
  const sepItems = await editItems(page);
  check('分隔點可以拖到任何兩個工具之間（FR-12）', sepItems === 'mp3 video thumbnail subtitles separator link screenshot darkMode cinema pip floating loop help', sepItems);
  await dragTo(page, 'separator', 'screenshot', 'before');
  await editButton(page, 'Done').click();
  await sleep(500);
  const o = await order(page);
  const want = { left: 'mp3 video thumbnail subtitles link', right: 'screenshot darkMode cinema pip floating loop help more close' };
  check('按「完成」：順序正確（驗收 3）', JSON.stringify(o) === JSON.stringify(want), JSON.stringify(o));
  const geo = await inToolbar(
    page,
    `const t = root.querySelector('.ytm-toolbar').getBoundingClientRect(); const l = root.querySelector('.ytm-group[data-group="left"]').getBoundingClientRect(); const r = root.querySelector('.ytm-group[data-group="right"]').getBoundingClientRect();
     return { left: Math.round(l.left - t.left), right: Math.round(t.right - r.right), gap: Math.round(r.left - l.right) }`,
  );
  check('左組靠左、右組（含截圖）靠右對齊（驗收 3）', geo.left === 0 && geo.right === 0 && geo.gap > 0, JSON.stringify(geo));
  const otherOrder = await order(other);
  check('其他已開啟的 YouTube 分頁立即套用（FR-21、驗收 3）', JSON.stringify(otherOrder) === JSON.stringify(want), JSON.stringify(otherOrder));
  await page.reload();
  await page.waitForSelector('ytm-toolbar', { state: 'attached' });
  await sleep(500);
  check('重新整理後維持（驗收 3）', JSON.stringify(await order(page)) === JSON.stringify(want), JSON.stringify(await order(page)));
  await shot(page, 'T33-custom-toolbar.png');

  // 編輯中收到其他分頁的變更：保留自己的編輯，「完成」時以自己的結果覆寫（plan 3.7.3）
  await enterEdit(page);
  await eye(page, 'help').click();
  await enterEdit(other);
  await eye(other, 'video').click();
  await editButton(other, 'Done').click();
  await sleep(400);
  const stillEditing = (await editing(page)) && (await editItems(page)).includes('-help') && !(await editItems(page)).includes('-video');
  await editButton(page, 'Done').click();
  await sleep(400);
  const final = await order(other);
  check('編輯中的分頁收到其他分頁的變更時保留自己的編輯，「完成」後以自己的結果覆寫（plan 3.7.3）', stillEditing && final.left.includes('video') && !final.right.includes('help'), JSON.stringify(final));

  // 重設為預設
  await enterEdit(page);
  await editButton(page, 'Reset to default').click();
  const resetItems = await editItems(page);
  check('「重設為預設」後仍停留在編輯模式，顯示預設狀態（FR-4）', (await editing(page)) && resetItems === `${DEFAULT_LEFT} separator darkMode cinema pip floating loop help`, resetItems);
  await editButton(page, 'Done').click();
  await sleep(400);
  const back = await order(page);
  check('按「完成」後回到預設（驗收 5）', back.left === DEFAULT_LEFT && back.right === DEFAULT_RIGHT && (await order(other)).right === DEFAULT_RIGHT, JSON.stringify(back));
});

// ---------------------------------------------------------------------------
// 鍵盤（FR-13，驗收 4）
// ---------------------------------------------------------------------------
await section('keyboard', async (page) => {
  // 以鍵盤打開「更多」並進入編輯模式
  await button(page, 'more').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('ytm-toolbar .ytm-more-edit');
  await page.locator('ytm-toolbar .ytm-more-edit').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('ytm-toolbar .ytm-toolbar[data-editing]');
  // 焦點在「影片」：Tab 到 MP3，← 移到最左邊
  await page.keyboard.press('Tab');
  const focused = await inToolbar(page, `return root.activeElement?.closest('.ytm-edit-item')?.dataset.item`);
  await page.keyboard.press('ArrowLeft');
  const afterMove = await editItems(page);
  const stillFocused = await inToolbar(page, `return root.activeElement?.closest('.ytm-edit-item')?.dataset.item`);
  // 空白鍵隱藏 MP3
  await page.keyboard.press(' ');
  const afterHide = await editItems(page);
  // Tab 到分隔點（MP3、影片、縮圖、字幕、截圖、連結、分隔點），→ 移一格
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  const sepFocus = await inToolbar(page, `return root.activeElement?.closest('.ytm-edit-item')?.dataset.item`);
  await page.keyboard.press('ArrowLeft');
  const afterSep = await editItems(page);
  await page.keyboard.press('Enter');
  await sleep(300);
  const o = await order(page);
  check('Tab 聚焦工具，← 移動位置，焦點留在同一個工具（FR-13）', focused === 'mp3' && afterMove.startsWith('mp3 video') && stillFocused === 'mp3', `${focused} ${afterMove}`);
  check('空白鍵切換顯示／隱藏（FR-13）', afterHide.startsWith('-mp3 video'), afterHide);
  check('Tab 可以聚焦分隔點並以方向鍵移動（FR-13）', sepFocus === 'separator' && afterSep.includes('screenshot separator link'), `${sepFocus} ${afterSep}`);
  check('Enter 等同「完成」（FR-13、驗收 4）', !(await editing(page)) && o.left === 'video thumbnail subtitles screenshot' && o.right.startsWith('link darkMode'), JSON.stringify(o));
});

// ---------------------------------------------------------------------------
// 設定頁的「工具列」區（FR-2、FR-22，驗收 6）
// ---------------------------------------------------------------------------
await section('options', async (page, context) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${EXT_ID}/options.html`);
  await opt.waitForSelector('#toolbar-list .toolbar-row');
  await opt.waitForFunction(() => !document.querySelector('#toolbar-list').hasAttribute('aria-busy'));
  const rows = () => opt.evaluate(() => [...document.querySelectorAll('#toolbar-list .toolbar-row')].map((r) => (r.hasAttribute('data-hidden') ? '-' : '') + r.dataset.item).join(' '));
  const info = await opt.evaluate(() => ({
    title: document.querySelector('#toolbar-title').textContent,
    first: document.querySelector('#app .section').id,
    row: (() => {
      const r = document.querySelector('#toolbar-list .toolbar-row[data-item="mp3"]');
      return { handle: !!r.querySelector('.toolbar-handle svg'), icon: !!r.querySelector('.toolbar-name svg'), name: r.querySelector('.toolbar-name').textContent, switch: r.querySelector('[role="switch"]').checked, buttons: [...r.querySelectorAll('.icon-button')].map((b) => b.getAttribute('aria-label')) };
    })(),
    reset: document.querySelector('#toolbar-reset').disabled,
  }));
  check(
    '設定頁有「工具列」區：每列有拖曳把手、圖示、名稱、開關、上移、下移；分隔點也是一列（FR-2、FR-22）',
    info.title === 'Toolbar' && info.row.handle && info.row.icon && info.row.name === 'MP3' && info.row.switch && info.row.buttons.join('|') === 'Drag to reorder: MP3|Move MP3 up|Move MP3 down' && (await rows()) === `${DEFAULT_LEFT} separator darkMode cinema pip floating loop help`,
    JSON.stringify(info),
  );
  check('預設狀態時「重設為預設」停用', info.reset);
  await opt.screenshot({ path: join(shots, 'T34-options-toolbar-en.png'), clip: await opt.locator('#toolbar').boundingBox().then((b) => ({ x: 0, y: b.y - 8, width: 1280, height: b.height + 16 })) });

  // 上移、下移、開關
  await opt.locator('#toolbar-list .toolbar-row[data-item="mp3"] .icon-button[aria-label="Move MP3 up"]').click();
  await opt.locator('#toolbar-list .toolbar-row[data-item="link"] .icon-button[aria-label="Move Link down"]').click();
  await opt.locator('#toolbar-visible-loop').click();
  await sleep(400);
  const r1 = await rows();
  check('上移、下移、開關（FR-22、驗收 6）', r1 === 'mp3 video thumbnail subtitles screenshot separator link darkMode cinema pip floating -loop help', r1);
  const focusKept = await opt.evaluate(() => document.activeElement?.id);
  check('操作後焦點留在同一個控制項', focusKept === 'toolbar-visible-loop', String(focusKept));
  const o1 = await order(page);
  check('變更立即反映到已開啟的 YouTube 分頁（FR-22、驗收 6）', o1.left === 'mp3 video thumbnail subtitles screenshot' && o1.right === 'link darkMode cinema pip floating help more close', JSON.stringify(o1));

  // 拖曳把手
  const handle = await opt.locator('#toolbar-list .toolbar-row[data-item="help"] .toolbar-handle').boundingBox();
  const target = await opt.locator('#toolbar-list .toolbar-row[data-item="mp3"]').boundingBox();
  await opt.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await opt.mouse.down();
  await opt.mouse.move(handle.x + handle.width / 2, handle.y - 10, { steps: 2 });
  await opt.mouse.move(handle.x + handle.width / 2, target.y + 4, { steps: 10 });
  const indicator = await opt.evaluate(() => !document.querySelector('.toolbar-indicator').hidden);
  await opt.mouse.up();
  await sleep(400);
  const r2 = await rows();
  check('拖曳把手調整順序，拖曳中顯示插入位置（FR-22、驗收 6）', r2.startsWith('help mp3 video') && indicator, r2);
  // 鍵盤：把手上按 ↓
  await opt.locator('#toolbar-list .toolbar-row[data-item="help"] .toolbar-handle').focus();
  await opt.keyboard.press('ArrowDown');
  await sleep(300);
  check('把手上按 ↓ 下移一格', (await rows()).startsWith('mp3 help video'), await rows());
  const o2 = await order(page);
  check('拖曳的結果立即反映到 YouTube 分頁', o2.left.startsWith('mp3 help video'), JSON.stringify(o2));
  await opt.screenshot({ path: join(shots, 'T34-options-toolbar-custom.png'), clip: await opt.locator('#toolbar').boundingBox().then((b) => ({ x: 0, y: b.y - 8, width: 1280, height: b.height + 16 })) });

  // 在 YouTube 上編輯後，設定頁跟著更新
  await enterEdit(page);
  await eye(page, 'pip').click();
  await editButton(page, 'Done').click();
  await sleep(500);
  check('在 YouTube 上編輯後，設定頁的清單跟著更新', (await rows()).includes('-pip'), await rows());

  // 重設
  await opt.locator('#toolbar-reset').click();
  await sleep(400);
  const o3 = await order(page);
  check('設定頁「重設為預設」：清單與 YouTube 分頁都回到預設', (await rows()) === `${DEFAULT_LEFT} separator darkMode cinema pip floating loop help` && o3.left === DEFAULT_LEFT && o3.right === DEFAULT_RIGHT, JSON.stringify(o3));

  // 非法資料：以預設值顯示
  await opt.evaluate(() => chrome.storage.sync.set({ toolbarLayout: { version: 1, items: [{ id: 'loop', visible: false }, { id: 'evil' }, 'x'] } }));
  await sleep(500);
  const o4 = await order(page);
  check('設定中有不認得的工具或格式錯誤時忽略，缺少的工具加回所屬組（FR-24）', !o4.right.includes('loop') && o4.left === DEFAULT_LEFT && o4.right === 'darkMode cinema pip floating help more close', JSON.stringify(o4));
  await opt.evaluate(() => chrome.storage.sync.set({ toolbarLayout: 'garbage' }));
  await sleep(500);
  const o5 = await order(page);
  check('設定不是正確格式時使用預設值（NFR-2）', o5.left === DEFAULT_LEFT && o5.right === DEFAULT_RIGHT, JSON.stringify(o5));
});

// ---------------------------------------------------------------------------
// 繁體中文
// ---------------------------------------------------------------------------
await section(
  'zh',
  async (page, context) => {
    await enterEdit(page);
    await eye(page, 'loop').click();
    await eye(page, 'floating').click();
    const zh = await inToolbar(page, `return { actions: [...root.querySelectorAll('.ytm-edit-actions button')].map((b) => b.textContent).join('|'), help: root.querySelector('.ytm-edit-help').textContent }`);
    check('繁體中文的編輯模式', zh.actions === '重設為預設|取消|完成' && zh.help === '拖曳調整順序，點眼睛圖示顯示或隱藏。隱藏的工具可以從「更多」選單使用。', JSON.stringify(zh));
    await shot(page, 'T33-edit-mode-zh-TW.png');
    await editButton(page, '完成').click();
    await sleep(300);
    await openMore(page);
    const title = await inToolbar(page, `return root.querySelector('.ytm-other-title').textContent + '|' + root.querySelector('.ytm-more-edit').textContent`);
    check('繁體中文的「其他工具」與「編輯工具列」', title === '其他工具|編輯工具列', title);
    await shot(page, 'T32-more-other-tools-zh-TW.png');
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${EXT_ID}/options.html`);
    await opt.waitForSelector('#toolbar-list .toolbar-row[data-hidden]');
    await opt.screenshot({ path: join(shots, 'T34-options-toolbar-zh-TW.png'), clip: await opt.locator('#toolbar').boundingBox().then((b) => ({ x: 0, y: b.y - 8, width: 1280, height: b.height + 16 })) });
    const text = await opt.locator('#toolbar-title').textContent();
    check('繁體中文的設定頁工具列區', text === '工具列');
  },
  { lang: 'zh-TW' },
);

void storedLayout;
if (!summary()) process.exitCode = 1;
