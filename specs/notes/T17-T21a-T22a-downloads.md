# 階段 4a：截圖與縮圖（T17）、字幕直接下載（T21a）、影片／MP3 面板的未連線狀態（T22a）

日期：2026-10-22　負責：實作方

## 共通

- 內容腳本只送出經過驗證的值給背景腳本（`utils/messages.ts`，有單元測試）：影片 ID（11 碼）、縮圖尺寸代號（白名單）、
  截圖的 PNG data URL、字幕網址（必須是 https 的 `youtube.com` 或其子網域）、字幕格式（`srt`／`vtt`／`txt`）、語言代碼。
  縮圖網址與所有檔名都由背景腳本組出。
- 背景腳本（`features/downloads/background.ts`）以 `downloads.download` 存到瀏覽器的預設下載位置（002 FR-45）：
  - Chrome 的 service worker 沒有 `URL.createObjectURL`，以 data URL 下載；Firefox 的背景頁以物件網址下載，下載完成或 5 分鐘後釋放。
  - SRT、VTT 以 `application/octet-stream` 存檔：實測 Chrome 會依 `text/plain` 把 `.srt` 改成 `.txt`。
  - 訊息以 `sendResponse` ＋ `return true` 回覆（Chrome 與 Firefox 都支援）。
- 檔名（`utils/filename.ts`，有單元測試）：「影片標題 [影片ID].副檔名」，移除 `<>:"/\|?*`、控制字元與方向控制字元，
  去掉前後的空白與點，Windows 保留名稱前加底線，標題最長 150 字元；標題讀不到時只用 `[影片ID]`。
- 沒有新增權限：縮圖在 `i.ytimg.com`、字幕在 `youtube.com`，都在 plan 3.2 既有的主機權限內。

## T17 截圖與縮圖（002 FR-30 至 FR-32、FR-50 至 FR-53）

- **縮圖**：背景腳本以 `fetch` 檢查 `maxresdefault`、`sddefault`、`hqdefault`、`mqdefault`，以 `createImageBitmap` 讀出實際尺寸，
  排除非 2xx 與 120×90 的預設圖（`features/downloads/logic.ts` 的 `isRealThumbnail`）；結果依影片 ID 暫存。
  面板每列有預覽小圖、尺寸與「JPG」標籤；點了由背景腳本取得圖片後存檔，格式依回應的 MIME（JPG 或 WebP）。
  - 實測（`spikes/stage4a/results-thumbnails.txt`）：不存在的尺寸回傳 404，內容是 120×90 的預設圖；`jNQXAC9IVRw` 只有 hq、mq，
    `dQw4w9WgXcQ` 四種都有，尺寸與上述對應相同。
  - 檔名：「標題 [ID].jpg」（不加尺寸，依 FR-8；同名時瀏覽器自動加上編號）。
- **截圖**：內容腳本把 `<video>` 以 `videoWidth × videoHeight` 畫到 canvas，`toDataURL('image/png')`，交給背景腳本存檔。
  只畫影片本身，所以不含 YouTube 的控制列、字幕或疊加資訊。檔名「標題 [ID] 01m02s.png」（一小時以上為 `01h02m03s`）。
  完成時按鈕的提示文字顯示「已儲存截圖」約 2.5 秒；影片還沒載入或 canvas 無法輸出（跨來源）時顯示錯誤提示（FR-52）。

## T21a 字幕直接下載（002 FR-40 至 FR-45）

- 頁面橋接腳本新增 `getCaptionTracks`（不帶參數，有白名單與參數驗證測試）：讀 `getPlayerResponse().captions.playerCaptionsTracklistRenderer.captionTracks`，
  回傳語言代碼、名稱、是否自動產生（`kind: "asr"` 或 `vssId` 以 `a.` 開頭）與字幕網址；網址不是 https 的 `youtube.com` 網域、
  有帳號密碼或連接埠、語言代碼格式不對的項目一律略過。背景腳本取得字幕前再驗證一次網址。
- 背景腳本把網址加上 `fmt=vtt` 後以 `fetch` 取得；回應是 WebVTT 或 YouTube 的 XML（`<transcript><text>`、format 3 的 `<p t d>`）時，
  在擴充功能內轉成 SRT、VTT、TXT（`utils/captions.ts`，有單元測試）：
  - SRT：重新編號、`HH:MM:SS,mmm`、去掉 `<c>`、逐字時間標籤與實體；
  - TXT：只有文字，自動字幕「捲動」造成的重複行只保留一次；
  - VTT：輸入已是 VTT 時原樣保留；XML 轉成 VTT 時跳脫 `& < >`。
- 面板：「上傳的字幕」「自動產生的字幕」兩組，自動產生的以圖示標記；預設選中與瀏覽器語言相同的字幕（完全相同優先，其次主要語言相同；
  上傳的優先），沒有時選影片原始語言（自動字幕的語言），並排在該組最上方；格式 SRT（預設）、VTT、純文字。
  檔名「標題 [ID].語言代碼.srt」。
- 直接下載失敗（網路錯誤、非 2xx、內容是空的或不是字幕）時，顯示「無法直接從 YouTube 下載這個字幕。安裝橋接程式後，可以改用 yt-dlp 下載。」與「重試」。
  改用橋接程式的部分留給 T21。

### 本環境無法驗證的部分

- 觀看頁只能從首頁站內進入，而影片在本環境無法播放（`playabilityStatus` 為 `UNPLAYABLE`），影片資料中沒有字幕清單
  （`spikes/stage4a/probe-captions.mjs`、`results-captions.txt`）。字幕清單的欄位名稱依 YouTube 公開可見的影片資料，未在真實頁面確認。
- YouTube 的字幕網址是否允許從擴充功能的背景腳本直接取得（例如是否需要額外的驗證參數）未確認；需要時會走「直接下載失敗」的流程
  （QUESTIONS Q32）。

## T22a 影片／MP3 面板的未連線狀態（002 FR-1、FR-2）

- 影片與 MP3 面板：
  - 直播中或尚未開始的影片（`getVideoData` 的 `isLive`、`isUpcoming`）：只顯示「直播與尚未開始的影片無法下載」（字幕面板相同）。
  - 其他影片：橋接程式連線（T16）完成前，連線檢查一律回傳「無法連線」（`features/downloads/host-status.ts`）。面板列出橋接程式（無法連線）、
    yt-dlp 與 ffmpeg（需要橋接程式才能確認）；依作業系統（以 `navigator.userAgentData.platform`、`navigator.platform` 與 User-Agent 判斷）
    顯示 macOS（Homebrew、`install.sh`）或 Windows（winget、`install.ps1`）的步驟，其他系統顯示「橋接程式提供 macOS 與 Windows 版本」；
    「安裝說明」以新分頁開啟 `https://github.com/chidi0716/yt-toolbar-master#install-the-helper`（README 的章節在 T15 撰寫，QUESTIONS Q33）；
    「重新檢查」按鈕。
- 縮圖、截圖、字幕在未連線狀態下照常使用。

## 假頁面驗證（`spikes/stage1-smoke/downloads-test.mjs`，41 項）

- 執行：`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node spikes/stage1-smoke/downloads-test.mjs`。這個環境變數讓 Playwright 的 route
  也能回應擴充功能背景腳本（service worker）的請求；另外以 `--host-resolver-rules` 讓沒有被 route 回應的請求無法連線，確保測試不連外。
- 下載的檔案存到 `spikes/stage1-smoke/.cache/downloads-<任務>/`（瀏覽器設定檔的偏好，並以 CDP 把 Playwright 的下載攔截改回瀏覽器預設，
  檔名才會是擴充功能指定的名稱），再讀取檔案檢查內容與圖片尺寸。
- 假頁面：`fixtures/thumbs/`（以 Pillow 產生的純色圖：1280×720、640×480、480×360、320×180 與 120×90 預設圖）、`lib.mjs` 的縮圖與
  `/api/timedtext` 回應（含 404＋預設圖、200＋預設圖、空白回應、XML 格式、自動字幕的捲動格式），`fixtures/stage2c-watch.js` 的字幕清單
  （含網域不對的項目）與直播／尚未開始的影片。
- T17（13 項）：只列出實際存在的尺寸、預覽小圖、下載的圖片尺寸與檔名、全部尺寸、200＋預設圖、截圖的解析度與檔名、完成提示與恢復、
  截圖不含控制列（與 `<video>` 本身的像素相同）、影片未載入時的錯誤提示、不需要橋接程式。
- T21a（16 項）：分組與圖示、排除其他網域、格式、預設選擇（英文與繁體中文瀏覽器）、SRT 時間碼、TXT 沒有時間碼且去除重複行、VTT、
  XML 轉 SRT、直接下載失敗的說明與重試、沒有字幕、直播。
- T22a（12 項）：macOS 與 Windows 的元件清單、安裝步驟、README 連結、重新檢查、MP3 面板、未連線時縮圖仍可使用、直播與尚未開始、繁體中文。
- 截圖：`screenshots/T17-thumbnail-panel.png`、`T17-screenshot-saved.png`、`T21a-subtitles-panel.png`、`T21a-subtitles-direct-failed.png`、
  `T22a-video-panel-mac.png`、`T22a-video-panel-windows.png`、`T22a-video-panel-zh-TW.png`、`T22a-live-unavailable.png`（都是假頁面）。

## 給專案擁有者的手動驗證步驟

在 Chrome 與 Firefox（或 Zen）上：

1. **縮圖**：打開一部新影片與一部很舊的影片（例如 2005 年的影片），按「縮圖」：新影片列出 1280×720 到 320×180，舊影片只列出實際存在的尺寸；
   點任一尺寸，下載資料夾中出現「標題 [ID].jpg」，圖片尺寸與面板相同。
2. **截圖**：播放到任一時間點按「截圖」：按鈕提示「已儲存截圖」，下載資料夾中出現「標題 [ID] 01m02s.png」，解析度與影片相同（可在播放器
   右鍵「詳細統計資料」看目前解析度），畫面沒有播放器的控制列與字幕。
3. **字幕**：打開一部有上傳字幕與自動字幕的影片，按「字幕」：兩組分開、自動字幕有圖示、預設選中瀏覽器語言；下載 SRT、TXT、VTT 各一次，
   用文字編輯器確認 SRT 有正確的時間碼、TXT 沒有時間碼。若出現「無法直接從 YouTube 下載這個字幕」，請在開發者工具的 Console（擴充功能的
   背景頁或 service worker）中回報 `[yt-toolbar-master] caption …` 的訊息。
4. **未連線狀態**：按「影片」「MP3」：顯示需要的元件、對應作業系統的安裝步驟、「安裝說明」連結（README 章節之後才會寫）、「重新檢查」。
   打開一部直播影片：影片、MP3、字幕面板都顯示「直播與尚未開始的影片無法下載」。
