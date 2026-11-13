# 階段 13：實測回饋修正（T62–T66）

日期：2026-11-13　負責：實作方　規格：[`010-feedback-1`](../010-feedback-1/spec.md)、QUESTIONS Q79

## T62 「更多」中的開關加到工具列（010 第一節）

- **設定模型**（`utils/toolbar-layout.ts`）：工具加入 `smartPause`、`autoplay`、`audioOnly`、`wheelVolume`、`hideComments`（`DEFAULT_MORE`）。
  格式版本改為 2；版本 1 與 2 都能讀取，其他版本使用預設值。
  - 預設：006 的左組｜分隔點｜右組，之後是這 5 個開關（隱藏）。工具列的外觀與之前相同（FR-3）。
  - 隱藏的「更多」開關一律排在最後、依「更多」面板的順序（`canonical`）。所有操作的結果都經過這個整理，所以「顯示後再隱藏」等於沒動，`isDefaultLayout` 照常成立。
  - 合併規則：設定中沒有的「更多」開關以隱藏狀態加在最後；`visible` 不是布林值時使用該工具的預設。版本 1 的設定保留原本的順序與顯示。
  - 操作：`placeInToolbar`（從「更多」拖到工具列的某個位置並顯示）、`moveToMore`（放回「更多」）；`stepItem` 只在工具列那一列中移動；
    `toggleVisible` 對「更多」開關：顯示時加在工具列最後，隱藏時回到「更多」。`splitLayout` 多回傳 `more`；`hidden`（「其他工具」）不含它們。
- **工具列**：這 5 個工具是切換類按鈕，狀態與動作使用原本的功能模組（`features/viewing/index.ts`）；按鈕的 `aria-pressed` 與圓形背景顯示目前狀態。
  長期設定，不算進行中（不在「更多」上顯示提示圓點）。「自動播放」按鈕在每次繪製工具列時重新尋找 YouTube 的開關（YouTube 的開關常比工具列晚出現）。
- **「更多」面板**：開關清單只列出還在「更多」中的（放到工具列的不重複列出）；名稱、圖示與說明改從工具註冊表取得。
- **編輯模式**（`ToolbarEditor.tsx`）：工具列下方多一個「在『更多』中」區。拖曳改為二維：指標在「更多」區時放開即放回「更多」（只接受「更多」開關，
  其他工具不會有標示，放開也不變）；在工具列上時照舊顯示插入位置的指示線。眼睛按鈕與空白鍵也可以在兩邊之間移動，焦點跟著同一個工具。
- **設定頁**：主清單只列工具列那一列；下方「在『更多』選單中」列出其餘的開關（圖示、名稱、開關）。開啟後加到主清單最後；「下移」在主清單最後一列停用。
- 與 006 規則的差異見 QUESTIONS Q81。已知限制：還沒更新的擴充功能（v0.1.1）讀到版本 2 的設定時使用預設工具列。

## T63 一鍵下載預設關閉（010 第二節）

- `sync:quickDownload` 的預設值改為 `false`：storage 沒有值時為關閉，已儲存的 `true`／`false` 不變（FR-11）。`quickSettings()` 只把 `true` 當作開啟。
- 右鍵下載不受影響（009 FR-22）。README 的功能說明改為「在設定頁開啟」。

## T64 時間範圍的「重設」（010 第三節）

- `TimeRange`：標題右邊的小型次要按鈕（`restart_alt` 圖示＋「重設」），回到整部影片並保留「與播放器同步」的設定。
  輸入都合法且是整部影片時停用；輸入不合法時可以使用。影片與 MP3 面板共用同一個元件。

## T65 數字輸入框（010 第四節）

- `components/controls/NumberStepper.tsx`：`type="number"` 輸入框兩側的「−」「＋」圓形按鈕（32px，邊框 `--ytm-outline`、懸停 `--ytm-hover-background`、按下 `--ytm-active-background`）。
  - 按下即加減一；按住 400 ms 後每 80 ms 連續增減，到達最小或最大值時停止並停用該按鈕。計時器只在按住時存在。
  - 輸入框保留原生行為（直接輸入、鍵盤 ↑／↓）；按鈕不在 Tab 順序中。輸入不是整數時兩個按鈕都可以使用，從最小值開始。
- 內建的上下箭頭以樣式隱藏：`appearance: textfield`（Firefox）與 `::-webkit-inner-spin-button`／`::-webkit-outer-spin-button`（Chrome），套用在工具列與面板中所有數字輸入框。
- FR-32：面板中只有循環次數是數字輸入框；時間範圍與循環片段的時間是文字輸入框，設定頁沒有數字輸入框。

## T66 大小的說明（Q79）

- 介面（安裝引導）、README、docs 改為下載量與安裝後的大小。數字依 `release/components.lock.json` 的檔案大小計算（見 QUESTIONS Q82）：
  macOS 約 160 MB（Apple 晶片實測安裝後約 350 MB），Intel Mac 約 170 MB（只寫在 docs），Windows 約 267 MB → 寫「約 270 MB」。Windows 與 Intel Mac 沒有安裝後的實測，不寫。

## 驗證

- 單元測試：`utils/toolbar-layout.test.ts`（預設值、版本 1 轉換、隱藏的「更多」開關排序、`placeInToolbar`、`moveToMore`、`stepItem`、`toggleVisible`、重設）、
  `components/toolbar/buttons.test.ts`、`components/controls/stepper-math.test.ts`、`features/downloads/quick-combo.test.ts`（一鍵下載的預設值與已儲存的值）。
- 假頁面測試：
  - `viewing-test.mjs` 的 `T62`（16 項）：預設版面、「更多」區、從「更多」拖到工具列、眼睛與鍵盤、拖回「更多」、其他工具不能放進「更多」、
    工具列按鈕的切換與狀態、說明面板、設定頁的清單與開關、編輯模式與設定頁的「重設為預設」。
  - `viewing-test.mjs` 的 `T65`（淺色、深色各一次）：沒有內建箭頭、按鈕位置與外觀、加減、停用、按住連續增減、鍵盤、清空、「無限」時停用、FR-32。
  - `fixture-test.mjs`、`spikes/stage7/language-test.mjs`：一鍵下載預設關閉後的提示文字（語言測試先開啟一鍵下載再檢查 009 FR-7 的提示文字）。
  - `spikes/stage6/toolbar-test.mjs`：編輯模式的項目多了「更多」區的 5 個開關。
  - `spikes/stage4/e2e-test.mjs`（真正的橋接程式＋假 yt-dlp）：T64 的「重設」（不合法時可用、按下回到整部影片、整部影片時停用）。
- Firefox：本環境沒有 Firefox，只確認 `web-ext lint` 與樣式規則；e2e-checklist 第 12 節列出需要實測的項目。
