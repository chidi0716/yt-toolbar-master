# T06b 深色模式即時切換

日期：2026-10-21　負責：實作方

> 本筆記的做法已被 T06d 取代（已登入時無法改變帳號的外觀設定，QUESTIONS Q20），改為操作 YouTube 自己的外觀選單，見 [`T06d-dark-mode-menu.md`](./T06d-dark-mode-menu.md)。以下實測內容保留作為紀錄。

## 結論

1. **YouTube 自己的外觀選單（未登入）其實會重新載入頁面**，不是即時切換：選「Dark theme」後 YouTube 寫入 `PREF`，約 2 ms 後就觸發 `beforeunload` 開始重新載入（`results-menu-timing.txt`）。重新載入後與切換前相比，`<html>` 只差 `dark` 一個屬性；頂端列 `ytd-masthead` 多了 `dark`、`page-dark-theme`（`results-menu-attrs.txt`）。登入帳號的選單是否即時切換，本環境無法驗證。
2. **只切換 `<html dark>` 不夠**（`results-instant-html.txt`、`results-load-diff.txt`、`results-rules-*.txt`）：
   - YouTube 依載入時的主題輸出**不同的主樣式表**（網址的 `am=` 參數不同）。樣式表中 `:root` 的顏色變數預設值就是載入時的主題，另有 `[dark]`、`[light]` 兩組覆寫。所以以深色載入的頁面只移除 `dark` 時整頁仍是深色（85 個元素種類中 55 個顏色不同），**必須在 `<html>` 加上 `light`**。以淺色載入的頁面加上 `dark` 即可。
   - YouTube 還依主題在幾個元素上設定布林屬性：`ytd-masthead[dark][page-dark-theme]`、`ytd-watch-flexy[is-dark-theme]`、`ytd-playlist-panel-renderer[is-dark-theme]`、`ytd-feed-nudge-renderer[is-dark-mode]`（觀看頁另有 `yt-chip-cloud-renderer[is-dark-theme]`，YouTube 換頁時會依目前的主題自己設定）。不改頂端列的屬性時，搜尋框等 8 處顏色不對。
   - 少數顏色變數（實測 4–6 個，例如觀看頁「訂閱」按鈕的文字色、登入提示的邊框）被 YouTube 以 **`:root:root`** 依載入時的主題固定，比 `[dark]`／`[light]` 優先，只切換屬性不會變。只切換屬性時，切到深色後「訂閱」按鈕變成白底白字（`results-watch-rules.txt`、`results-pinned-vars.txt`）。
   - `<html>` 其他屬性（`darker-dark-theme`、`darker-dark-theme-deprecate`、`system-icons`、`color-version`、`typography`、`typography-spacing`）兩種主題都相同，不需要改。
3. **YouTube 會在站內換頁時改回去**：
   - 依載入時的主題把 `ytd-masthead` 的 `dark` 改回去（`results-instant-html*.txt` 的 `reverts`）。
   - YouTube 的偏好模組有時會以**記憶中的舊值改寫 `PREF`**：換頁到 Shorts 時寫入 `f6=80000&tz=UTC&f7=100`，主題旗標回到載入時的值（`results-instant-html.txt`、`results-instant-html-masthead.txt`；另外三次實測寫入的是新值，`results-pref-writer*.txt`）。不處理的話，重新整理後會回到舊主題。
   - 等待 10 秒內 YouTube 不會自己改回 `<html>` 的屬性。

## 做法（`features/viewing/dark-mode.ts`、`utils/youtube/dom.ts`、`features/viewing/theme-logic.ts`）

按下按鈕時：

| 步驟 | 內容 |
|---|---|
| 1. 主題偏好 | 與 T06a 相同：只改 `PREF` 的 `f6` 主題位元並確認寫入成功（失敗時不切換）。 |
| 2. `<html>` | 深色：設定 `dark`、移除 `light`；淺色：移除 `dark`、設定 `light`。 |
| 3. 元素屬性 | `THEMED_ELEMENTS`（`dom.ts`）中的元素：深色時設定、淺色時移除。 |
| 4. 被固定的變數 | 讀取頁面樣式表，找出 `:root:root` 固定的變數，改用同一份樣式表中新主題（`[dark]` 或 `[light]`）的值，以 `:root:root:root` 的規則覆寫（`<style id="ytm-theme-pinned">`，以 CSSOM `setProperty` 逐一設定）。切回載入時的主題時移除這個 `<style>`。掃描全部規則約 65 ms，只在按下按鈕與 YouTube 新增樣式表時進行。 |
| 5. 確認與退回 | 600 ms 後檢查頁面背景色（`ytd-app`，透明時看 `<html>`）是否屬於新主題；不是時在 console 記錄 `instant switch did not take effect; reloading` 並退回 T06a 的「改偏好後重新載入」（FR-16）。 |

切換後到頁面結束前持續維持（`createThemeKeeper`）：

- `MutationObserver` 觀察上述主題屬性；元素屬性被改回去時補回（每秒超過 50 次時停止，避免與 YouTube 互相拉扯）。
- 每秒檢查一次 `PREF`，以及站內換頁（`yt-navigate-finish`）時檢查；主題旗標與按下的主題不同、且持續超過 1 秒時改回，**其他欄位（例如 YouTube 新加的 `f7`）原樣保留**。等 1 秒是為了不蓋掉 YouTube 選單的選擇：YouTube 選單寫入後 2 ms 內就開始重新載入，而維持程式在 `beforeunload`／`pagehide` 時停止。
- `<html>` 的 `dark` 被別人改掉（例如登入帳號的 YouTube 選單即時切換）時，視為 YouTube 自己切換主題：移除擴充功能加的 `light` 與覆寫的 `<style>`，停止維持，按鈕跟著更新（FR-12）。
- 工具列關閉（FR-5）時只停止更新按鈕，已切換的主題繼續維持到頁面結束（FR-14，見 QUESTIONS Q18）。

**沒有新增頁面橋接請求**：屬性、樣式表與 cookie 在 isolated world 就能讀寫（與頁面共用同一份 DOM），不需要在 main world 設定，所以沒有新增 `setTheme`，橋接白名單不變。

## 實測結果

### YouTube 首頁，擴充功能實際的模組（`probe-home.mjs`，`results-home.txt`）

工具列只在觀看頁出現，而觀看頁直接載入會被驗證頁擋住，所以把 `features/viewing/dark-mode.ts` 打包（`harness.ts`）後放進首頁執行。參考值是以該主題載入首頁時每種元素（tag#id.class）第一個可見元素的背景、文字、邊框顏色。

| 起始 → 目標 | 不重新載入 | 下一個畫面 | 整頁顏色 | 10 秒後 | 換頁（Shorts、You、首頁） | 重新整理 |
|---|---|---|---|---|---|---|
| 淺色 → 深色 | 是 | `rgb(15,15,15)` | 85 種全部相同 | 不變 | 維持；YouTube 以舊值改寫 `PREF`，1–2 秒後恢復為 `f6=400&tz=UTC&f7=100` | 深色 |
| 深色 → 淺色 | 是 | `rgb(255,255,255)` | 0 種不同，1 種近似（登入按鈕邊框 `rgba(0,0,0,0.1)`，原生為 `0.2`） | 不變 | 維持 | 淺色 |
| 未設定 → 深色 | 是 | `rgb(15,15,15)` | 87 種全部相同 | 不變 | 維持；同樣恢復被改寫的 `PREF` | 深色 |
| 深色 → 淺色 → 深色 | 是 | — | 全部相同（移除覆寫） | — | — | — |

「下一個畫面」：按下後同一個工作中的計算值與之後兩個 `requestAnimationFrame` 的 `ytd-app` 背景色都已經是新主題，沒有閃一下舊主題或白畫面。截圖：`screenshots/T06b-home-light-before.png` → `T06b-home-light-after.png`（淺色→深色）、`T06b-home-dark-before.png` → `T06b-home-dark-after.png`（深色→淺色）。

### 觀看頁（`probe-watch-spa.mjs`，`results-watch-spa.txt`）

觀看頁直接載入會被擋，但從首頁以站內換頁（頂端列搜尋 → 點影片）可以進入。比較「首頁即時切換後換頁進觀看頁」與「以該主題載入首頁、同樣換頁進觀看頁」：

- 淺色 → 深色：主題屬性完全相同；播放器外 182 種元素的顏色全部相同（含「訂閱」按鈕）。
- 深色 → 淺色：主題屬性完全相同；191 種中 0 種不同、5 種近似：「訂閱」按鈕文字 `#fff`（原生 `#f1f1f1`，黑底白字，可讀）與其內部元件、一個按鈕邊框的不透明度 `0.1`（原生 `0.2`）。原因是固定的變數改用 YouTube 樣式表中 `[light]` 的值，與以淺色載入時固定的值有些微差異。
- 影片本身在本環境無法播放（顯示 Video unavailable），與主題無關。

### 假觀看頁（`spikes/stage1-smoke/viewing-test.mjs` 的 T06）

假觀看頁依上面的實測模擬 YouTube：`:root` 預設為載入時的主題、`[dark]`／`[light]` 覆寫、`:root:root` 固定的「訂閱」文字色、頂端列與 `ytd-watch-flexy` 的主題屬性、站內換頁時把頂端列屬性與 `PREF` 改回舊值（另加 `f7=100`）。網址帶 `fixture_static_theme=1` 時不輸出 `[dark]`／`[light]`，用來測試退回重新載入。

- 深色、淺色、未設定（裝置深色）三種起始狀態都即時切換，不重新載入、影片持續播放、背景只改變一次（沒有閃回），顏色與以該主題載入時相同（「訂閱」文字 `#fff`≈`#f1f1f1`）。
- 10 秒後不變；站內換頁後屬性與 `PREF` 都恢復（`f5=30000&f6=408&hl=en&tz=UTC&f7=100`）；重新整理後維持。
- 從 YouTube 選單切換時按鈕同步；按鈕切換後再從選單切換，以 YouTube 的選擇為準。
- 即時切換沒有生效時退回重新載入，保留影片與時間點，並在 console 記錄原因。
- 截圖：`screenshots/T06b-dark-from-light.png`、`screenshots/T06b-light-from-dark.png`。

## 已知限制（寫入 QUESTIONS Q18）

- 從深色切到淺色時，少數被固定的顏色與以淺色載入時有些微差異（上面列出的近似值）；重新整理後完全相同。
- YouTube 以舊值改寫 `PREF` 後，擴充功能 1–2 秒內才改回；在這段時間內重新整理，會回到舊主題（按鈕狀態仍正確反映實際主題，再按一次即可）。
- 登入帳號的外觀選單與「使用裝置主題」仍無法在本環境驗證（Q15）。

## 給專案擁有者的手動驗證步驟

在 Chrome 與 Zen（或 Firefox）載入最新建置，打開任一影片頁並播放。以 YouTube「外觀」選單設定起始狀態（深色、淺色、使用裝置主題各測一次，登入與未登入各測一次）：

1. 按深色模式按鈕：**頁面不重新載入、影片繼續播放**，整頁（頂端列、搜尋框、側欄、標題、「訂閱」按鈕、說明、留言、右側清單）立即變成另一個主題，沒有白畫面閃爍；按鈕狀態跟著改變。
2. 等 10 秒、在 YouTube 內點其他影片或 Shorts，主題不會被改回去。
3. 重新整理、重新開啟瀏覽器後維持；YouTube「外觀」選單顯示對應的主題。
4. 再按一次回到原本的主題。
5. 從 YouTube「外觀」選單切換主題時，按鈕狀態跟著改變。
6. 若有任何一步不符合，請記下瀏覽器、是否登入、開發者工具 console 中 `[yt-toolbar-master]` 開頭的訊息，以及 `PREF` cookie 的值。

## 檔案

實測腳本與原始輸出在 `spikes/T06b/`（都沒有載入擴充功能；`harness.ts` 只在實測中把擴充功能的模組放進頁面）：

| 檔案 | 內容 |
|---|---|
| `probe-menu-attrs.mjs` | YouTube 外觀選單切換前後的屬性差異與是否重新載入 |
| `probe-menu-timing.mjs` | YouTube 選單寫入 `PREF` 與開始重新載入的時間差 |
| `probe-instant.mjs` | 只切換 `<html>`（`MODE=html`）或加上頂端列（`MODE=html+masthead`）的效果、10 秒後、換頁、重新整理 |
| `probe-load-diff.mjs` | 以深色與淺色載入時的差異（屬性、樣式表） |
| `probe-rules.mjs`、`probe-nudge*.mjs`、`probe-watch-rules.mjs`、`probe-pinned-vars.mjs` | 決定顏色的規則與 `:root:root` 固定的變數 |
| `probe-pref-writer.mjs` | 換頁時寫入 `PREF` 的來源 |
| `probe-home.mjs`、`probe-watch-spa.mjs`、`compare.mjs` | 擴充功能實際模組在首頁與觀看頁的驗收 |

YouTube 觀看頁直接載入時顯示驗證頁，沒有嘗試繞過；觀看頁的檢查只用站內換頁進入，每個情境只嘗試一次。
