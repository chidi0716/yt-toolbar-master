# 任務拆解

狀態：草稿，待專案擁有者確認

依 [`plan.md`](./plan.md) 拆解。每個任務完成後都要通過 `npm run compile`；有測試的任務要通過對應的測試。標示 `[P]` 的任務彼此沒有相依，可以同時進行。

每個任務完成時做一個 commit，格式依 constitution 第 10 點：第一行為英文摘要並以任務編號開頭（例如 `T03 Add toolbar shell and panel manager`），空一行後以繁體中文補充說明。

## 階段 0：基礎建設

- **T00 技術驗證：Firefox MV3 背景頁與原生訊息**
  - 做一個最小的橋接程式與擴充功能，確認 Firefox MV3 在原生訊息連線期間，背景頁不會被暫停超過 30 秒。
  - 結果寫進 `specs/notes/T00-firefox-mv3.md`。若會被暫停，在 `QUESTIONS.md` 回報，由規格方決定是否改用 MV2。
- **T01 專案設定**
  - 加入 Preact、Vitest、`@material-symbols/svg-400`。
  - `wxt.config.ts`：Firefox 也輸出 MV3；加入權限（plan 3.2）、Chrome 的固定 `key`、Firefox gecko ID。
  - 建立 `public/_locales/en`、`public/_locales/zh_TW`，以及 `npm test`、`npm run build:host` 指令。
  - 移除 `utils/storage.ts`，改為 `utils/settings.ts`。
  - **完成條件**：Chrome 與 Firefox 都能打包，`npm test` 能執行（可以先沒有測試）。

## 階段 1：工具列外框（001）

- **T01a Firefox 發佈設定**（QUESTIONS Q1、Q2 的回答）
  - 依 plan 3.3.1 加入 `strict_min_version`、`data_collection_permissions`，以及 `npm run sign:firefox`。
  - **完成條件**：`web-ext lint` 對 `.output/firefox-mv3` 沒有錯誤與警告；Chrome 版 manifest 不出現 `browser_specific_settings`。

- **T02 YouTube 頁面工具**
  - `utils/youtube/dom.ts`、`page.ts`：判斷觀看頁、取得影片 ID、換頁事件、錨點元素。
  - `youtube-page.content.ts` 與 `player.ts`：頁面橋接腳本與封裝（plan 3.5）。
- **T03 工具列外框與面板管理**
  - Shadow DOM 掛載、重新掛載、全螢幕隱藏。
  - 左右兩組按鈕（先放空面板）、提示文字、`PanelHost`（單一面板、點外面收起、Esc、釘選、定位）。
  - 鍵盤操作與焦點移動。
  - **完成條件**：001 中與功能無關的驗收條件全部通過。
- **T04 [P] 共用控制元件**
  - `RangeSlider`（雙把手）、`TimeInput`、`Switch`、`Select`、`Button`、`Badge`，全部使用 YouTube 顏色變數。
  - `utils/time.ts` 與單元測試。
- **T05 [P] 關閉、彈出視窗與說明面板**
  - ✕ 與彈出視窗的「啟用」開關連動；說明面板列出所有按鈕。
  - 彈出視窗加上語系。

## 階段 2：觀看輔助（003）

- **T01b Firefox 簽署調整**（QUESTIONS Q5、Q6、Q10 的回答）
  - 最低版本改為 140；`sign:firefox` 加入原始碼壓縮檔與 `--upload-source-code`；README 補充審查者建置方式。
  - 建立 `specs/notes/lint-exceptions.md`，記錄可接受的 lint 警告（Android 相關、Preact 的 innerHTML）與理由。
  - **完成條件**：`web-ext lint` 0 錯誤，所有警告都列在 lint-exceptions.md。

T06 至 T10 都依賴 T03，彼此之間可以同時進行。

- **T06 [P] 深色模式、子母畫面**
- **T07 [P] 劇院模式**
- **T08 [P] 浮動播放器**
- **T09 [P] 循環播放面板**（使用 T04 的區間滑桿）
- **T10 [P] 更多選單**：切換分頁自動暫停、自動播放、純音訊模式、滾輪調音量、隱藏留言
- **完成條件**：003 的驗收條件全部通過。

## 階段 2a：實測修正

- **T08a 劇院模式與浮動播放器的組合**（專案擁有者錄影回報：開浮動播放器後再開劇院模式，播放器縮到左上角、接著變得過大）：依 003 FR-45、FR-46 修正。假觀看頁先重現此組合問題，再驗證修正。
- **T06e 深色模式失敗提示**：依 003 FR-15 改善提示文字與顯示時間、console 記錄失敗步驟。
- **T10a 觀看輔助功能組合測試**：依 003 FR-90 與 constitution 第 7b 點，在假觀看頁加入兩兩組合的自動化檢查（至少：劇院＋浮動、劇院＋循環、浮動＋純音訊、浮動＋子母畫面、劇院＋純音訊），檢查播放器位置、尺寸、是否被遮住、工具列是否可見。

## 階段 2b：便利功能（004 第 1、4 節）

- **T06b 深色模式即時切換**（專案擁有者回報：T06a 重新載入時白畫面閃好幾秒）：依 003 FR-11、FR-16 與 plan 3.7，改為不重新載入的即時切換。做法見 plan 3.7 深色模式那一列（偏好＋`<html>` 主題屬性同時切換）。先在 YouTube 首頁比對 YouTube 自己的外觀選單切換前後的 `<html>` 屬性，記錄於 `specs/notes/T06b-dark-mode-instant.md`；保留 T06a 的偏好修改作為持久化與退回方案。
- **T06d 深色模式改為操作 YouTube 外觀選單**（專案擁有者在 Zen、已登入狀態錄影回報：T06b 切換後搜尋列維持深色，且 YouTube 帳號的外觀設定沒有改變）：依 003 FR-10 至 FR-16 與 plan 3.7 重新實作，並移除 T06a／T06b 的相關程式（取代原 T06c）。
  - 先在 YouTube 首頁（未登入）觀察設定選單 →「外觀」子選單的結構，記錄辨識方式；已登入時的頭像選單無法在本環境驗證，依相同子選單結構實作，並寫出給專案擁有者的手動驗證步驟。
  - 假觀看頁加上模擬的頭像／設定選單與外觀子選單，驗證自動操作流程、選單不可見、找不到選單時的處理（FR-15）。
- **T07a 修正劇院模式遮住播放器**（專案擁有者回報：有變暗，但播放器也被蓋住）：依 003 FR-20、FR-20a、FR-21 與 plan 3.7 改用「分區調暗」做法。
  - 假觀看頁必須先重現此問題：仿照 YouTube，讓播放器位於多層具有 `position` 與 `z-index`（形成堆疊脈絡）的祖先容器中，並加上頂端列、側欄、說明等區塊；確認舊做法在假頁面上會遮住播放器，再驗證新做法不會。
  - 自動化檢查：劇院模式開啟時，以 `document.elementFromPoint` 檢查播放器中央、播放器控制列位置、工具列按鈕位置，回傳的元素都必須屬於播放器或工具列。
- **T06a 修正深色模式**（專案擁有者回報：YouTube 外觀為深色時，在 Zen 上按鈕無法切換）：依 003 FR-10 至 FR-15 與 plan 3.7 重新實作；移除「5 秒內有使用者操作就記住」的判斷與深色模式的儲存設定。單元測試涵蓋偏好值的解析與修改（保留其他欄位）。真實 YouTube 無法在本環境驗證時，寫出讓專案擁有者手動驗證的步驟。

- **T27 鎖定畫質**：頁面橋接腳本新增畫質相關請求、「更多」面板的鎖定畫質項目、選擇邏輯與單元測試（plan 3.7.1）。
- **T28 [P] 複製連結**：工具列新增「連結」按鈕與面板、說明面板同步更新、連結產生的單元測試（plan 3.7.1）。
- **完成條件**：004 第 1、4 節的驗收條件逐條自測。

## 階段 2c：頁面整理（005）

- **T29 設定頁分類與 CSS 開關機制**：設定頁改為分類顯示；建立 `<html>` class 開關機制（plan 3.7.2），並把 003 的「隱藏留言」改用此機制。
- **T30 [P] 只靠樣式的選項**：隱藏片尾推薦卡片與結尾畫面、停用縮圖自動預覽、隱藏 Shorts、顯示完整影片標題。
- **T31 [P] 需要程式的選項**：永遠使用原始語音、自動關閉「繼續觀看」對話框、Shorts 改用一般播放器。
- **完成條件**：005 的驗收條件逐條自測（真實 YouTube 無法驗證的項目，寫出給專案擁有者的手動驗證步驟）。

## 階段 3：橋接程式（002 後端）

T11 可以和階段 1、2 同時進行。

- **T11 [P] 協定與指令分派**
  - `protocol`、`commands`、全部驗證規則（plan 4.4）。
  - 測試涵蓋每條規則的合法與非法輸入。
- **T12 yt-dlp 整合**
  - 尋找執行檔、`status`、`getInfo`（精簡輸出，含章節）、組合三種下載的參數（含影片與 MP3 的裁切、嵌入資訊，見 004 第 2、3 節）、解析進度與最終路徑、錯誤分類、VTT→TXT。
  - 以假 yt-dlp 做整合測試。
- **T13 工作管理**
  - `download`、`cancel`（含子程序樹與暫存檔清理）、`jobs`、斷線後繼續與狀態檔（plan 4.6）、記錄檔。
- **T14 平台功能**
  - `reveal`、`pickFolder`、預設下載資料夾、`updateYtDlp`（macOS 與 Windows 各自實作）。
- **T15 安裝與打包**
  - 交叉編譯腳本、macOS 與 Windows 的安裝及解除安裝腳本、原生訊息設定檔範本。
  - README 加入安裝章節。

## 階段 3a：橋接程式調整

- **T15a deno 與檔名格式**（QUESTIONS Q37、Q39）：`status` 回報 deno 的路徑與版本；安裝腳本與 README 改為一次安裝 yt-dlp、ffmpeg、deno；時間範圍檔名一小時以上改為 `01h02m03s`。

## 階段 4a：不需要橋接程式的下載（可與階段 3 並行）

- **T17 截圖與縮圖**（002 FR-30 至 FR-32、FR-50 至 FR-53）
- **T21a 字幕直接下載**（002 FR-40 至 FR-45，plan 3.8；橋接程式改用的部分留到 T21）
- **T22a 影片／MP3 面板的未連線狀態**：在橋接程式完成前，影片與 MP3 面板一律顯示 002 FR-2 的「需要安裝 yt-dlp」說明（偵測連線的部分先以「無法連線」處理，T16 完成後接上真正的檢查）；直播或尚未開始的影片依 FR-1 顯示無法下載。

## 階段 4：下載功能（002 前端）

- **T16 背景腳本與橋接程式連線**
  - `utils/native.ts`：連線、請求與回應配對、事件、自動重連。
  - 影片資訊快取、工作狀態、推播給分頁、通知與點擊通知。
- **T17 [P] 截圖與縮圖**：不需要橋接程式，依賴 T03。
- **T18 [P] 畫質清單邏輯**：`utils/format-list.ts` 與單元測試（以多組真實格式的範例資料測試）。
- **T19 影片面板**：依賴 T16、T18；包含時間範圍區塊與裁切時的估算大小（004 第 3 節）。
- **T20 MP3 面板**：依賴 T16、T04；包含與播放器同步、設為目前時間。時間範圍區塊與 T19 共用同一個元件。
- **T21 字幕改用橋接程式的部分**：直接下載失敗時改用橋接程式（依賴 T16、T21a）。
- **T22 共通狀態**
  - 未連線時的安裝說明、直播中或尚未開始的影片、進度環、錯誤訊息與重試。
- **T23 設定頁**
  - 下載資料夾（`pickFolder`）、檔名格式、嵌入資訊開關、連線狀態、更新 yt-dlp。

## 階段 4b：實測前的小修正

- **T18a 2K／4K／8K 列在主清單**（Q43）：沒有 H.264 的解析度改用 AV1（否則 VP9）＋M4A 合併成 MP4，列中加註可能需要較新的播放器；更新 002 FR-11 至 FR-13 的單元測試。
- **T15b 下載資料夾錯誤代碼**（Q46）：橋接程式在資料夾不存在或無法寫入時回 `PERMISSION_DENIED`（或新增 `DIR_NOT_FOUND`），擴充功能移除自行轉換。

## 階段 6：自訂工具列（006）

- **T32 工具列設定模型**：設定格式（含版本號）、預設值、新增／移除工具時的合併規則、說明面板與「更多」面板的「其他工具」區塊（006 FR-15 至 FR-17、FR-20、FR-23 至 FR-25）；純邏輯要有單元測試。
- **T33 工具列上的編輯模式**（006 FR-1、FR-3 至 FR-5、FR-10 至 FR-14、外觀）：拖曳、眼睛切換、分隔點、鍵盤操作、完成／取消／重設。
- **T34 設定頁的「工具列」區**（006 FR-2、FR-22）：清單、上移／下移、開關、拖曳、重設，與編輯模式共用設定模型。
- **完成條件**：006 驗收條件逐條自測；與既有功能的組合測試（例如隱藏的工具正在下載、正在循環）。

## 階段 7：介面語言（007）

- **T35 自己的翻譯層與語言設定**：依 plan 3.7.4 建立 `utils/i18n.ts`、`sync:uiLanguage`，把所有介面（工具列、面板、說明、編輯模式、彈出視窗、設定頁、通知）改用新的翻譯層；設定頁最上方加入語言選單與 FR-5 的說明。
- **T36 測試與檢查**：語言檔鍵一致、原始碼中使用的鍵都存在、切換語言時狀態保留；更新 `specs/e2e-checklist.md`。
- **T37 設定頁外觀**（007 FR-20 至 FR-24，plan 3.7.4）：外觀選單、記錄 YouTube 主題、設定頁與彈出視窗的顏色變數化與即時切換；更新 e2e-checklist。
- **完成條件**：007 驗收條件逐條自測；既有的所有測試全部通過（測試中依語言判斷的部分改為明確設定語言）。

## 階段 8：輕量安裝與自動更新（008）

兩個實作方並行：甲負責小幫手、腳本與發佈流程（T40–T43、T48），乙負責擴充功能（T44–T47）。雙方只透過 plan 4.9 的通訊協定銜接。

- **T40 發佈清單與簽章**（甲）：`host/internal/release`（清單格式、Ed25519 驗證、內建公鑰）、`host/cmd/yte-release`（keygen／sign／verify／lock-check）、`release/components.lock.json`（填入目前的穩定版本）、`specs/notes/ffmpeg-source.md`。單元測試：簽章正確／錯誤、清單欄位缺漏、sha256 不符。
- **T41 `--install`／`--uninstall` 與引導腳本**（甲）：plan 4.9；工具尋找順序改為安裝資料夾優先；舊腳本改為手動安裝用途；以本機假伺服器（`httptest`）測試整個安裝流程（下載、核對、解壓、防路徑穿越、重複執行、中途失敗再執行）。
- **T42 自動更新與新指令**（甲）：`--update`、24 小時限制、等待工作結束、自我更新、鎖檔、`status` 擴充、`setAutoUpdate`、`checkUpdates`、`uninstall`、FR-22 的自動更新重試與 `stage` 事件；以假 yt-dlp 與假伺服器測試。
- **T43 發佈流程**（甲）：`.github/workflows/release.yml`、`npm run release:dry`、`updates.json` 產生、Release 說明範本、Firefox `update_url`。
- **T44 新版本提醒**（乙）：plan 3.9；`utils/update-check.ts` 單元測試（版本比較含 `0.10.0 > 0.9.0`、24 小時、跳過版本、不再提醒、隔天再出現、網址檢查）；卡片延後條件與收合計時的測試（假計時器）。
- **T45 安裝引導**（乙）：plan 3.10 的安裝指令、三步驟說明、「這個指令會做什麼？」、自動偵測；設定頁「下載」區同樣的說明（008 FR-1、FR-2）。
- **T46 設定頁下載區與移除**（乙）：元件版本與來源、自動更新開關、立即檢查、最近結果、連續失敗提示、移除下載功能、新錯誤代碼的訊息（008 FR-24、FR-25、FR-30）。開發時用假的 `status` 回應測試，不依賴甲的進度。
- **T47 檢查更新**（乙）：T26 的檢查加入「`api.github.com` 只能出現在 `utils/update-check.ts`」；權限仍與 plan 3.2 完全一致；更新 `specs/e2e-checklist.md`（新增第 9 節：008 驗收條件）。
- **T48 文件**（甲，最後做）：README（英文與繁中）的安裝章節改為一行指令、手動安裝、移除、維護者；白話說明文件 `docs/what-gets-installed.md` 與 `docs/what-gets-installed.zh-TW.md`（008 FR-40）；第三方授權列表。專案採用 MIT（根目錄 `LICENSE` 已由規格方加入），README 結尾加入授權章節。
- **完成條件**：所有測試、`compile`、`build`、`build:firefox`、`build:host`、`release:dry`、`web-ext lint --self-hosted` 通過；008 驗收條件中能在容器內驗證的部分逐條自測，其餘列在 e2e-checklist。

## 階段 8a：移除自己的簽章（008 FR-51、FR-52）

- **T49 移除 Ed25519 簽章**：依 plan 4.9、4.10 的修改，移除 `components.json.sig`、內建公鑰、`--signature` 參數、`keygen`／`sign`／`verify`／`check-key`、發佈流程中的 `RELEASE_SIGNING_KEY`；錯誤代碼 `SIGNATURE_INVALID` 改為（或新增）清單無效時使用的代碼並同步擴充功能端的訊息；清單只接受本專案 GitHub 的網址（含轉址檢查）、SHA256 核對維持不變。
- **T50 沒有 Mozilla 金鑰時照常發佈**（008 FR-52）：發佈流程偵測 `AMO_JWT_ISSUER`、`AMO_JWT_SECRET` 是否設定；未設定時略過簽署、附未簽署的套件、不產生 `updates.json`、Release 說明加註。
- **T51 文件**：README（英文與繁中）「維護者」章節改為：開啟不可變更版本 → 建立版本標籤；Mozilla 金鑰列為之後的選用步驟。更新 `docs/what-gets-installed*.md`、`specs/notes/T40-T43-install-and-release.md`、e2e-checklist 第 10 節中與簽章相關的內容。
- **完成條件**：同階段 8；全文搜尋確認沒有殘留的 `ed25519`、`.sig`、`RELEASE_SIGNING_KEY`、`PublicKeyBase64`。

## 階段 9：改名與一鍵下載（009）

- **T52 專案改名**：repo 已改名為 `chidi0716/yt-toolbar-master`，擴充功能顯示名稱改為「YT Toolbar Master」（兩種語言相同）。
  - 所有 `chidi0716/youtube-extension` 網址改為新名稱：新版本提醒、安裝指令、元件清單允許的網址、Firefox `update_url`、發佈腳本、引導與移除腳本、README、docs、測試；Go module 路徑改為 `github.com/chidi0716/yt-toolbar-master/host`。
  - 發佈檔名中的 `youtube-extension-` 前綴改為 `yt-toolbar-master-`。
  - **內部識別碼也一併改名**（尚未發佈任何版本，現在改沒有相容問題）：
    - Firefox `gecko.id`：`yt-toolbar-master@chidi0716`
    - 原生訊息名稱：`com.chidi0716.yt_toolbar_master`（註冊檔、登錄機碼、`allowed_origins`／`allowed_extensions`）
    - 小幫手執行檔：`ytm-host`（`ytm-host-darwin-arm64` 等）；發佈用工具 `ytm-release`
    - 安裝資料夾：macOS `~/Library/Application Support/yt-toolbar-master/`、Windows `%LOCALAPPDATA%\yt-toolbar-master\`；記錄檔：macOS `~/Library/Logs/yt-toolbar-master/`
    - 下載暫存資料夾 `.ytm-tmp-<id>`；輸出標記、事件名稱、CSS／DOM 前綴、console 前綴等所有 `yte`／`youtube-extension` 字樣改為 `ytm`／`yt-toolbar-master`
    - npm 套件名稱 `yt-toolbar-master`
    - 例外：Chrome 的 `key`（擴充功能 ID 與名稱無關，不需要換）。
  - 規格與 plan 中描述這些名稱的地方（plan 3.3、4.7、4.8、4.9 等）一併更新。
- **T53 一鍵下載**（009 第一節，plan 3.11）：設定、畫質選擇函式與單元測試、面板流程、「改用其他畫質」、重複下載判斷、提示文字。
- **T54 安裝完成後的畫面**（009 第二節）：偵測到小幫手後顯示「小幫手已安裝完成」與「開始下載」按鈕，不自動下載。
- **T55 右鍵下載**（009 第三節）：`contextMenus` 權限、選單建立與更新、連結解析與單元測試、通知、設定開關。
- **T56 檢查與文件**：權限檢查測試（`utils/policy.test.ts`）加入 `contextMenus`；README（英文與繁中）功能介紹加入一鍵與右鍵下載；e2e-checklist 新增第 11 節（009 驗收條件）；與既有功能的組合測試（鎖定畫質、編輯工具列、隱藏的工具、下載清單）。
- **完成條件**：同階段 8（含 `release:dry`、`web-ext lint --self-hosted`）；全文搜尋確認程式碼、腳本、文件中沒有殘留 `youtube-extension`、`youtube_extension`、`yte-`、`yte_`（`specs/` 的歷史紀錄與 `.git` 除外）。

## 階段 5：收尾

- **T24 E2E 檢查清單**
  - 把 001–005 的驗收條件整理成 `specs/e2e-checklist.md`，標註每項在哪個瀏覽器與作業系統測試。
- **T25 文件**
  - README：功能介紹、安裝（擴充功能與橋接程式）、常見問題（例如 yt-dlp 需要更新、Gatekeeper 擋下）。
- **T26 最終檢查**
  - 確認 manifest 權限與 plan 3.2 完全一致。
  - 以全文搜尋確認沒有 `eval`、`new Function`、外部腳本網址、分析或追蹤程式碼。
  - 確認全部測試與打包都通過。

## 交付給實作方的方式

- 實作方是獨立的子代理，在獨立的 git 工作目錄中工作。它只看得到這個 repo，看不到參考資料。
- 每完成一個階段就停下來回報，由規格方對照驗收條件檢查後，才進入下一階段。
- 實作方的疑問寫在 `specs/QUESTIONS.md`。
