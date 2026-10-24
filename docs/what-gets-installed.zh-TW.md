# 下載功能會安裝什麼

[English](./what-gets-installed.md) | **繁體中文**

擴充功能的影片與 MP3 下載需要在你的電腦上安裝幾個程式。這一頁用白話說明一行安裝指令會在電腦上放什麼、放在哪裡、會連到哪裡，以及如何移除。

## 重點

- 四個程式，約 150 MB（Windows 約 300 MB，因為 Windows 版的 ffmpeg 比較大）。
- 全部放在**你帳號下的一個資料夾**。不需要系統管理員密碼，不修改系統設定，也不修改 `PATH`。
- 你自己安裝的程式（例如以 Homebrew 或 winget 安裝的）不會被修改。
- 不收集任何關於你或你下載內容的資料，也不會送到任何地方。
- 可以在設定頁一鍵移除全部。

## 安裝的程式

| 程式 | 用途 | 來源 |
|---|---|---|
| **小幫手**（`yte-host`） | 本專案的小程式，讓瀏覽器擴充功能能使用下面的程式。只接受本擴充功能的固定指令，不接受網址或任意命令。 | [本專案的 GitHub 正式版本](https://github.com/chidi0716/yt-toolbar-master/releases) |
| **yt-dlp** | 實際從 YouTube 下載影片與音訊的開源程式。 | [yt-dlp 的 GitHub](https://github.com/yt-dlp/yt-dlp/releases)（官方正式版本） |
| **ffmpeg** 與 **ffprobe** | 合併影像與聲音、把聲音轉成 MP3、嵌入封面與章節。 | macOS：[ffmpeg.martin-riedl.de](https://ffmpeg.martin-riedl.de)；Windows：[yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds/releases)（yt-dlp 團隊維護） |
| **deno** | yt-dlp 需要的 JavaScript 執行環境，讓它看得到 YouTube 的全部格式。 | [deno 的 GitHub](https://github.com/denoland/deno/releases)（官方正式版本） |

電腦上已經有 ffmpeg 與 ffprobe 時，安裝程式會沿用，不另外下載。

## 如何確認下載的檔案

- 本專案的每個版本都附有一份清單（`components.json`），列出要安裝的確切檔案與 SHA-256 檢查碼。小幫手只接受以 HTTPS 從本專案 GitHub 正式版本取得的清單；格式不正確或指向上述來源以外的清單一律拒絕。
- 本專案在 GitHub 的版本設為**不可變更**：版本發佈後，檔案（包括清單）不能再被修改或替換。
- 每個下載的檔案都必須符合清單中的檢查碼。發佈新版本前，發佈流程會下載每個檔案，與 yt-dlp、deno 或 ffmpeg 建置網站公布的檢查碼比對。
- 任何不符的檔案都會被刪除，並保留舊版本。

## 放在哪裡

| | macOS | Windows |
|---|---|---|
| 小幫手、工具、設定 | `~/Library/Application Support/youtube-extension-host/` | `%LOCALAPPDATA%\youtube-extension-host\` |
| 記錄檔 | `~/Library/Logs/youtube-extension-host/host.log` | `%LOCALAPPDATA%\youtube-extension-host\logs\host.log` |
| 瀏覽器註冊 | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` 與 `~/Library/Application Support/Mozilla/NativeMessagingHosts/`（各一個小檔案） | `HKCU\Software\Google\Chrome\NativeMessagingHosts\` 與 `HKCU\Software\Mozilla\NativeMessagingHosts\` 下的兩個登錄機碼 |

瀏覽器註冊告訴 Chrome 與 Firefox（以及 Zen 等以 Firefox 為基礎的瀏覽器）小幫手在哪裡，並限定**只有本擴充功能**能啟動它。

記錄檔只記錄指令名稱與錯誤訊息（不含 cookie、密碼或帳號資訊），大小上限 5 MB。

## 會連到哪裡、什麼時候

| 誰 | 連到 | 什麼時候 |
|---|---|---|
| 安裝指令 | 本專案的 GitHub 正式版本；上面列出的 yt-dlp、deno、ffmpeg 來源（GitHub 的版本檔案由 `objects.githubusercontent.com`／`release-assets.githubusercontent.com` 提供） | 只在你執行時 |
| 小幫手 | 同上，用來檢查與下載更新 | 你開始下載時，每天最多一次（可以關閉） |
| yt-dlp | YouTube（下載你要的影片）；GitHub（yt-dlp 自我更新時） | 下載時 |
| 擴充功能 | 只連 YouTube。以「載入未封裝項目」（Chrome）或臨時附加元件載入時，另外會向本專案的 GitHub 查詢最新版本號，每天最多一次，不送出任何識別資訊 | 開啟 YouTube 影片時 |

不會連到其他伺服器。沒有任何分析、追蹤或遙測。影片只在你的電腦上處理，不會上傳到任何地方。

## 更新

- yt-dlp、deno 與小幫手只在你開始下載時於背景自動更新，每天最多一次。不會延遲這次下載；檔案在下載結束後才替換，出錯時保留舊版本。
- YouTube 改版、yt-dlp 過舊導致下載失敗時，小幫手會立即更新 yt-dlp 並重試一次。
- ffmpeg 不自動更新；小幫手的新版本可以附帶較新的 ffmpeg。
- 設定頁的「下載」區會顯示各程式的版本與來源、最近一次檢查更新的時間與結果，並可以關閉自動更新或立即檢查。

## 如何移除

- **從擴充功能**：設定頁 →「下載」→「移除下載功能」。會刪除上面的資料夾（小幫手、yt-dlp、deno、ffmpeg、記錄檔）與瀏覽器註冊。
- **擴充功能已經移除時**：
  - macOS（終端機）：`curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.sh | sh`
  - Windows（PowerShell）：`irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.ps1 | iex`

已下載的影片與 MP3 不會被刪除，你自己安裝的程式也不會被動到。

## 授權

本專案採用 [MIT 授權](../LICENSE)。yt-dlp、deno 與 ffmpeg 是各自獨立的程式，有自己的授權，見 [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)。
