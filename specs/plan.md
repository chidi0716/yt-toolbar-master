# 技術計畫（001–003）

狀態：草稿，待專案擁有者確認

本文件說明如何實作 [`001-toolbar`](./001-toolbar/spec.md)、[`002-downloads`](./002-downloads/spec.md)、[`003-viewing-tools`](./003-viewing-tools/spec.md)，並遵守 [`constitution.md`](./constitution.md)。任務拆解見 [`tasks.md`](./tasks.md)。

## 1. 整體架構

```
┌────────────── 瀏覽器 ──────────────────────────────────────────┐
│                                                                │
│  YouTube 分頁                                                   │
│  ┌──────────────────────────┐   CustomEvent   ┌──────────────┐ │
│  │ 內容腳本（isolated world） │ ◄────────────► │ 頁面橋接腳本  │ │
│  │ ・工具列 UI（Shadow DOM）   │                │ (main world) │ │
│  │ ・觀看輔助功能             │                │ ・播放器 API  │ │
│  └────────────┬─────────────┘                 └──────────────┘ │
│               │ runtime.sendMessage / Port                     │
│  ┌────────────▼─────────────┐                                  │
│  │ 背景腳本                  │  下載佇列、通知、縮圖/截圖存檔       │
│  └────────────┬─────────────┘                                  │
└───────────────┼────────────────────────────────────────────────┘
                │ Native Messaging（stdin/stdout，JSON）
┌───────────────▼─────────────┐
│ 橋接程式 ytm-host（Go 單一執行檔）│ ──► yt-dlp ──► ffmpeg
└─────────────────────────────┘
```

- **內容腳本（isolated world）**：繪製工具列與面板，處理所有 DOM 相關功能。
- **頁面橋接腳本（main world）**：只負責呼叫 YouTube 播放器物件的公開方法（取得影片資料、音量、跳轉），用事件與內容腳本溝通。內容固定、隨擴充功能打包，不是動態注入的外部程式。
- **背景腳本**：唯一能與橋接程式溝通的地方；管理下載工作、通知、以及縮圖與截圖的存檔。
- **橋接程式**：Go 撰寫，編譯成 macOS 與 Windows 的單一執行檔，負責驗證指令並呼叫 yt-dlp。

## 2. 技術選擇

| 項目 | 選擇 | 理由 |
|---|---|---|
| 擴充功能框架 | WXT（現有） | 一份程式碼打包 Chrome 與 Firefox |
| Manifest 版本 | Chrome 與 Firefox 都用 MV3 | 兩邊都能使用 main world 內容腳本，程式碼一致（見風險 R1） |
| UI | Preact + TSX | 面板與表單元件多，用元件寫比較好維護；體積約 4KB。Preact 內部支援 `dangerouslySetInnerHTML` 會產生一個 `web-ext lint` 警告，本專案不得使用該屬性，此警告記錄於 `specs/notes/lint-exceptions.md` 並接受 |
| 樣式隔離 | WXT `createShadowRootUi` | 避免影響 YouTube 版面；CSS 自訂變數會穿透 Shadow DOM，所以仍能使用 YouTube 的顏色變數 |
| 圖示 | `@material-symbols/svg-400`（Apache 2.0） | 以 Vite `?raw` 匯入 SVG，打包進擴充功能 |
| 多語系 | `browser.i18n` + `public/_locales/{en,zh_TW}` | 瀏覽器原生機制，依瀏覽器語言自動切換 |
| 單元測試 | Vitest | 與 Vite 相容 |
| 橋接程式 | Go 1.24，只用標準函式庫（Windows 另加 `golang.org/x/sys/windows`） | 跨平台編譯成單一執行檔，使用者不必安裝執行環境 |

## 3. 擴充功能

### 3.1 目錄結構

```
entrypoints/
  background.ts                 背景腳本進入點
  youtube.content/              工具列與觀看輔助（isolated world）
    index.tsx
  youtube-page.content.ts       頁面橋接腳本（world: MAIN）
  popup/                        彈出視窗（現有，加上語系）
  options/                      設定頁
components/
  toolbar/                      Toolbar、ToolbarButton、Panel、PanelHost
  controls/                     RangeSlider、TimeInput、Switch、Select、Button、Badge
  panels/                       VideoPanel、Mp3Panel、ThumbnailPanel、SubtitlePanel、
                                LoopPanel、MorePanel、HelpPanel、HostMissing
features/
  viewing/                      darkMode、cinema、pip、floatingPlayer、looper、
                                smartPause、autoplay、audioOnly、wheelVolume、hideComments
  downloads/                    screenshot、thumbnails、jobs（下載狀態）
utils/
  youtube/dom.ts                ★ 所有 YouTube 選擇器集中於此（constitution 第 7 點）
  youtube/page.ts               目前影片 ID、換頁事件、頁面類型判斷
  youtube/player.ts             與頁面橋接腳本溝通的封裝
  format-list.ts                yt-dlp 格式 → 畫質清單（純函式，有測試）
  time.ts                       時:分:秒 解析與格式化（純函式，有測試）
  filename.ts                   截圖／縮圖檔名（純函式，有測試）
  settings.ts                   所有設定的 storage 定義（取代現有 storage.ts）
  native.ts                     背景腳本端的橋接程式連線
  messages.ts                   內容腳本 ↔ 背景腳本的訊息型別
host/                           橋接程式（Go），見第 4 節
```

### 3.2 權限

| 權限 | 用途 |
|---|---|
| `storage` | 設定與功能開關 |
| `downloads` | 縮圖與截圖存檔 |
| `notifications` | 下載完成／失敗通知 |
| `nativeMessaging` | 與橋接程式溝通 |
| `contextMenus` | 在 YouTube 頁面的影片連結上提供「下載影片／MP3」選單（009 第三節）；不會產生安裝警告 |
| 主機權限 `*://*.youtube.com/*` | 內容腳本 |
| 主機權限 `https://i.ytimg.com/*` | 背景腳本檢查縮圖尺寸是否存在並下載 |

不申請 `tabs`、`scripting`、`webRequest`、`<all_urls>`、`cookies`、`management`。

### 3.3 擴充功能 ID 固定

原生訊息設定檔必須寫明擴充功能 ID：

- **Chrome**：在 `wxt.config.ts` 的 manifest 加入固定的 `key`（公鑰），讓未封裝載入的 ID 永遠相同。金鑰在實作時產生一次，只提交公鑰，私鑰不進 repo。
- **Firefox**：`browser_specific_settings.gecko.id` 改為 `yt-toolbar-master@chidi0716`。
- Chrome 不打包 `.crx`（Chrome 不允許安裝商店以外的 `.crx`），因此不需要保留私鑰；只以「載入未封裝項目」安裝。
- **改名**（T52）：專案改名為「YT Toolbar Master」（repo `chidi0716/yt-toolbar-master`）。因為還沒有發佈任何版本，內部識別碼也一併改名：Firefox `gecko.id` 為 `yt-toolbar-master@chidi0716`、原生訊息名稱 `com.chidi0716.yt_toolbar_master`、小幫手 `ytm-host`、發佈工具 `ytm-release`、安裝資料夾 `yt-toolbar-master`、暫存資料夾 `.ytm-tmp-<id>`，程式中的 `yte` 前綴（CSS class、DOM 屬性、事件名稱、輸出標記）改為 `ytm`。只有 Chrome 的 `key` 不變（擴充功能 ID 由金鑰決定，與名稱無關）。

### 3.3.1 Firefox 發佈方式

- Firefox 正式版與 Zen 只能永久安裝經 Mozilla 簽署的附加元件，因此以 AMO「不公開（unlisted）」頻道送簽署，取得 `.xpi` 自行發佈；不在 AMO 網站上架。
- manifest 的 `browser_specific_settings.gecko` 加入：
  - `strict_min_version: "140.0"`（main world 內容腳本需要 128，`data_collection_permissions` 需要 140；140 為 ESR 版本）；
  - `data_collection_permissions: { "required": ["none"] }`（依 constitution 第 2 點，不收集任何資料）。
- 不支援 Firefox Android；`web-ext lint` 中只與 Android 相關的警告可以接受，需在 `specs/notes/lint-exceptions.md` 記錄。
- 送簽署時一併上傳原始碼：`sign:firefox` 先以 `git archive` 產生原始碼壓縮檔（不含 `node_modules`、`.output`、`host/dist`、`spikes`），再以 `--upload-source-code` 附上；README 寫明審查者如何從原始碼重現建置（`npm ci && npm run build:firefox`）。
- 新增 `npm run sign:firefox`：以 `web-ext sign --channel unlisted` 送簽署。AMO API 金鑰從環境變數 `WEB_EXT_API_KEY`、`WEB_EXT_API_SECRET` 讀取，不得寫入 repo 或任何設定檔。實際送簽署由專案擁有者在自己的電腦上執行。
- README 說明如何安裝簽署後的 `.xpi`，以及開發時用「臨時附加元件」載入。

### 3.4 換頁與工具列掛載

- 監聽 YouTube 的 `yt-navigate-finish` 事件，以及首次載入時的狀態；以網址判斷是否為 `/watch`。
- 以 `utils/youtube/dom.ts` 提供的錨點（播放器下方、標題上方的容器）掛載 Shadow DOM 根節點。
- 用一個 `MutationObserver` 只觀察錨點的父節點，偵測工具列被 YouTube 移除時重新掛載（FR-5）；離開觀看頁時停止觀察（NFR-3）。
- 全螢幕：監聽 `fullscreenchange`，全螢幕時隱藏工具列。

### 3.5 頁面橋接腳本

- 以 `world: 'MAIN'` 宣告的內容腳本，只在 `*.youtube.com` 執行。
- 只接受以下事件請求，其他一律忽略：`getVideoData`（標題、影片 ID、長度、是否直播／尚未開始）、`getVolume`、`setVolume`、`seekTo`、`getCurrentTime`，以及鎖定畫質用的 `getAvailableQualities`、`getQuality`、`setQuality`（`setQuality` 的參數只接受 YouTube 畫質代號白名單），與深色模式用的 `markThemeOptions`（不帶參數，只在 YouTube 外觀子選單的深色／淺色選項上加標記屬性，不點擊、不修改其他內容）。
- 事件名稱加上固定前綴；回覆時帶請求 ID。
- 頁面上其他程式也能發出同名事件，所以這些操作都設計成無害的（只能讀取影片資料、調整音量、跳轉）。

### 3.6 工具列與面板

- `PanelHost` 管理「目前展開的面板」與「是否釘選」，實作 001 的 FR-10 至 FR-13。
- 面板定位：以按鈕位置計算，超出播放器右緣時改為右對齊（FR-11）。
- 點外面收起：在 Shadow DOM 外層監聽 `pointerdown`，用 `event.composedPath()` 判斷是否點在工具列或面板內。
- 切換按鈕的開啟狀態由各功能模組回報。
- 顏色只使用 YouTube 變數，例如：
  - 依序嘗試 `--yt-spec-*`、`--yt-sys-color-baseline--*`，最後是固定備用值（例如面板背景、主要與次要文字、懸停背景、藍色強調）。
  - 對應關係集中在一個 CSS 檔，YouTube 改名時只需修改該檔。

### 3.7 觀看輔助功能的做法

| 功能 | 做法 |
|---|---|
| 深色模式 | **操作 YouTube 自己的外觀選單**：在 `<html>` 加上暫時的 class，以 CSS 讓 YouTube 的彈出選單容器在操作期間不可見；以程式點擊頭像按鈕（未登入時為設定按鈕）→「外觀」項目 → 「深色主題」／「淺色主題」項目；完成或逾時（例如 3 秒）後關閉選單並移除暫時 class。選單項目以 YouTube 頁面上的結構辨識（例如外觀子選單中的勾選項目順序或對應的圖示／連結資料），**不得只靠顯示文字**（介面語言會變）。所有選擇器集中在 `utils/youtube/dom.ts`。移除 T06a／T06b 的 PREF 修改、主題屬性設定、變數覆寫、每秒檢查等程式。按鈕狀態只讀取 `<html>` 的 `dark` 屬性。 |
| 劇院模式 | **不使用蓋住整頁的遮罩**（YouTube 的播放器位於多層形成獨立堆疊脈絡的容器內，提高 `z-index` 無法讓播放器跳出遮罩，實測會連播放器一起蓋住）。改為在 `<html>` 加上 class，以 CSS 把播放器容器與工具列以外的各個頁面區域調暗（例如降低不透明度或亮度），頁面背景改為黑色；需要調暗的區域選擇器集中在 `utils/youtube/dom.ts`。點擊被調暗的區域時關閉（在這些區域上以捕獲階段攔截點擊，避免誤觸連結）；Esc 關閉 |
| 子母畫面 | 對 `<video>` 呼叫 `requestPictureInPicture()`；監聽 `enterpictureinpicture`／`leavepictureinpicture`；`document.pictureInPictureEnabled` 為 false 時停用按鈕 |
| 浮動播放器 | `IntersectionObserver` 觀察播放器原位置；離開畫面時對播放器容器加上固定定位的 class，並觸發 `resize` 事件讓 YouTube 重新計算尺寸；拖曳使用 Pointer Events，放開時貼齊最近角落 |
| 循環播放 | 監聽 `<video>` 的 `timeupdate` 與 `ended`；片段模式超過結束時間就 `seekTo` 開始時間 |
| 切換分頁自動暫停 | `visibilitychange`；記錄「是不是我們暫停的」 |
| 自動播放 | 點擊 YouTube 播放器上的自動播放開關，讀取其 `aria-checked` 狀態 |
| 純音訊模式 | 隱藏 `<video>` 畫面，在播放器內加入顯示縮圖的覆蓋層 |
| 滾輪調音量 | 在播放器上監聽 `wheel`（`passive: false`），透過頁面橋接腳本 `setVolume`；在播放器中央顯示音量提示 |
| 隱藏留言 | 對留言區容器加上隱藏用的 class |

### 3.7.1 鎖定畫質與複製連結（004）

- **鎖定畫質**：透過頁面橋接腳本讀取影片可用畫質，選出不高於設定值的最高畫質後設定給播放器。
  - 在影片載入與播放器畫質改變時重新檢查。
  - 偵測到使用者手動改畫質時（畫質改變但不是我們觸發的），記下這部影片的影片 ID，該影片不再強制。
  - 畫質代號與解析度的對應、選擇邏輯寫成純函式並有單元測試。
  - 實作前先以真實 YouTube 確認播放器的畫質相關方法仍可用；不可用時在 QUESTIONS.md 回報。
- **複製連結**：連結與 Markdown 文字的產生寫成純函式（有單元測試），在按鈕點擊的使用者操作中以 `navigator.clipboard.writeText` 複製；失敗時改為顯示可選取的文字框（004 FR-34）。

### 3.7.2 頁面整理（005）

- **設定**：`utils/settings.ts` 新增各選項（預設 false，存在 `sync`）。設定頁以類別分組顯示（觀看頁、干擾、Shorts、介面），並保留原本的下載設定區。
- **CSS 開關機制**：內容腳本在 `document_start` 就依設定在 `<html>` 加上對應的 class（例如 `ytm-hide-end-cards`），並監聽設定變更即時增減 class（005 FR-3）。所有相關樣式放在同一個樣式檔，選擇器集中在 `utils/youtube/dom.ts`。這個機制取代各功能各自加樣式的做法，003 的「隱藏留言」也改用此機制。
- **內容腳本範圍**：頁面整理在所有 YouTube 頁面作用，工具列仍只在觀看頁掛載。
- **需要程式的選項**：
  - **原始語音**：透過頁面橋接腳本讀取影片的語音軌清單並切換（新增 `getAudioTracks`、`setAudioTrack` 請求，`setAudioTrack` 只接受清單中存在的語音軌識別值）。在影片載入時檢查；偵測到使用者手動切換時，這部影片不再強制。實作前先以真實 YouTube 確認播放器提供的語音軌方法；不可用時在 QUESTIONS.md 回報。
  - **繼續觀看對話框**：以 `MutationObserver` 只觀察對話框會出現的容器；對話框出現且影片因此暫停時，關閉對話框並繼續播放。
  - **Shorts 轉換**：首次載入時檢查網址；站內換頁時在 YouTube 換頁事件（及網址變更）時檢查。以 `location.replace` 轉到觀看頁，避免瀏覽紀錄循環。
- **測試**：網址轉換、語音軌選擇等純邏輯寫成純函式並有單元測試；假觀看頁加上模擬的片尾卡片、結尾畫面、Shorts 區塊、長標題與「繼續觀看」對話框來驗證。

### 3.7.3 自訂工具列（006）

- **設定**：`utils/settings.ts` 新增 `sync:toolbarLayout`，格式為 `{ version: 1, items: Array<{ id: ToolId | 'separator', visible: boolean }> }`；`id` 為固定的工具識別字串（不使用顯示名稱）。讀取時與預設清單合併（006 FR-24），寫入前驗證。
- **工具註冊表**：把目前散在 Toolbar 元件中的按鈕定義集中成一份註冊表（id、圖示、名稱、類型：面板／切換／執行、預設組），工具列、編輯模式、「更多」的其他工具區塊、說明面板與設定頁都從註冊表與設定產生，避免各自維護一份清單。
- **拖曳**：使用 Pointer Events 自行實作（不引入函式庫），拖曳中只更新暫存順序，放開時才寫入暫存狀態；「完成」時才寫入 storage。
- **跨分頁套用**：監聽 storage 變更，重新繪製工具列；編輯模式中的分頁收到其他分頁的變更時，先保留自己的編輯，「完成」時以自己的結果覆寫。

### 3.7.4 介面語言（007）

- `browser.i18n.getMessage` 只會依瀏覽器語言回傳，無法在執行中切換，因此改為自己的翻譯層：
  - 兩份語言檔（`public/_locales/en`、`zh_TW` 的 `messages.json`）在建置時一併打包成模組，執行時依設定選用；`_locales` 仍保留給 manifest 的名稱與說明使用（007 FR-5）。
  - `utils/i18n.ts` 提供 `t(key, substitutions?)` 與目前語言的訂閱；Preact 元件透過 hook 讀取，語言改變時只重新繪製文字，不重新掛載（NFR-1）。
  - 設定 `sync:uiLanguage`：`'auto' | 'zh_TW' | 'en'`。
  - 數字、檔案大小、時間的格式以 `Intl` 依目前語言產生。
  - 背景腳本建立通知時讀取同一個設定。
- 測試：兩份語言檔的鍵一致；所有程式中使用的鍵都存在於語言檔（掃描原始碼）；切換語言時面板狀態保留。
- **設定頁外觀（007 FR-20 至 FR-24）**：設定 `sync:pageTheme` = `'youtube' | 'system' | 'dark' | 'light'`（預設 `youtube`）；內容腳本在深色模式功能已有的 `<html dark>` 觀察中，把目前主題寫入 `local:lastYouTubeTheme`（只在值改變時寫入）。設定頁與彈出視窗的顏色改為 CSS 變數，以 `<html data-theme="dark|light">` 切換；`system` 與尚無紀錄時以 `prefers-color-scheme` 決定。監聽 storage 變更即時更新。

### 3.8 下載相關（擴充功能端）

- **影片資訊快取**：背景腳本以影片 ID 快取 `getInfo` 結果，影片、MP3、字幕面板共用（NFR-2）。
- **畫質清單**（`utils/format-list.ts`）：
  - 從 yt-dlp 的格式資料挑出只有影像的格式，依解析度與幀率分組。
  - MP4 組用 H.264 影像搭配 M4A 聲音；其他格式組用 VP9/AV1 搭配 Opus。
  - 已經包含聲音的格式（例如 360p）直接列出。
  - 大小為影像與聲音相加；任一方只有估計值時標記「約」。
  - 標籤規則依 002 FR-11。
- **縮圖**：背景腳本依序檢查 `maxresdefault`、`sddefault`、`hqdefault`、`mqdefault`。YouTube 對不存在的尺寸會回傳 404 或 120×90 的預設圖，兩者都排除。以 `downloads.download` 存檔。
- **截圖**：在內容腳本把 `<video>` 畫到 canvas，轉成 PNG Blob，交給背景腳本以 `downloads.download` 存檔。若 canvas 被汙染而失敗，顯示錯誤（FR-52）。
- **字幕（直接下載，002 FR-44）**：頁面橋接腳本新增 `getCaptionTracks` 請求（不帶參數），從播放器的影片資料取得字幕清單（語言代碼、名稱、是否自動產生、字幕網址）。字幕網址必須是 `youtube.com` 網域，背景腳本以 `fetch` 取得 VTT 格式（或 YouTube 的 XML 格式再轉換），在擴充功能內轉成 SRT、TXT（轉換函式有單元測試），以 `downloads.download` 存檔。失敗且橋接程式可用時，改用 yt-dlp（4.5 節）。
- 縮圖與截圖存到瀏覽器的預設下載位置；設定頁的「下載資料夾」只影響經由橋接程式的下載。設定頁要寫明這點。
- **下載工作狀態**：背景腳本維護工作清單（ID、影片 ID、類型、進度、狀態），以 `storage.session` 保存，並推播給開著的 YouTube 分頁。
- **通知**：完成時建立通知；點擊通知送出「在檔案總管中顯示」指令。

### 3.9 新版本提醒（008 第三之一節）

- 新模組 `utils/update-check.ts`（純邏輯：版本比較、是否該查詢、是否該顯示，要有單元測試）與背景腳本中的查詢。全專案只有這個模組可以出現 `api.github.com`（T26 檢查要更新）。
- **是否需要提醒**：背景腳本以 `browser.management.getSelf()` 取得 `installType`（不需要 `management` 權限）；只有 `development` 才查詢與提醒（Chrome 載入未封裝、Firefox 臨時附加元件）。其他安裝類型一律不查詢。
- **查詢**：`GET https://api.github.com/repos/chidi0716/yt-toolbar-master/releases/latest`（只回傳正式版本，不含預先發行版本），不帶任何自訂標頭或 cookie（`credentials: 'omit'`）。只取 `tag_name`（去掉開頭的 `v`）、`name`、`html_url`；`html_url` 必須以 `https://github.com/chidi0716/yt-toolbar-master/releases/` 開頭，否則丟棄。GitHub API 允許跨來源讀取，因此不需要新增主機權限。
- **時機**：內容腳本在影片頁載入完成時送訊息給背景腳本；背景腳本檢查 `local:updateCheck.lastCheckedAt` 超過 24 小時、且沒有選擇「不再提醒」才查詢。失敗只記錄在 console，不重試。
- **儲存**（`local:`，不同步）：`updateCheck = { lastCheckedAt, latest: {version, title, url} | null }`、`updateReminder = { skippedVersion, disabled, lastCardShownAt: {version, at}, handledVersion }`。
- **卡片**：屬於工具列的 Shadow DOM，位置在工具列下方，不疊在播放器上。顯示條件、收合計時、小圓點、隔天再出現依 008 FR-28 至 FR-29b 與 constitution 第 7c 點。
  - 「使用者有操作」：卡片顯示後，在 `document.visibilityState === 'visible'` 且收到 `pointermove`、`keydown` 或 `wheel` 後才開始計時；分頁切到背景時暫停。
  - 不搶焦點（不呼叫 `focus()`），按鈕可用 Tab 到達；淡入動畫遵守 `prefers-reduced-motion`。
  - 延後條件用既有的狀態判斷：全螢幕（`document.fullscreenElement`）、子母畫面、編輯工具列、面板展開、焦點在輸入框。
- **圖示標記**：`action.setBadgeText({ text: 'NEW' })`；「前往下載」或目前版本 ≥ 最新版本時清除。
- **設定頁「關於」區**：目前版本、最新版本、最近查詢時間、「前往下載」、「重新開啟新版本提醒」（只在選擇過「不再提醒」時顯示）。
- 「前往下載」以 `window.open(url, '_blank', 'noopener')` 開啟，只會是通過檢查的 `html_url`。
- 翻譯字串加入 `utils/i18n` 的兩種語言。

### 3.10 安裝引導與下載區設定（008 第一、三、四節，擴充功能端）

- **安裝指令**（常數集中在 `features/downloads/host-status.ts`）：
  - macOS：`curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh`
  - Windows：`irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex`
  - 作業系統以 `runtime.getPlatformInfo()` 判斷（不需要權限）；其他系統顯示 README 連結。
- **自動偵測**：影片／MP3 面板顯示安裝引導時，每 3 秒送一次 `status`，面板收起就停止；成功後切換成可下載畫面。
- **設定頁「下載」區**：用 `status` 的 `components` 與 `update`（4.9 節）顯示各元件版本與來源；「自動更新」開關（`setAutoUpdate`）、「立即檢查更新」（`checkUpdates`）、最近一次檢查時間與結果；`update.consecutiveFailures >= 3` 時在下載面板顯示一行提示（008 FR-25）。
- **移除下載功能**：確認對話框（在設定頁內，不是瀏覽器的 `confirm`）→ `uninstall`；有進行中的下載時顯示 `JOBS_RUNNING` 的說明。
- **自動更新 yt-dlp 後重試**（008 FR-22）：下載進度事件出現 `stage: "updating-ytdlp"` 時，面板顯示「正在更新 yt-dlp…」。

### 3.11 一鍵下載與右鍵下載（009）

- **畫質選擇**：新增純函式 `pickDefaultFormat(formats, {height: 'best'|2160|1440|1080|720|480, container: 'mp4'|'any'})`，放在 `utils/format-list.ts` 旁並重用其分組結果；規則依 009 FR-2，要有單元測試（包含只有更高畫質、同畫質多幀率、2K 以上 MP4 組、只有內含聲音的格式）。
- **設定**（`sync:`）：`quickDownload`（預設 true）、`defaultVideoHeight`（預設 1080）、`defaultVideoContainer`（預設 `mp4`）、`downloadContextMenu`（預設 true）。MP3 位元率沿用既有設定。
- **一鍵流程**：背景腳本新增 `quickDownload({videoId, kind, source: 'toolbar'|'contextMenu'})`：取得影片資訊（共用 3.8 的快取）→ 檢查是否可下載（009 FR-6）→ 選格式 → 呼叫既有的 `download`。重複下載判斷依工作清單中「同影片＋同種類且狀態為進行中」。
- **「改用其他畫質」**：送 `cancel` 後在同一個面板切換成完整清單。
- **安裝完成後**：面板偵測到小幫手後顯示「開始下載」按鈕（009 FR-11），不自動開始。
- **右鍵選單**：背景腳本以 `contextMenus.create` 建立父選單與兩個子項目：
  - `contexts: ['link']`、`documentUrlPatterns: ['*://*.youtube.com/*']`、`targetUrlPatterns`：`*://*.youtube.com/watch*`、`*://*.youtube.com/shorts/*`、`*://youtu.be/*`；
  - 點擊時從 `linkUrl` 取出影片 ID（以既有的 ID 驗證規則），無效時不動作；
  - 在 `runtime.onInstalled` 與設定或語言改變時以 `contextMenus.removeAll` 後重建（Chrome MV3 背景程式重啟後選單會保留，不需要每次重建）；
  - 選單文字使用 007 的翻譯層並代入目前預設值。
- **開始通知**：只在右鍵下載時建立；取得標題後以同一個通知 ID 更新。
- 工具列按鈕的提示文字依設定即時更新（009 FR-7）。

## 4. 橋接程式（host/）

### 4.1 目錄結構

```
host/
  go.mod
  cmd/ytm-host/main.go          進入點
  internal/protocol/            原生訊息讀寫（4 位元組長度 + JSON）
  internal/commands/            指令分派與參數驗證
  internal/ytdlp/               尋找 yt-dlp/ffmpeg、組命令列參數、解析輸出
  internal/jobs/                下載工作管理、取消、清理暫存檔
  internal/platform/            各平台差異：下載資料夾、顯示檔案、選資料夾、結束子程序
  testdata/fake-yt-dlp/         測試用的假 yt-dlp
install/
  macos/install.sh、uninstall.sh
  windows/install.ps1、uninstall.ps1
  manifests/                    原生訊息設定檔範本
```

### 4.2 通訊協定

- 請求：`{"id": "<uuid>", "cmd": "<指令>", "args": {...}}`
- 回應：`{"id": "<同一個 id>", "ok": true, "result": {...}}`，或 `{"id": ..., "ok": false, "error": {"code": "<代碼>", "message": "..."}}`
- 事件（主動推送）：`{"event": "progress" | "done" | "failed", "jobId": "...", ...}`
- 錯誤代碼固定（例如 `INVALID_ARGS`、`YTDLP_NOT_FOUND`、`FFMPEG_NOT_FOUND`、`LOGIN_REQUIRED`、`NETWORK`、`DISK_FULL`、`YTDLP_OUTDATED`、`UNKNOWN`），擴充功能依代碼顯示易懂的訊息（FR-6）。
- 單一訊息上限：橋接程式送出 1MB（Chrome 規定）。`getInfo` 只回傳需要的欄位，避免超過上限。

### 4.3 指令

| 指令 | 參數 | 說明 |
|---|---|---|
| `status` | — | 回傳橋接程式版本、yt-dlp 與 ffmpeg 路徑和版本、是否由套件管理工具安裝、預設下載資料夾 |
| `getInfo` | `videoId` | `yt-dlp -J --no-playlist`，回傳精簡後的格式、字幕清單、標題、長度、直播狀態 |
| `download` | `videoId`、`kind`、`formatId`、`container`、`bitrate`、`section`、`subLang`、`subFormat`、`dir`、`namePreset`、`embed` | 依 `kind`（`video`／`mp3`／`subtitle`）組參數，回傳 `jobId` |
| `cancel` | `jobId` | 結束整個子程序樹並刪除暫存檔 |
| `jobs` | — | 回傳進行中與最近完成的工作 |
| `reveal` | `jobId` | 在 Finder 或檔案總管中選取完成的檔案 |
| `pickFolder` | — | 開啟系統的選擇資料夾視窗，回傳路徑 |
| `updateYtDlp` | — | 非套件管理工具安裝時執行 `yt-dlp -U`，否則回傳對應的更新指令 |

### 4.4 驗證規則（FR-71 至 FR-73）

- `videoId`：`^[A-Za-z0-9_-]{11}$`，網址由橋接程式組成 `https://www.youtube.com/watch?v=<id>`。
- `formatId`：`^[A-Za-z0-9_-]{1,10}(\+[A-Za-z0-9_-]{1,10})?$`。
- `container`：白名單 `mp4`、`webm`。
- `bitrate`：白名單 64、128、192、256、320。
- `section`：兩個非負整數秒數，開始小於結束；`video` 與 `mp3` 都可使用。
- `embed`：布林值。
- `subLang`：`^[A-Za-z0-9-]{1,20}$`。
- `subFormat`：白名單 `srt`、`vtt`、`txt`。
- `namePreset`：白名單 ID，對應橋接程式內建的 yt-dlp 檔名範本，不接受任意範本。
- `dir`：必須是絕對路徑、存在、可寫入。
- 所有參數以陣列傳給 `exec.Command`，不經過 shell；網址前一律加 `--` 防止被當成選項。

### 4.5 呼叫 yt-dlp

- **尋找執行檔**：瀏覽器啟動的程式在 macOS 上 `PATH` 很短，所以除了 `PATH`，還要找：
  - macOS：`/opt/homebrew/bin`、`/usr/local/bin`
  - Windows：`%LOCALAPPDATA%\Microsoft\WinGet\Links`、`%LOCALAPPDATA%\Microsoft\WinGet\Packages\*`

  找到的 ffmpeg 以 `--ffmpeg-location` 傳給 yt-dlp。
- **影片**：`-f <formatId> --merge-output-format <container>`；有裁切時加 `--download-sections *<start>-<end> --force-keyframes-at-cuts`
- **MP3**：`-f bestaudio -x --audio-format mp3 --audio-quality <bitrate>K`；有裁切時加 `--download-sections *<start>-<end> --force-keyframes-at-cuts`
- **字幕**：`--skip-download --write-subs`（自動字幕用 `--write-auto-subs`）`--sub-langs <lang> --sub-format vtt`
  - SRT：加上 `--convert-subs srt`
  - TXT：由橋接程式把 VTT 轉成純文字（去掉時間碼與重複行），有單元測試。
- **嵌入資訊**（004 第 2 節，設定開啟時）：`--embed-thumbnail --embed-metadata --embed-chapters`；WEBM 等不支援嵌入封面的格式不加 `--embed-thumbnail`。是否嵌入由 `download` 指令的布林參數 `embed` 決定。
- **共通參數**：`--newline --no-colors --progress-template "download:YTM-PROGRESS %(progress)j" --print after_move:YTM-FILE:%(filepath)s -P <dir> -o <範本> --windows-filenames --no-playlist`
- **進度**：解析 `YTM-PROGRESS` JSON 行得到百分比、速度、剩餘時間；遇到合併或轉檔階段時，回報狀態「處理中」。
- **錯誤分類**：依 stderr 關鍵字對應錯誤代碼，例如登入、網路、空間不足、格式不存在。

### 4.6 工作與生命週期

- 每個下載是一個子程序。
  - macOS：用程序群組，取消時結束整個群組。
  - Windows：用 Job Object，確保 ffmpeg 也會被結束。
- 取消或失敗時刪除 `.part`、`.ytdl` 與合併前的暫存檔。
- 瀏覽器關閉連線（stdin EOF）時，橋接程式等進行中的下載完成才結束，最長 6 小時。完成的工作記在本機狀態檔，背景腳本下次連線時補發通知。

### 4.7 記錄檔

- macOS：`~/Library/Logs/yt-toolbar-master/host.log`
- Windows：`%LOCALAPPDATA%\yt-toolbar-master\logs\host.log`

只記錄指令名稱、錯誤代碼與 yt-dlp 的錯誤訊息，大小上限 5MB，超過就輪替。

### 4.8 安裝腳本

- 原生訊息名稱：`com.chidi0716.yt_toolbar_master`
- **macOS**（`install.sh`，不需 sudo）：
  - 複製執行檔到 `~/Library/Application Support/yt-toolbar-master/`，並移除隔離屬性（`xattr -d com.apple.quarantine`）。
  - 寫入原生訊息設定檔到：
    - `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
    - `~/Library/Application Support/Mozilla/NativeMessagingHosts/`
  - 檢查 yt-dlp、ffmpeg，缺少時提示 `brew install yt-dlp ffmpeg`。
- **Windows**（`install.ps1`，不需系統管理員）：
  - 複製執行檔到 `%LOCALAPPDATA%\yt-toolbar-master\`。
  - 寫入設定檔，並建立以下登錄機碼：
    - `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.chidi0716.yt_toolbar_master`
    - `HKCU\Software\Mozilla\NativeMessagingHosts\com.chidi0716.yt_toolbar_master`
  - 缺少 yt-dlp、ffmpeg 時提示 `winget install yt-dlp.yt-dlp Gyan.FFmpeg`。
- 解除安裝腳本移除上述所有檔案與機碼。
- 執行檔由 `npm run build:host` 在本機交叉編譯，產出 `darwin-arm64`、`darwin-amd64`、`windows-amd64`；正式版本由 GitHub Actions 發布到 Releases（4.10 節）。
- 008 之後，這兩個腳本改為「手動安裝」用途，一般使用者改用 4.9 節的一行指令。

### 4.9 輕量安裝與自動更新（008）

**整體做法**：一行指令只下載一個很小的引導腳本；腳本只負責下載對應系統的小幫手並核對檢查碼，然後執行 `ytm-host --install`。所有實際工作（下載 yt-dlp、deno、ffmpeg、核對、解壓、註冊瀏覽器）都在 Go 裡完成，方便測試且 macOS／Windows 共用。

**發佈清單 `components.json`**（每個 GitHub Release 都附上；實際格式以 `specs/notes/T40-T43-install-and-release.md` 為準，下面是概念範例）：

```json
{
  "schema": 1,
  "version": "0.2.0",
  "helper": { "darwin-arm64": {"url": "...", "sha256": "..."}, "darwin-amd64": {...}, "windows-amd64": {...} },
  "tools": {
    "yt-dlp": { "version": "2026.10.01", "darwin": {"url": "...", "sha256": "..."}, "windows": {...} },
    "deno":   { "version": "2.x.y", "darwin-arm64": {...}, "darwin-amd64": {...}, "windows-amd64": {...}, "archive": "zip", "binary": "deno" },
    "ffmpeg": { "version": "...", "darwin-arm64": {...}, "darwin-amd64": {...}, "windows-amd64": {...}, "archive": "zip", "binaries": ["ffmpeg", "ffprobe"] }
  }
}
```

- 第三方工具的網址一律指向**官方或指定來源的固定版本網址**（不使用會變動的 latest 網址），本專案不轉存第三方檔案。
- 固定的版本記在 repo 的 `release/components.lock.json`；發佈流程下載每個檔案，**先與官方公布的檢查碼比對**，再把 sha256 寫入 `components.json`。
- 來源：
  - yt-dlp：`github.com/yt-dlp/yt-dlp` 正式版本（macOS 用 `yt-dlp_macos`，Windows 用 `yt-dlp.exe`），官方檢查碼 `SHA2-256SUMS`。
  - deno：`github.com/denoland/deno` 正式版本，官方 `.sha256sum`。
  - ffmpeg（含 ffprobe）：
    - macOS：Martin Riedl 的 FFmpeg Build Server（`ffmpeg.martin-riedl.de`）正式版本（非 snapshot），arm64 與 amd64 各自的 zip，以網站公布的 SHA256 比對。
    - Windows：`github.com/yt-dlp/FFmpeg-Builds`（yt-dlp 官方維護、專為 yt-dlp 調整）的固定版本 win64 GPL 版本；若沒有固定版本網址，改用 `github.com/BtbN/FFmpeg-Builds` 的固定版本。實作時確認並記錄在 `specs/notes/ffmpeg-source.md`。
- **不使用自己的簽章**（008 FR-51，T49 移除原本的 Ed25519）：`host/cmd/ytm-release` 保留 `lock-check`、`manifest`、`zip` 等不涉及金鑰的子指令。

**信任鏈**：
- 第一次安裝：引導腳本從同一個 Release 以 HTTPS 下載 `components.json`，核對小幫手的 sha256 後執行。這與「執行從 GitHub 下載的腳本」本身的信任來源相同（引導腳本無法在 macOS／Windows 內建工具中可靠地驗證 Ed25519）。
- 小幫手執行 `--install` 與之後每一次更新，都只接受從本專案 GitHub（`github.com/chidi0716/yt-toolbar-master/releases/`，含其轉址）以 HTTPS 取得的清單，並嚴格檢查格式與允許的網址；每個下載的檔案都必須符合清單中的 SHA256（008 SR-2）。
- repo 開啟「不可變更版本」，版本發佈後清單與檔案不能被替換。
- 小幫手自我更新時，新版本的檔案必須符合已驗證清單中的 sha256。

**引導腳本**（`install/bootstrap/install.sh`、`install/bootstrap/install.ps1`，以發佈流程附在 Release）：
- 偵測系統與晶片（Apple Silicon 在 Rosetta 下也選 arm64）。
- 下載 `components.json` 與小幫手到暫存資料夾，核對 sha256；不符時停止。
- 執行 `ytm-host --install --manifest <components.json>`，把輸出原樣顯示。
- 腳本本身不需要 sudo／系統管理員，拒絕以 root 執行；PowerShell 版相容 Windows PowerShell 5.1（`Invoke-WebRequest -UseBasicParsing`、TLS 1.2）。
- 舊的 `install/macos/install.sh`、`install/windows/install.ps1` 保留作為「手動安裝」（008 FR-16），改為呼叫 `--install --offline`（只註冊小幫手，沿用系統上已有的 yt-dlp／ffmpeg／deno）。

**`ytm-host --install`**（`host/internal/installer`）：
- 依 008 FR-11 依序執行並印出中英文進度，每一步標明來源網址。
- 安裝資料夾：macOS `~/Library/Application Support/yt-toolbar-master/`，Windows `%LOCALAPPDATA%\yt-toolbar-master\`；工具放在 `bin/`。
- 下載到 `bin/.download-<隨機>`，核對 sha256、解壓、設定執行權限後原子性改名；macOS 移除隔離屬性。zip 解壓要防止路徑穿越（只取需要的檔名）。
- ffmpeg：系統上已有可用的 ffmpeg 與 ffprobe（4.5 節的尋找規則）時跳過下載。
- yt-dlp：已存在時不覆蓋（之後由 `yt-dlp -U` 自行更新）。
- 註冊：沿用 4.8 節的位置與登錄機碼；Windows 用 `golang.org/x/sys/windows/registry`。
- 可重複執行（FR-13）；失敗時印出原因與「再執行一次指令即可繼續」（FR-14）。
- 完成時印出「完成！回到瀏覽器即可下載 / Done! Go back to your browser」。

**尋找工具的順序改為**：安裝資料夾 `bin/` → 4.5 節的既有規則。`status` 回報每個工具的來源。

**自動更新**（`host/internal/updater`，狀態檔 `update-state.json` 放在安裝資料夾）：
- `download` 指令成功建立工作後，若自動更新開啟且距上次檢查超過 24 小時，啟動分離的 `ytm-host --update` 程序（與 `--run-job` 相同的分離方式），立即返回，不延遲下載。
- `--update`：
  1. 下載 `https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/components.json`，檢查格式與允許的網址。
  2. 等到沒有進行中的工作（每 10 秒檢查一次，最多 6 小時）。
  3. yt-dlp：執行 `yt-dlp -U`（只限安裝資料夾中的 yt-dlp；套件管理工具安裝的不動）。
  4. deno、ffmpeg（只限安裝資料夾中的）：版本與清單不同時依清單下載替換。
  5. 小幫手：清單版本比自己新時，下載、核對 sha256，把自己改名為 `ytm-host.old`（Windows 可以改名執行中的檔案）再放入新版本；下次啟動時刪除 `.old`。
  6. 寫入 `lastCheck`、結果、`consecutiveFailures`；用鎖檔避免同時執行兩個 `--update`。
- 下載遇到 `YTDLP_OUTDATED`、`VERIFICATION_REQUIRED`（008 FR-22）：執行工作的程序在同一個工作內執行 `yt-dlp -U`（不受 24 小時限制，同一工作只試一次），發出 `{"event":"progress","jobId":...,"stage":"updating-ytdlp"}`，成功後重新下載一次。

**通訊協定新增**（4.3 節）：

| 指令 | 參數 | 說明 |
|---|---|---|
| `status`（擴充） | — | 新增 `installDir`、`components: [{name: "helper"|"yt-dlp"|"deno"|"ffmpeg"|"ffprobe", version, path, source: "bundled"|"homebrew"|"winget"|"path"}]`、`update: {auto, lastCheck, lastResult: "ok"|"updated"|"failed"|null, consecutiveFailures, running}` |
| `setAutoUpdate` | `enabled`（布林） | 寫入狀態檔 |
| `checkUpdates` | — | 立即啟動 `--update`（不受 24 小時限制），回傳 `{started: true}`；已在執行時回傳 `{started: false}` |
| `uninstall` | — | 有進行中的工作時回傳錯誤 `JOBS_RUNNING`；否則啟動分離的 `ytm-host --uninstall --delay 2` 後回傳 `{ok: true}`，2 秒後刪除安裝資料夾（含工具與記錄檔）、原生訊息設定檔與登錄機碼 |

新錯誤代碼：`JOBS_RUNNING`、`SIGNATURE_INVALID`、`CHECKSUM_MISMATCH`（擴充功能要有對應的中英文訊息）。

**移除指令**（README，008 FR-31）：
- macOS：`curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.sh | sh`
- Windows：`irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.ps1 | iex`

這兩個腳本不需下載小幫手，直接刪除 4.8 節的位置。

**網路連線範圍**（constitution 第 2 點）：小幫手與腳本只連 `github.com`（本專案、yt-dlp、deno、FFmpeg-Builds 的 Release）與其轉址目的地 `objects.githubusercontent.com`、`release-assets.githubusercontent.com`、`ffmpeg.martin-riedl.de`，以及 yt-dlp 自己連的 YouTube。網址以常數集中在一個檔案，測試確認沒有其他網域。

### 4.10 發佈流程（008 第六節）

- `.github/workflows/release.yml`，在推送 `v*` 標籤時執行：
  1. `npm ci`、`npm test`、`npm run compile`、`go test ./...`。
  2. 建置 Chrome 版 zip 與 Firefox 版；Firefox 以 `web-ext sign --channel unlisted` 送簽署（Secrets：`AMO_JWT_ISSUER`、`AMO_JWT_SECRET`，上傳原始碼同 3.3.1）。**Secrets 尚未設定時略過簽署**，附上未簽署的 `yt-toolbar-master-<版本>-firefox-temporary.zip`，不產生 `updates.json`，Release 說明加註「Firefox／Zen 版本尚未簽署，只能以臨時附加元件載入」（008 FR-52）。
  3. 建置三種小幫手。
  4. 依 `release/components.lock.json` 產生並驗證 `components.json`。
  5. 產生 `updates.json`（Firefox 更新資訊，列出這個版本與 `.xpi` 的下載網址）。
  6. 建立 GitHub Release，附上：引導腳本與移除腳本、三種小幫手、`components.json`、Chrome zip、`.xpi`（或未簽署的 Firefox 套件）、`updates.json`（有簽署時）、`SHA256SUMS`。說明文字以範本產生，包含各瀏覽器的更新步驟（Chrome：下載 zip、解壓覆蓋原資料夾、在擴充功能頁按重新載入）。
- Firefox manifest 加入 `browser_specific_settings.gecko.update_url: "https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/updates.json"`（Firefox 會跟隨轉址；實作時確認）。
- 新增 `npm run release:dry`：在本機完成第 1、3、4、5 步，輸出到 `release/dist/`，方便沒有 Secrets 時驗證。
- 預先發行版本（標籤含 `-`，例如 `v0.2.0-beta.1`）建立為 prerelease，不會被 `releases/latest` 取得，因此不觸發提醒與自動更新；預先發行版本**不送 Firefox 簽署**（AMO 同一個數字版本只能簽一次），需要給 Firefox 使用者測試時直接發正式的小版本。
- README「維護者」章節：開啟「不可變更版本」、（之後）設定兩個 Mozilla Secrets、建立第一個版本的步驟。

## 5. 測試策略

| 層級 | 內容 | 工具 |
|---|---|---|
| 單元（擴充功能） | 畫質清單、時間格式、檔名、設定預設值 | Vitest |
| 單元（橋接程式） | 協定讀寫、每條驗證規則（含惡意輸入）、命令列參數組合、VTT→TXT、錯誤分類 | `go test` |
| 整合（橋接程式） | 用假 yt-dlp 腳本模擬進度輸出、成功、失敗、取消 | `go test` |
| 打包 | `npm run compile`、`npm run build`、`npm run build:firefox`、`npm run build:host` 全部成功 | CI 指令 |
| 手動 E2E | 依 001–003 的驗收條件，在 macOS 與 Windows 的 Chrome、Firefox 上逐項測試 | 檢查清單（`specs/e2e-checklist.md`） |

## 6. 風險與待驗證事項

| 編號 | 風險 | 因應 |
|---|---|---|
| R1 | Firefox MV3 的背景頁屬於可被暫停的事件頁面，下載途中可能被暫停 | 第一個任務先驗證；橋接程式設計成斷線後仍會完成下載並保存結果（4.6）。若仍有問題，Firefox 改用 MV2 |
| R2 | YouTube 改版造成選擇器失效 | 選擇器集中在 `dom.ts`；找不到元素時安靜停用該功能 |
| R3 | 浮動播放器與劇院模式會改動 YouTube 版面，可能和 YouTube 自己的樣式衝突 | 只加我們的 class，不改 YouTube 原本的屬性；關閉時完整還原 |
| R4 | macOS 未簽章的執行檔被 Gatekeeper 擋下 | 安裝腳本移除隔離屬性；README 說明也可以從原始碼自行編譯 |
| R5 | YouTube 限制下載速度，或要求驗證才能下載 | 屬於 yt-dlp 的範圍；顯示「請更新 yt-dlp」，並在設定頁提供更新按鈕 |
| R6 | 截圖時 canvas 被視為跨來源而無法輸出 | YouTube 一般使用 blob 網址播放，不會有此問題；失敗時依 FR-52 顯示錯誤 |
