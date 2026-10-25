# 開發與維護

[English](./development.md) | **繁體中文**

## 下載功能的運作方式

瀏覽器擴充功能無法直接執行 yt-dlp，所以會在你的電腦上安裝一支小幫手（以 Go 撰寫），透過瀏覽器的原生訊息（Native Messaging）機制連線：

```
YouTube 上的工具列  →  擴充功能背景腳本  →  本機小幫手  →  yt-dlp  →  ffmpeg
```

只需以一行指令安裝一次（見[安裝下載功能](../README.zh-TW.md#install-the-helper)），之後小幫手會自動更新自己、yt-dlp 與 deno。縮圖、截圖、字幕與所有觀看輔助功能不需要小幫手。

<a id="install-the-helper"></a>

## 這個指令會做什麼？

1. 從本專案的 [GitHub 正式版本](https://github.com/chidi0716/yt-toolbar-master/releases)下載對應系統的小幫手，並與發佈清單（`components.json`）核對 SHA-256。
2. 小幫手檢查發佈清單（只接受以 HTTPS 從本專案 GitHub 正式版本取得的清單），再下載：
   - yt-dlp：[yt-dlp 官方正式版本](https://github.com/yt-dlp/yt-dlp/releases)，核對官方檢查碼；
   - deno：[deno 官方正式版本](https://github.com/denoland/deno/releases)，核對官方檢查碼；
   - ffmpeg 與 ffprobe：macOS 從 [Martin Riedl 的 FFmpeg Build Server](https://ffmpeg.martin-riedl.de)、Windows 從 [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) 下載，核對發佈時記錄的檢查碼。電腦上已經有 ffmpeg 與 ffprobe（例如 Homebrew）時沿用，不另外下載。
3. 全部放在 `~/Library/Application Support/yt-toolbar-master/`（macOS）或 `%LOCALAPPDATA%\yt-toolbar-master\`（Windows），並為 Chrome 與 Firefox註冊小幫手。

每個下載的檔案都必須符合發佈清單中的 SHA-256，否則刪除且不替換任何東西。

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

## 手動安裝

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

## 疑難排解

- **面板仍顯示找不到小幫手**：安裝後請重新啟動瀏覽器。
- **指令顯示「失敗」後停止**：看印出的原因（網路、磁碟空間、檔案與檢查碼不符等），必要時排除後再執行一次同一個指令，會從停下的地方繼續。
- **顯示「yt-dlp 版本過舊」或缺少部分畫質**：小幫手會自動更新 yt-dlp；也可以在設定頁按「立即檢查更新」。若使用自己安裝的 yt-dlp（Homebrew 或 winget），請以 `brew upgrade yt-dlp` 或 `winget upgrade --id yt-dlp.yt-dlp` 更新。
- **記錄檔**：`~/Library/Logs/yt-toolbar-master/host.log`（macOS）或 `%LOCALAPPDATA%\yt-toolbar-master\logs\host.log`（Windows）。只記錄指令名稱與錯誤訊息，不含 cookie 或帳號資訊。
- 關閉 YouTube 分頁或瀏覽器後，下載仍會繼續。未完成的檔案放在下載資料夾中隱藏的 `.ytm-tmp-…` 資料夾，下載完成、失敗或取消時會刪除。

**小幫手能做的事**：只有擴充功能需要的固定指令（檢查狀態、讀取影片資訊、下載、取消、列出下載、顯示檔案、選擇資料夾、更新、移除）。只有本擴充功能能啟動它（註冊設定檔中的 `allowed_origins`／`allowed_extensions`）。它只接受 YouTube 影片 ID，不接受網址或命令列選項，不開啟任何網路連接埠。yt-dlp 會連到 YouTube；小幫手本身只為了安裝與更新連到 GitHub 與上面列出的 ffmpeg 下載網站。

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
npm run build:host      # 小幫手 → host/dist/（macOS arm64/amd64、Windows amd64；需要 Go）
npm run zip
npm run zip:firefox
npm run sign:firefox    # Firefox → 簽署後的 .xpi，輸出到 .output/firefox-signed（見下方）
npm run release:dry     # 不需要 Secret，產生所有發佈檔案 → release/dist（見「發佈新版本」）
```

## 手動載入擴充功能

[版本頁面](https://github.com/chidi0716/yt-toolbar-master/releases)有打包好的 `yt-toolbar-master-<版本>-chrome.zip` 與 `yt-toolbar-master-<版本>-firefox.xpi`（尚未經 Mozilla 簽署的版本改附 `yt-toolbar-master-<版本>-firefox-temporary.zip`，Firefox 只能以暫時附加元件載入）。使用自己建置的版本時，改用 `.output/chrome-mv3` 或 `.output/firefox-mv3`。

- **Chrome**：把 Chrome 版解壓縮到一個會保留的資料夾，開啟 `chrome://extensions`，打開「開發人員模式」，點「載入未封裝項目」，選擇該資料夾（或 `.output/chrome-mv3`）。Chrome 無法自動更新這個擴充功能；有新版本時擴充功能會顯示提醒。更新方式：把新版本解壓縮覆蓋同一個資料夾，再到 `chrome://extensions` 按「重新載入」。
- **Firefox（開發用）**：開啟 `about:debugging#/runtime/this-firefox`，點「載入臨時附加元件」，選擇 `.output/firefox-mv3/manifest.json`。臨時附加元件在 Firefox 重新啟動後會被移除。
- **Firefox（永久安裝，Firefox 140 以上）**：正式版 Firefox 只能安裝經 Mozilla 簽署的附加元件，因此本擴充功能以 addons.mozilla.org 的「不公開（unlisted）」頻道簽署，不在 AMO 網站上架。用 Firefox 開啟簽署後的 `.xpi` 檔（或拖進 Firefox 視窗），在安裝提示中確認即可。簽署版會自動更新（想立即更新：`about:addons` → 齒輪圖示 →「檢查更新」）。

### 簽署 Firefox 版（維護者）

1. 在 <https://addons.mozilla.org/developers/addon/api/key/> 建立 API 金鑰。
2. 以環境變數提供金鑰（不得提交進 repo，也不要寫進任何設定檔）：
   ```bash
   export WEB_EXT_API_KEY=user:12345:67
   export WEB_EXT_API_SECRET=...
   ```
3. 先 commit 所有變更，再執行 `npm run sign:firefox`。它會建置 `.output/firefox-mv3`、以 `git archive` 把目前 commit 的原始碼打包成 `.output/firefox-sources.zip`（不含 `node_modules`、`.output`、`host/dist`、`spikes`），再執行 `web-ext sign --channel unlisted --upload-source-code`。簽署後的 `.xpi` 存到 `.output/firefox-signed/`。加上 `-- --dry-run` 會產生原始碼壓縮檔並印出指令，但不送出。

### 發佈新版本（維護者）

推送 `v*` 標籤時會執行 [`.github/workflows/release.yml`](../.github/workflows/release.yml)：執行測試、建置擴充功能與三種小幫手、依 [`release/components.lock.json`](../release/components.lock.json) 與官方檢查碼核對每個第三方檔案、產生 `components.json`（每個檔案的網址與 SHA-256），最後建立 GitHub Release，附上安裝腳本、小幫手、`components.json`、Chrome zip、Firefox 套件與 `SHA256SUMS`。設定了 Mozilla API 金鑰時，Firefox 版會送 Mozilla 簽署（不公開頻道），並附上 `updates.json`（Firefox 自動更新用）。標籤含「-」（例如 `v0.2.0-beta.1`）時建立為預先發行版本：不會成為「最新版本」，所以不會觸發新版本提醒與自動更新，Firefox 版也不送簽署（Mozilla 每個版本號只能簽署一次）。

本專案不使用自己的簽章金鑰。小幫手只接受以 HTTPS 從本專案 GitHub 正式版本取得的 `components.json`，並以其中的 SHA-256 核對每個下載的檔案。

#### 第一次設定

1. 在本機試跑整個流程：`npm run release:dry`（輸出在 `release/dist/`，Firefox 版不送簽署）。
2. 建立第一個版本（見下方）。不需要任何 Secret：沒有 Mozilla API 金鑰時，Release 會附上未簽署的 `yt-toolbar-master-<版本>-firefox-temporary.zip`（Firefox 只能以臨時附加元件載入）、不產生 `updates.json`，並在說明中註明。

**之後（選用）：Firefox 的 Mozilla 簽署**。在 <https://addons.mozilla.org/developers/addon/api/key/> 建立 API 金鑰，加到 repo 的 Secrets（**Settings → Secrets and variables → Actions → New repository secret**）：`AMO_JWT_ISSUER`（「JWT issuer」）與 `AMO_JWT_SECRET`（「JWT secret」）。下一個版本起 `.xpi` 會經過簽署，Firefox 也會自動更新。

#### 發佈步驟

1. 修改 `package.json` 的 `version`（例如 `0.2.0`）並 commit。
2. 需要時更新 `release/components.lock.json` 中固定的第三方版本（見 [`specs/notes/ffmpeg-source.md`](../specs/notes/ffmpeg-source.md)），並以 `cd host && go run ./cmd/ytm-release lock-check -download` 檢查。
3. 推送標籤（`git tag v0.2.0 && git push origin v0.2.0`，必須與 `package.json` 相同），或推送到 `release` 分支（`git push origin main:release`），流程會自己建立 `v<package.json 的版本>` 標籤。
4. 流程完成後檢查版本頁面。簽署版的 Firefox 會自動更新；Chrome（與 Firefox 臨時附加元件）使用者會在擴充功能中看到附有版本連結的提醒。

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
| [`specs/constitution.md`](../specs/constitution.md) | 專案原則 |
| [`specs/CLEANROOM.md`](../specs/CLEANROOM.md) | Clean-room 流程與紀錄 |
| [`specs/001-toolbar`](../specs/001-toolbar/spec.md) | 工具列外框 |
| [`specs/002-downloads`](../specs/002-downloads/spec.md) | 下載功能 |
| [`specs/003-viewing-tools`](../specs/003-viewing-tools/spec.md) | 觀看輔助功能 |
| [`specs/004-convenience`](../specs/004-convenience/spec.md) | 便利功能：鎖定畫質、嵌入資訊、時間範圍下載、複製連結 |
| [`specs/005-page-tidy`](../specs/005-page-tidy/spec.md) | 頁面整理（設定頁） |
| [`specs/006-toolbar-customization`](../specs/006-toolbar-customization/spec.md) | 自訂工具列（顯示哪些工具與順序） |
| [`specs/007-ui-language`](../specs/007-ui-language/spec.md) | 在設定頁選擇介面語言 |
| [`specs/008-install-and-update`](../specs/008-install-and-update/spec.md) | 一行指令安裝、自動更新與新版本提醒 |
| [`specs/009-quick-download`](../specs/009-quick-download/spec.md) | 一鍵下載與右鍵下載 |
| [`docs/what-gets-installed.zh-TW.md`](./what-gets-installed.zh-TW.md) | 下載功能會安裝什麼、放在哪裡、會連到哪裡 |
| [`specs/plan.md`](../specs/plan.md)／[`specs/tasks.md`](../specs/tasks.md) | 技術計畫與任務拆解 |
| [`specs/ROADMAP.md`](../specs/ROADMAP.md) | 後續擴充方向 |
| [`specs/BACKLOG.md`](../specs/BACKLOG.md) | 可新增功能清單 |
| [`specs/e2e-checklist.md`](../specs/e2e-checklist.md) | 實測檢查清單 |
