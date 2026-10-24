# T06d 深色模式改為操作 YouTube 外觀選單

日期：2026-10-21　負責：實作方

## 結論

按下深色模式按鈕時，擴充功能代替使用者操作 YouTube 自己的「外觀」選單：

1. 在 `<html>` 加上暫時的 `yte-theme-menu-busy`，CSS 讓 `ytd-popup-container tp-yt-iron-dropdown`（YouTube 的彈出選單）`opacity: 0`、不接受滑鼠。
2. 點頂端列的帳號選單按鈕（已登入：頭像；未登入：設定）。
3. 等「外觀」項目出現後點它。
4. 透過頁面橋接請 main world 在外觀子選單的選項上標記主題，再點目標選項。
5. 等 `<html dark>` 變成目標主題，或 YouTube 自己開始重新載入頁面。
6. 若沒有重新載入：選單仍打開時再點一次按鈕關閉它，等選單收起後移除暫時 class。整個操作最多 5 秒（已登入時選單內容向伺服器載入）。

擴充功能不再修改 `PREF`、頁面主題屬性或顏色變數。T06a／T06b 的程式與測試已移除（`theme-logic.ts`、`theme-pref.test.ts`、`dom.ts` 中的 PREF 與主題屬性函式）。按鈕狀態仍只看 `<html dark>`。找不到選單或選項時不做任何修改，在 console 記錄原因，按鈕提示顯示「無法切換，請使用 YouTube 的外觀設定」4 秒（FR-15）。

## 外觀子選單的辨識方式與證據

實測：YouTube 首頁，未登入，英文與繁體中文介面各一次（`spikes/T06d/probe-menu-structure.mjs`、`probe-menu-data.mjs`、`results-menu-*.txt`）。

| 層級 | 辨識方式 | 證據 |
|---|---|---|
| 選單按鈕 | `ytd-masthead #end button#avatar-btn`（已登入，未實測）；否則 `ytd-masthead #end #buttons` 中**最後一個** `ytd-topbar-menu-button-renderer` 的 `button`（未登入時只有一個，是設定按鈕） | 未登入時 `#buttons` 中只有設定按鈕的 `ytd-topbar-menu-button-renderer` 與登入按鈕（`ytd-button-renderer`） |
| 彈出選單 | `ytd-popup-container tp-yt-iron-dropdown` | 打開後只有一個，父元素是 `ytd-popup-container` |
| 「外觀」項目 | 專用元件 **`ytd-toggle-theme-compact-link-renderer`**（其他項目都是 `ytd-compact-link-renderer`） | 兩種語言相同；其 data 的 `primaryIcon.iconType` 為 `DARK_THEME` |
| 子選單選項 | `ytd-popup-container #submenu ytd-compact-link-renderer` | 未登入時有兩項（深色、淺色），沒有任何不依文字的 DOM 屬性 |
| 深色／淺色 | 元件 data 的 `serviceEndpoint.signalServiceEndpoint.actions[].signalAction.signal`：**`TOGGLE_DARK_THEME_ON`** = 深色、**`TOGGLE_DARK_THEME_OFF`** = 淺色 | 英文與繁體中文介面的值相同；目前勾選的選項 data 帶 `icon.iconType: CHECK` |

data 是頁面 JavaScript 的屬性，只有 main world 讀得到（isolated world 的內容腳本看不到），所以頁面橋接新增 `markThemeOptions` 請求：

- 不帶參數，在目前子選單中依動作代號替選項加上 `data-yte-theme-option="dark|light"`；
- 先清除舊的標記，不點擊、不修改其他東西；
- 由內容腳本點擊標記的選項中的 `a#endpoint`。

不依顯示文字，也不依選項順序。假觀看頁的選項順序與文字刻意和 YouTube 不同，仍然選對。動作代號改變時會找不到選項，依 FR-15 處理，不會點錯。

## 首頁實測（未登入，擴充功能實際的模組，`probe-home.mjs`，`results-home.txt`）

工具列只在觀看頁出現，所以把頁面橋接處理與深色模式模組打包（`harness.ts`）後放進首頁執行。每個畫面記錄 YouTube 的彈出選單是否打開、是否看得見（含祖先的實際不透明度 > 0）。

| 情境 | 切換 | 選單打開的畫面／看得見的畫面 | YouTube 重新載入 | 外觀選單勾選 |
|---|---|---|---|---|
| 淺色 → 深色（英文） | 成功，`PREF` 由 YouTube 寫成 `f6=400` | 5／**0** | 是，選擇後約 250 ms | `TOGGLE_DARK_THEME_ON` |
| 深色 → 淺色（英文） | 成功，`f6=80000` | 6／**0** | 是，約 300 ms | `TOGGLE_DARK_THEME_OFF` |
| 淺色 → 深色（繁體中文） | 成功 | 5／**0** | 是，約 240 ms | `TOGGLE_DARK_THEME_ON` |
| 找不到選項（不處理橋接請求） | 不變，`PREF` 不變 | 326／**0**；結束後選單已關閉、暫時 class 已移除 | 否 | — |

- **是否重新載入**：未登入時，YouTube 自己的選單在選擇後會重新載入頁面（與 T06b 的觀察相同）。這是 YouTube 的行為，FR-11 要求與 YouTube 相同，擴充功能不另外處理。重新載入期間的畫面變化由 YouTube 決定。
- **是否閃現**：所有情境中 YouTube 的彈出選單都沒有任何一個畫面看得見。
- 「找不到選項」的情境中，YouTube 不會重新載入，所以由擴充功能自己關閉選單。這也驗證了已登入時（若 YouTube 不重新載入）關閉選單的流程：關閉後才移除暫時 class，收起過程看不到。
- 本環境無法登入，頭像選單與帳號設定的改變無法驗證（見下方手動步驟與 QUESTIONS Q21）。

## 假觀看頁（`spikes/stage1-smoke/viewing-test.mjs` 的 T06，13 項）

假觀看頁模擬設定／頭像選單與外觀子選單：按鈕、`ytd-popup-container`、`tp-yt-iron-dropdown`、`ytd-toggle-theme-compact-link-renderer`、`#submenu ytd-compact-link-renderer`，選項 data 帶動作代號。另外模擬 300 ms 的選單載入，以及一個不認識的「裝置主題」選項。網址參數可切換：選擇後重新載入（未登入）、沒有「外觀」項目、沒有選單按鈕。

- 淺色 → 深色 → 淺色：操作順序為 `open > appearance > select:TOGGLE_DARK_THEME_ON > close`。主題與 `PREF` 由假頁面（YouTube）改變，影片持續播放。選單打開 19 個畫面、看得見 0 個，完成後選單關閉、暫時 class 移除。
- 模擬未登入（選擇後重新載入）：重新載入前選單看得見 0 個畫面，載入後為淺色。
- 使用裝置主題（裝置深色）：選擇明確的淺色。
- 從 YouTube 選單切換時按鈕同步；工具列關閉時不改變主題。
- 沒有「外觀」項目、沒有選單按鈕：主題與 `PREF` 不變，選單關閉且沒有被看見，按鈕提示顯示 “Can't switch. Please use YouTube's Appearance setting.”，console 記錄原因（FR-15）。
- 截圖：`screenshots/T06d-dark-from-light.png`、`T06d-light-from-dark.png`、`T06d-unavailable.png`。

## 單元測試

- `features/viewing/appearance-menu.test.ts`：以假的頁面依賴測試流程，涵蓋以下情境：
  - 順序與關閉選單；
  - 選單已自己關閉時不再點按鈕；
  - YouTube 重新載入時不碰選單也不恢復可見；
  - 找不到按鈕、外觀項目、目標選項；
  - 選擇後主題沒變。
- `utils/youtube/appearance.test.ts`：依動作代號辨識選項，不受文字影響，其他代號與格式錯誤回傳 null。
- `utils/youtube/bridge.test.ts`：`markThemeOptions` 在白名單中、不接受參數、不需要播放器，沒有 `setTheme` 等其他請求。

## 給專案擁有者的手動驗證步驟（已登入）

在 Zen（以及 Chrome）載入最新建置，**已登入** YouTube，打開任一影片頁並播放：

1. 先用 YouTube 頭像選單 →「外觀」設成「深色主題」。確認整頁（含頂端搜尋列）深色，工具列深色模式按鈕為「開啟」。
2. 按深色模式按鈕。注意：
   - 過程中**看不到** YouTube 的頭像選單或外觀選單出現或閃一下；
   - 整頁（**含頂端搜尋列**）變成淺色，按鈕變成「關閉」；
   - 記下頁面有沒有重新載入、影片有沒有中斷（這由 YouTube 決定，請如實回報）。
3. 打開 YouTube 頭像選單 →「外觀」：應**勾選「淺色主題」**。
4. 重新整理、重新開啟瀏覽器，以及在另一台裝置或另一個瀏覽器登入同一帳號：都是淺色。
5. 再按一次按鈕：回到深色，頭像選單的「外觀」勾選「深色主題」。
6. 把「外觀」設成「使用裝置主題」再按一次：改為明確的深色或淺色（與目前顯示相反）。
7. 若按下後按鈕提示出現「無法切換，請使用 YouTube 的外觀設定」，或主題沒有改變，請回報：
   - 開發者工具 console 中 `[yt-toolbar-master]` 開頭的訊息（含括號中的原因代碼）；
   - 在 Elements 中選取頭像按鈕，它與上層幾個元素的 tag 與 id。

## T06e 失敗提示（003 FR-15、FR-91）

- 提示文字改為說明可能原因：「找不到 YouTube 的外觀選項。若安裝了會改變主題的擴充功能（例如氛圍光），請將其主題設定改為跟隨 YouTube。」（英文：“Couldn't find YouTube's Appearance option. If you use an extension that changes the theme (for example, an ambient light extension), set its theme to follow YouTube.”）。新增訊息 `darkModeUnavailableHint`，既有的 `darkModeUnavailable` 未修改（目前沒有使用）。
- 顯示約 6 秒；時間到時滑鼠仍停在按鈕上，提示留到滑鼠移開為止（`ToolbarButton` 的暫時訊息都適用）。較長的提示換行顯示，最寬 320px。
- console 記錄失敗的步驟，例如 `could not use YouTube's appearance menu (NO_APPEARANCE_ITEM): step 2/3 failed: the Appearance item was not found in the account/settings menu; nothing changed`。四種原因：
  - 步驟 1：選單按鈕；
  - 步驟 2：外觀項目；
  - 步驟 3：深色／淺色選項；
  - 選擇後主題沒有改變（可能是其他擴充功能接管了主題）。
- 失敗時不重試，不與其他擴充功能搶奪主題設定（FR-91）。
- 假觀看頁驗證：
  - 提示文字與 console 步驟（沒有「外觀」項目 → 步驟 2；沒有選單按鈕 → 步驟 1）；
  - 滑鼠移開時 5 秒仍在、7 秒已消失；
  - 滑鼠停在按鈕上時 7 秒後仍在、移開後消失。
- 截圖：`screenshots/T06e-unavailable-hint.png`。
