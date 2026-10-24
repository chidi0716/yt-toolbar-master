# YT Toolbar Master

[English](./README.md) | **繁體中文**

一個 YouTube 瀏覽器擴充功能，在影片播放器下方加入一條看起來像 YouTube 原生介面的工具列，提供下載與觀看輔助功能。使用 [WXT](https://wxt.dev) + TypeScript 開發，支援 Chrome 與 Firefox（Zen 等以 Firefox 為基礎的瀏覽器比照 Firefox）。

> **狀態：**規劃的功能已全部完成，待在 macOS、Windows、Chrome 與 Firefox／Zen 上實測（見[實測檢查清單](./specs/e2e-checklist.md)）。

## 功能

影片觀看頁的播放器與標題之間會出現一條工具列，顏色跟著 YouTube 的淺色或深色外觀；按 ✕ 可以隱藏（從擴充功能的彈出視窗重新開啟），每個面板都可以釘選。可以自訂要顯示哪些工具與順序（「更多」→「編輯工具列」，或在設定頁），隱藏的工具仍可以從「更多」選單使用。

**下載工具**

- **一鍵下載**（預設開啟）：點「影片」或「MP3」就以預設畫質直接開始下載（未修改時為 1080p MP4；MP3 使用上次選擇的位元率）。面板顯示標題、畫質與大小（例如「1080p60 MP4，約 320 MB」）與進度；「改用其他畫質」會取消這次下載並顯示下方的完整清單。下載中再點一次不會重複下載。可以在設定頁關閉，改回每次先選再下載。
- **右鍵下載**：在 YouTube 的影片連結（首頁、搜尋結果、推薦、播放清單）按右鍵 →「YT Toolbar Master」→「下載影片（1080p MP4）」或「下載 MP3（192 kbps）」，不用點進影片。開始與完成時會顯示通知；下載也會出現在每個 YouTube 分頁的影片與 MP3 面板中，可以取消。可以在設定頁關閉。
- **影片**：由高到低的畫質清單（標示 8K／4K／2K／1080／HD）與檔案大小，預設為 MP4，「顯示更多格式」可選 WEBM。2K 以上 YouTube 沒有 H.264 版本，改以 AV1（或 VP9）合併成 MP4，並標示「部分播放器可能無法播放」。
- **MP3**：64–320 kbps（記住上次選擇）。
- 影片與 MP3 都可以設定**時間範圍**，只下載其中一段：區間滑桿、開始／結束輸入框、「與播放器同步」與「設為目前時間」。
- 自動在影片與 MP3 中嵌入封面、標題、頻道、上傳日期、網址與章節（可以關閉）。
- 工具列按鈕顯示進度，面板顯示速度與剩餘時間，可以取消、重試，錯誤訊息易懂；完成時顯示通知（點通知會顯示檔案）；關閉分頁或瀏覽器，下載仍會完成。
- **縮圖**（只列出實際存在的尺寸）、**字幕**（上傳的與自動產生的，SRT／VTT／TXT）與目前畫面的**截圖**不需要橋接程式，存到瀏覽器的下載位置；字幕直接下載失敗時改用 yt-dlp。
- 經由 yt-dlp 下載的影片、MP3 與字幕存到設定頁指定的資料夾，檔名格式可以選擇。

影片與 MP3 下載經由一個小型橋接程式，使用你電腦上的 [yt-dlp](https://github.com/yt-dlp/yt-dlp)、[ffmpeg](https://ffmpeg.org) 與 [deno](https://deno.com)；見[安裝下載功能](#install-the-helper)。

**觀看輔助**

- 深色模式（切換 YouTube 自己的外觀設定）、劇院模式（播放器與工具列以外變暗）、子母畫面
- 捲動時的浮動播放器（可拖到任一角落）、片段循環或重複 N 次
- 切換分頁時自動暫停、自動播放開關、純音訊模式、滑鼠滾輪調音量、隱藏留言
- 鎖定畫質（例如一律 1080p，手動改畫質時尊重你的選擇）
- 複製帶或不帶目前時間的 `youtu.be` 連結，或 Markdown 格式

**頁面整理**（在設定頁開關，於 YouTube 所有頁面作用，工具列隱藏時也有效）

- 永遠使用原始語音（不播放 AI 配音）；隱藏片尾推薦卡片與結尾畫面
- 自動關閉「要繼續觀看嗎？」；停用縮圖自動預覽
- Shorts 改用一般播放器；隱藏 Shorts；顯示完整影片標題

## 隱私與安全

- 不收集任何使用資料，只與 YouTube 及本機的橋接程式溝通。以「載入未封裝項目」（Chrome）或臨時附加元件載入時，另外會向本專案的 GitHub 查詢最新版本號，每天最多一次、不送出任何識別資訊，用來提醒你更新；提醒可以關閉。
- 小幫手與安裝腳本只連到本專案的 GitHub 正式版本、yt-dlp 與 deno 的官方正式版本，以及[會安裝什麼](./docs/what-gets-installed.zh-TW.md)中列出的 ffmpeg 下載網站；yt-dlp 會連到 YouTube。
- 不執行遠端程式碼：所有程式都打包在擴充功能內，不從 CDN 載入腳本，不使用 `eval`。
- 只申請必要的權限，內容腳本只在 `youtube.com` 執行。
- 影片在你的電腦上處理，不會上傳到任何第三方服務。

完整原則見 [`specs/constitution.md`](./specs/constitution.md)。

## 下載功能的運作方式

瀏覽器擴充功能無法直接執行 yt-dlp，所以會在你的電腦上安裝一支小型橋接程式（以 Go 撰寫），透過瀏覽器的原生訊息（Native Messaging）機制連線：

```
YouTube 上的工具列  →  擴充功能背景腳本  →  本機橋接程式  →  yt-dlp  →  ffmpeg
```

只需以一行指令安裝一次（見[安裝下載功能（橋接程式）](#install-the-helper)），之後小幫手會自動更新自己、yt-dlp 與 deno。縮圖、截圖、字幕與所有觀看輔助功能不需要橋接程式。

<a id="install-the-helper"></a>

## 安裝下載功能（橋接程式）

影片、MP3 下載（以及直接下載失敗時的字幕下載）需要在電腦上安裝四個程式：本專案的**小幫手**（橋接程式）、[yt-dlp](https://github.com/yt-dlp/yt-dlp)（下載影片的開源工具）、[ffmpeg](https://ffmpeg.org)（合併影音與轉 MP3）與 [deno](https://deno.com)（yt-dlp 需要的 JavaScript 執行環境）。縮圖、截圖、字幕與所有觀看輔助功能不需要它們。

一行指令就能全部裝好，約 150 MB（Windows 約 300 MB），只放在你帳號下的一個專屬資料夾。不需要系統管理員權限、`sudo` 或任何開發工具，不會修改使用者資料夾以外的地方，可以隨時移除。每個檔案、下載來源與網路連線見[會安裝什麼](./docs/what-gets-installed.zh-TW.md)。

### macOS（Apple Silicon 與 Intel）

1. 按 ⌘＋空白鍵，輸入「終端機」並按 Enter。
2. 貼上這行指令並按 Enter：
   ```bash
   curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh
   ```
3. 看到「完成」後回到瀏覽器，影片與 MP3 面板會自動切換成可下載的畫面。

### Windows 10/11（x64）

1. 按開始鍵，輸入「PowerShell」並開啟。
2. 貼上這行指令並按 Enter：
   ```powershell
   irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex
   ```
3. 看到「完成」後回到瀏覽器，影片與 MP3 面板會自動切換成可下載的畫面。

擴充功能的影片、MP3 面板與設定頁也會顯示同樣的指令與步驟。

### 這個指令會做什麼？

1. 從本專案的 [GitHub 正式版本](https://github.com/chidi0716/yt-toolbar-master/releases)下載對應系統的小幫手，並與發佈清單（`components.json`）核對 SHA-256。
2. 小幫手檢查發佈清單（只接受以 HTTPS 從本專案 GitHub 正式版本取得的清單），再下載：
   - yt-dlp：[yt-dlp 官方正式版本](https://github.com/yt-dlp/yt-dlp/releases)，核對官方檢查碼；
   - deno：[deno 官方正式版本](https://github.com/denoland/deno/releases)，核對官方檢查碼；
   - ffmpeg 與 ffprobe：macOS 從 [Martin Riedl 的 FFmpeg Build Server](https://ffmpeg.martin-riedl.de)、Windows 從 [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) 下載，核對發佈時記錄的檢查碼。電腦上已經有 ffmpeg 與 ffprobe（例如 Homebrew）時沿用，不另外下載。
3. 全部放在 `~/Library/Application Support/yt-toolbar-master/`（macOS）或 `%LOCALAPPDATA%\yt-toolbar-master\`（Windows），並為 Chrome 與 Firefox（含 Zen）註冊小幫手。

每個下載的檔案都必須符合發佈清單中的 SHA-256，否則刪除且不替換任何東西。本專案的版本在 GitHub 上設為不可變更，發佈後檔案不能再被修改。

每一步都會即時印出說明。重複執行只會修復或更新需要的部分；任何一步失敗時會印出原因，再執行一次同一個指令即可從失敗處繼續。你自己安裝的程式（例如 Homebrew 的 yt-dlp）不會被修改；小幫手優先使用自己資料夾中的版本，設定頁會標示目前使用哪一份。

**想先看過腳本再執行？** 先下載、閱讀，再執行：

```bash
curl -fsSL -o install.sh https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh
less install.sh
sh install.sh
```

```powershell
irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 -OutFile install.ps1
notepad install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

### 自動更新

- **yt-dlp、deno 與小幫手**會在你開始下載時於背景自動更新，每天最多檢查一次（沒有下載就不檢查、不連網）。不會延遲這次下載；替換在下載結束後進行，任何一步失敗都保留舊版本。yt-dlp 以它自己的 `yt-dlp -U` 更新，其他元件依簽署過的發佈清單核對。
- YouTube 改版導致下載失敗、顯示「請更新 yt-dlp」時，小幫手會立即更新 yt-dlp，並自動重試該下載一次。
- ffmpeg 不自動更新（很少需要）；小幫手的新版本可以附帶更新。
- 在設定頁的「下載」區可以關閉自動更新、立即檢查更新，並查看各元件的版本與來源。

### 移除

在設定頁的「下載」區按「移除下載功能」，會刪除上面的專屬資料夾（小幫手、yt-dlp、deno、ffmpeg、記錄檔）與瀏覽器註冊。已下載的檔案不受影響。

擴充功能已經移除時，執行：

```bash
curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.sh | sh
```

```powershell
irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.ps1 | iex
```

### 手動安裝

想自己安裝 yt-dlp、ffmpeg、deno，或從原始碼建置小幫手時：

1. 安裝這些工具，例如以 [Homebrew](https://brew.sh)（`brew install yt-dlp ffmpeg deno`）或 [winget](https://learn.microsoft.com/windows/package-manager/winget/)（`winget install yt-dlp.yt-dlp Gyan.FFmpeg DenoLand.Deno`）。
2. 取得小幫手：從[版本頁面](https://github.com/chidi0716/yt-toolbar-master/releases)下載 `yt-toolbar-master-host-macos.zip` 或 `yt-toolbar-master-host-windows.zip` 並解壓縮；或安裝 [Go](https://go.dev/dl/) 1.24 以上與 Node.js 後執行 `npm run build:host`（輸出在 `host/dist/`）。
3. 在該資料夾執行腳本（不要加 `sudo`）：
   ```bash
   sh install.sh
   ```
   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```
   腳本會執行 `ytm-host --install --offline`：小幫手把自己複製到上面的資料夾並為 Chrome 與 Firefox 註冊，不下載任何東西，並列出找到了哪些 yt-dlp、ffmpeg、deno。
4. 重新啟動瀏覽器，在影片或 MP3 面板按「重新檢查」。

手動安裝的移除方式：在同一個資料夾執行 `uninstall.sh` 或 `uninstall.ps1`（或上面的一行指令）。

### 疑難排解

- **面板仍顯示找不到小幫手**：安裝後請重新啟動瀏覽器。Zen 等以 Firefox 為基礎的瀏覽器使用 Firefox 的註冊。
- **指令顯示「失敗」後停止**：看印出的原因（網路、磁碟空間、檔案與檢查碼不符等），必要時排除後再執行一次同一個指令，會從停下的地方繼續。
- **顯示「yt-dlp 版本過舊」或缺少部分畫質**：小幫手會自動更新 yt-dlp；也可以在設定頁按「立即檢查更新」。若使用自己安裝的 yt-dlp（Homebrew 或 winget），請以 `brew upgrade yt-dlp` 或 `winget upgrade --id yt-dlp.yt-dlp` 更新。
- **記錄檔**：`~/Library/Logs/yt-toolbar-master/host.log`（macOS）或 `%LOCALAPPDATA%\yt-toolbar-master\logs\host.log`（Windows）。只記錄指令名稱與錯誤訊息，不含 cookie 或帳號資訊。
- 關閉 YouTube 分頁或瀏覽器後，下載仍會繼續。未完成的檔案放在下載資料夾中隱藏的 `.ytm-tmp-…` 資料夾，下載完成、失敗或取消時會刪除。

**小幫手能做的事**：只有擴充功能需要的固定指令（檢查狀態、讀取影片資訊、下載、取消、列出下載、顯示檔案、選擇資料夾、更新、移除）。只有本擴充功能能啟動它（註冊設定檔中的 `allowed_origins`／`allowed_extensions`）。它只接受 YouTube 影片 ID，不接受網址或命令列選項，不開啟任何網路連接埠。yt-dlp 會連到 YouTube；小幫手本身只為了安裝與更新連到 GitHub 與上面列出的 ffmpeg 下載網站。

## 常見問題

**下載突然失敗，顯示「YouTube 有變動，請更新 yt-dlp」**
YouTube 經常改版，yt-dlp 會很快跟上。以一行指令安裝時，小幫手會自動更新 yt-dlp 並重試；仍然失敗時，在面板或設定頁按「更新 yt-dlp」。若使用自己以 Homebrew 或 winget 安裝的 yt-dlp，請執行畫面上顯示的指令（`brew upgrade yt-dlp` 或 `winget upgrade --id yt-dlp.yt-dlp`）。

**面板顯示只缺 deno，還能下載嗎？**
可以。沒有 deno 時，yt-dlp 可能取得不到部分 YouTube 格式（常見的是最高畫質）。再執行一次[一行安裝指令](#install-the-helper)（會補上缺少的元件），或自行以 `brew install deno`、`winget install DenoLand.Deno` 安裝，然後按「重新檢查」。

**macOS 顯示橋接程式「無法打開」或「來自未識別的開發者」（Gatekeeper）**
在「終端機」以 `curl` 下載的檔案不會被標記為「來自網路」，所以一行指令安裝不會遇到這個問題。若是從瀏覽器下載 zip 手動安裝，請在該資料夾再執行一次 `sh install.sh`（會移除隔離屬性），或改用一行指令安裝；不要加 `sudo`。

**Zen（或其他以 Firefox 為基礎的瀏覽器）找不到橋接程式**
安裝程式為 Firefox 註冊小幫手，Zen 通常會讀取同一個位置。安裝後請完全結束 Zen 再開啟，並按「重新檢查」。若仍顯示尚未連接，請開 issue 回報 Zen 版本、macOS 或 Windows 版本，以及 `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.chidi0716.yt_toolbar_master.json`（macOS）是否存在；擴充功能主控台（`about:debugging` 中找到本擴充功能，按「檢查」）裡 `[yt-toolbar-master]` 開頭的訊息也很有幫助。

**下載失敗，顯示「無法寫入下載資料夾」**
設定頁選擇的資料夾被移動或刪除、磁碟已滿，或資料夾沒有寫入權限。請在設定頁改選其他資料夾或按「使用預設」。macOS 上「桌面」「文件」等資料夾可能需要授權：出現詢問是否允許存取時請允許。

**Firefox 重新啟動後擴充功能不見了**
從 `about:debugging` 載入的是暫時附加元件，Firefox 重新啟動後會被移除。請改從[版本頁面](https://github.com/chidi0716/yt-toolbar-master/releases)下載簽署過的 `.xpi` 安裝（見[手動載入擴充功能](#手動載入擴充功能)），它也會自動更新。

## 開發

```bash
npm install
npm run dev           # Chrome，會自動重新載入
npm run dev:firefox   # Firefox
```

## 建置

```bash
npm run compile         # 型別檢查
npm test                # 單元測試（Vitest）
npm run build           # Chrome  → .output/chrome-mv3
npm run build:firefox   # Firefox → .output/firefox-mv3
npm run build:host      # 本機橋接程式 → host/dist/（macOS arm64/amd64、Windows amd64；需要 Go）
npm run zip
npm run zip:firefox
npm run sign:firefox    # Firefox → 簽署後的 .xpi，輸出到 .output/firefox-signed（見下方）
npm run release:dry     # 不需要 Secret，產生所有發佈檔案 → release/dist（見「發佈新版本」）
```

## 手動載入擴充功能

[版本頁面](https://github.com/chidi0716/yt-toolbar-master/releases)有打包好的 `yt-toolbar-master-<版本>-chrome.zip` 與 `yt-toolbar-master-<版本>-firefox.xpi`（尚未經 Mozilla 簽署的版本改附 `yt-toolbar-master-<版本>-firefox-temporary.zip`，Firefox 與 Zen 只能以臨時附加元件載入）。使用自己建置的版本時，改用 `.output/chrome-mv3` 或 `.output/firefox-mv3`。

- **Chrome**：把 Chrome 版解壓縮到一個會保留的資料夾，開啟 `chrome://extensions`，打開「開發人員模式」，點「載入未封裝項目」，選擇該資料夾（或 `.output/chrome-mv3`）。Chrome 無法自動更新這個擴充功能；有新版本時擴充功能會顯示提醒。更新方式：把新版本解壓縮覆蓋同一個資料夾，再到 `chrome://extensions` 按「重新載入」。
- **Firefox（開發用）**：開啟 `about:debugging#/runtime/this-firefox`，點「載入臨時附加元件」，選擇 `.output/firefox-mv3/manifest.json`。臨時附加元件在 Firefox 重新啟動後會被移除。
- **Firefox（永久安裝，Firefox 140 以上，含 Zen）**：正式版 Firefox 只能安裝經 Mozilla 簽署的附加元件，因此本擴充功能以 addons.mozilla.org 的「不公開（unlisted）」頻道簽署，不在 AMO 網站上架。用 Firefox 開啟簽署後的 `.xpi` 檔（或拖進 Firefox 視窗），在安裝提示中確認即可。簽署版會自動更新（想立即更新：`about:addons` → 齒輪圖示 →「檢查更新」）。

### 簽署 Firefox 版（維護者）

1. 在 <https://addons.mozilla.org/developers/addon/api/key/> 建立 API 金鑰。
2. 以環境變數提供金鑰（不得提交進 repo，也不要寫進任何設定檔）：
   ```bash
   export WEB_EXT_API_KEY=user:12345:67
   export WEB_EXT_API_SECRET=...
   ```
3. 先 commit 所有變更，再執行 `npm run sign:firefox`。它會建置 `.output/firefox-mv3`、以 `git archive` 把目前 commit 的原始碼打包成 `.output/firefox-sources.zip`（不含 `node_modules`、`.output`、`host/dist`、`spikes`），再執行 `web-ext sign --channel unlisted --upload-source-code`。簽署後的 `.xpi` 存到 `.output/firefox-signed/`。加上 `-- --dry-run` 會產生原始碼壓縮檔並印出指令，但不送出。

### 發佈新版本（維護者）

推送 `v*` 標籤時會執行 [`.github/workflows/release.yml`](./.github/workflows/release.yml)：執行測試、建置擴充功能與三種小幫手、依 [`release/components.lock.json`](./release/components.lock.json) 與官方檢查碼核對每個第三方檔案、產生 `components.json`（每個檔案的網址與 SHA-256），最後建立 GitHub Release，附上安裝腳本、小幫手、`components.json`、Chrome zip、Firefox 套件與 `SHA256SUMS`。設定了 Mozilla API 金鑰時，Firefox 版會送 Mozilla 簽署（不公開頻道），並附上 `updates.json`（Firefox 自動更新用）。標籤含「-」（例如 `v0.2.0-beta.1`）時建立為預先發行版本：不會成為「最新版本」，所以不會觸發新版本提醒與自動更新，Firefox 版也不送簽署（Mozilla 每個版本號只能簽署一次）。

本專案不使用自己的簽章金鑰。小幫手只接受以 HTTPS 從本專案 GitHub 正式版本取得的 `components.json`，並以其中的 SHA-256 核對每個下載的檔案；開啟「不可變更版本」後，已發佈版本的檔案無法再被修改或替換。

#### 第一次設定

1. **開啟不可變更版本**：repo 的 **Settings → General**，在 **Releases** 區開啟不可變更版本（immutable releases）。之後已發佈的版本與檔案就不能再修改。
2. 在本機試跑整個流程：`npm run release:dry`（輸出在 `release/dist/`，Firefox 版不送簽署）。
3. 建立第一個版本（見下方）。不需要任何 Secret：沒有 Mozilla API 金鑰時，Release 會附上未簽署的 `yt-toolbar-master-<版本>-firefox-temporary.zip`（Firefox／Zen 只能以臨時附加元件載入）、不產生 `updates.json`，並在說明中註明。

**之後（選用）：Firefox／Zen 的 Mozilla 簽署**。在 <https://addons.mozilla.org/developers/addon/api/key/> 建立 API 金鑰，加到 repo 的 Secrets（**Settings → Secrets and variables → Actions → New repository secret**）：`AMO_JWT_ISSUER`（「JWT issuer」）與 `AMO_JWT_SECRET`（「JWT secret」）。下一個版本起 `.xpi` 會經過簽署，Firefox／Zen 也會自動更新。

#### 發佈步驟

1. 修改 `package.json` 的 `version`（例如 `0.2.0`）並 commit。
2. 需要時更新 `release/components.lock.json` 中固定的第三方版本（見 [`specs/notes/ffmpeg-source.md`](./specs/notes/ffmpeg-source.md)），並以 `cd host && go run ./cmd/ytm-release lock-check -download` 檢查。
3. 建立並推送標籤：`git tag v0.2.0 && git push origin v0.2.0`（必須與 `package.json` 相同）。
4. 流程完成後檢查版本頁面。簽署版的 Firefox／Zen 會自動更新；Chrome（與 Firefox 臨時附加元件）使用者會在擴充功能中看到附有版本連結的提醒。

### 從原始碼建置（給附加元件審查者）

Firefox 版由 [WXT](https://wxt.dev)／Vite 打包並壓縮。從上傳的原始碼重現建置：

- 環境：Linux、macOS 或 Windows，Node.js 22（npm 10）。擴充功能本身不需要其他工具。
- 指令：
  ```bash
  npm ci
  npm run build:firefox
  ```
- 輸出：`.output/firefox-mv3/`，與送審的套件內容相同。

## 專案文件

本專案採用規格驅動開發（SDD）與 clean-room 流程：

| 文件 | 內容 |
|---|---|
| [`specs/constitution.md`](./specs/constitution.md) | 專案原則 |
| [`specs/CLEANROOM.md`](./specs/CLEANROOM.md) | Clean-room 流程與紀錄 |
| [`specs/001-toolbar`](./specs/001-toolbar/spec.md) | 工具列外框 |
| [`specs/002-downloads`](./specs/002-downloads/spec.md) | 下載功能 |
| [`specs/003-viewing-tools`](./specs/003-viewing-tools/spec.md) | 觀看輔助功能 |
| [`specs/004-convenience`](./specs/004-convenience/spec.md) | 便利功能：鎖定畫質、嵌入資訊、時間範圍下載、複製連結 |
| [`specs/005-page-tidy`](./specs/005-page-tidy/spec.md) | 頁面整理（設定頁） |
| [`specs/006-toolbar-customization`](./specs/006-toolbar-customization/spec.md) | 自訂工具列（顯示哪些工具與順序） |
| [`specs/007-ui-language`](./specs/007-ui-language/spec.md) | 在設定頁選擇介面語言 |
| [`specs/008-install-and-update`](./specs/008-install-and-update/spec.md) | 一行指令安裝、自動更新與新版本提醒 |
| [`docs/what-gets-installed.zh-TW.md`](./docs/what-gets-installed.zh-TW.md) | 下載功能會安裝什麼、放在哪裡、會連到哪裡 |
| [`specs/plan.md`](./specs/plan.md)／[`specs/tasks.md`](./specs/tasks.md) | 技術計畫與任務拆解 |
| [`specs/ROADMAP.md`](./specs/ROADMAP.md) | 後續擴充方向 |
| [`specs/BACKLOG.md`](./specs/BACKLOG.md) | 可新增功能清單 |
| [`specs/e2e-checklist.md`](./specs/e2e-checklist.md) | 實測檢查清單 |

## 免責聲明

下載 YouTube 內容可能違反 YouTube 服務條款。請只下載你有權下載的內容，並僅供個人使用。由於 Chrome 線上應用程式商店不允許 YouTube 下載工具，本擴充功能需要手動載入。

## 授權

[MIT](./LICENSE) © chidi0716。

下載功能會從官方來源安裝第三方程式：yt-dlp（[Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE)；單一執行檔為 GPLv3+）、deno（[MIT](https://github.com/denoland/deno/blob/main/LICENSE.md)）與 ffmpeg（[GPL 版本](https://ffmpeg.org/legal.html)）。它們不屬於本專案，各自保有自己的授權。這些程式以及擴充功能與小幫手中包含的開源程式碼，見 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。
