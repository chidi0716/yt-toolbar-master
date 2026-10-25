# YT Toolbar Master

[English](./README.md) | **繁體中文**

Chrome 與 Firefox 的 YouTube 工具列：一鍵下載與觀看工具。

> **狀態：測試版。** 遇到問題請[回報](https://github.com/chidi0716/yt-toolbar-master/issues/new/choose)。

## 功能

**下載**
- **一鍵下載影片與 MP3**：點「影片」或「MP3」就以預設畫質開始下載（1080p MP4、MP3 192 kbps，可在設定頁更改）。
- 在 YouTube 的任何影片連結上**按右鍵下載**。
- 完整畫質清單（最高 8K）、指定時間範圍、嵌入封面與章節。
- **縮圖、字幕（SRT／VTT／TXT）與截圖**：不需要小幫手。

**觀看工具**
- 深色模式、劇院模式、子母畫面、浮動播放器、A–B 循環
- 鎖定畫質、只播聲音、滑鼠滾輪調音量、切換分頁時暫停、複製含時間的連結

**頁面整理**（設定頁）
- 播放原始語音而非 AI 配音、隱藏片尾卡片、關閉「要繼續觀看嗎？」、Shorts 改用一般播放器等

可以自訂工具列顯示哪些工具與順序。介面提供繁體中文與英文。

## 安裝

### 1. 安裝擴充功能

從 [Releases](https://github.com/chidi0716/yt-toolbar-master/releases/latest) 下載最新檔案。

**Chrome**
1. 把 `yt-toolbar-master-<版本>-chrome.zip` 解壓到一個會保留的資料夾。
2. 開啟 `chrome://extensions`，開啟右上角的「開發人員模式」。
3. 按「載入未封裝項目」，選擇該資料夾。

**Firefox**
1. 開啟 `about:debugging#/runtime/this-firefox`。
2. 按「載入暫時附加元件」，選擇 `yt-toolbar-master-<版本>-firefox-temporary.zip`。

這個測試版在 Firefox 重新啟動後會被移除。

<a id="install-the-helper"></a>
### 2. 設定影片與 MP3 下載

只有下載影片與 MP3 需要。一行指令會在你的使用者資料夾安裝 [yt-dlp](https://github.com/yt-dlp/yt-dlp)、[ffmpeg](https://ffmpeg.org)、[deno](https://deno.com) 與小幫手（macOS 約 150 MB，Windows 約 300 MB），不需要系統管理員權限，之後會自動更新。詳見[會安裝什麼](./docs/what-gets-installed.zh-TW.md)。

**macOS**
1. 按 ⌘＋空白鍵，輸入「終端機」並按 Enter。
2. 貼上這行並按 Enter：
   ```bash
   curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh
   ```
3. 看到「完成」後回到瀏覽器，再點一次「影片」或「MP3」。

**Windows**
1. 按開始鍵，輸入「PowerShell」並開啟。
2. 貼上這行並按 Enter：
   ```powershell
   irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex
   ```
3. 看到「完成」後回到瀏覽器，再點一次「影片」或「MP3」。

影片與 MP3 面板也會顯示同一行指令與「複製」按鈕。

### 更新

- **Chrome**：把新版本解壓覆蓋同一個資料夾，再到 `chrome://extensions` 按「重新載入」。有新版本時，工具列下方會出現提醒。
- **下載功能**：會自動更新。

### 移除

設定頁 →「下載」→「移除下載功能」。已下載的檔案會保留。

## 常見問題

**面板仍顯示找不到小幫手。** 重新啟動瀏覽器，再按「重新檢查」。

**出現「請更新 yt-dlp」。** 小幫手會自動更新 yt-dlp 並重試。仍然失敗時，在面板按「更新 yt-dlp」。

**哪些影片無法下載？** 會員限定、私人與需要登入的影片。

## 隱私

- 不做任何分析或追蹤。擴充功能只連 YouTube 與本機的小幫手，另外每天最多一次向本專案 GitHub 查詢新版本（可以關閉）。
- 所有處理都在你的電腦上進行。

## 更多

- [開發、手動安裝與發佈](./docs/development.zh-TW.md)
- [規格文件](./specs/)
- 只下載你有權下載的內容。YouTube 服務條款限制下載。

## 授權

[MIT](./LICENSE)。yt-dlp、ffmpeg 與 deno 依各自的授權，見 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。
