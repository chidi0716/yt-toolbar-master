# ffmpeg 的下載來源（T40，plan 4.9）

日期：2026-10-23　負責：實作方（甲）

ffmpeg 與 ffprobe 由一行指令安裝時下載（系統上已有可用的 ffmpeg 與 ffprobe 時跳過）。本專案不轉存第三方檔案，`release/components.lock.json` 只記錄固定版本的官方網址、SHA256 與官方公布檢查碼的網址；發佈流程以 `ytm-release lock-check -download` 下載每個檔案並與兩者比對。

## macOS：Martin Riedl 的 FFmpeg Build Server

- 網站：<https://ffmpeg.martin-riedl.de/>（「Download Release Build」區，不使用 Snapshot）。
- 版本：**9.0.2**（2026-09-20 建置）。
- ffmpeg 與 ffprobe 是**兩個獨立的 zip**，每個 zip 只有一個檔案（根目錄的 `ffmpeg` 或 `ffprobe`，權限 755）：

  | 平台 | 網址 | SHA256（網站公布的 `.sha256`） |
  |---|---|---|
  | darwin-arm64 | `/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip` | `c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924` |
  | darwin-arm64 | `/download/macos/arm64/1789931890_9.0.2/ffprobe.zip` | `fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6` |
  | darwin-amd64 | `/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip` | `7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4` |
  | darwin-amd64 | `/download/macos/amd64/1789931006_9.0.2/ffprobe.zip` | `2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd` |

- 每個檔案旁有 `<檔名>.sha256`（格式：`<hex>  ffmpeg.zip`）。實際下載 `ffprobe.zip`（arm64，28 MB）與 `ffmpeg.zip`（amd64）計算 SHA256，與網站公布的值相同。
- 網址中的數字是建置時間（Unix 秒），不同架構不同，必須從網站的連結取得，不能自己組。
- 網站另有 `/redirect/latest/...` 形式的網址，會隨新版本改變，不使用（plan 4.9）。
- 大小：arm64 的 ffmpeg 與 ffprobe 各約 28 MB（壓縮後）。

## Windows：yt-dlp/FFmpeg-Builds（yt-dlp 官方維護）

- 網站：<https://github.com/yt-dlp/FFmpeg-Builds/releases>。
- 這個專案**沒有** FFmpeg 正式版本分支的建置，只有 master 的每日自動建置：
  - `latest` 標籤的檔名（`ffmpeg-master-latest-win64-gpl.zip`）會變動，不使用；
  - 每次自動建置另有固定標籤 `autobuild-YYYY-MM-DD-HH-MM`，檔名含 FFmpeg 的 git 版本（例如 `ffmpeg-N-127043-g5a54fcf75e-win64-gpl.zip`），這是固定網址。
- **保留期間**：每日建置只保留約兩週，但**每個月最後一天的建置會長期保留**（2026-10-23 查看時仍可看到 2024-11-30 起每月月底的標籤）。因此 lock 檔固定在月底的建置，避免已發佈的 components.json 指向被刪除的檔案。
- 目前固定：`autobuild-2026-09-30-18-57`，檔案 `ffmpeg-N-127043-g5a54fcf75e-win64-gpl.zip`（靜態連結 GPL 版本，約 189 MB），SHA256 `06ecded6224d19eba0c8597971c57ebf8e7614141b5f1adcb3b250dd0ff343c7`（取自同一個 Release 的 `checksums.sha256`）。
- zip 內的結構為 `ffmpeg-N-…-win64-gpl/bin/ffmpeg.exe`、`ffprobe.exe`（另有 `ffplay.exe` 與文件，不取出）。小幫手只依檔名取出 `ffmpeg.exe` 與 `ffprobe.exe`。
- 選靜態版（`-gpl`）而不是共用程式庫版（`-gpl-shared`，約 84 MB）：共用版需要一併放入 `bin/` 中所有的 DLL，取出邏輯較複雜；代價是下載較大（見 QUESTIONS Q53）。
- 備用來源 `github.com/BtbN/FFmpeg-Builds` 有正式版本分支的建置（例如 `ffmpeg-n9.0.2-…-win64-gpl-9.0.zip`），但同樣只有 `autobuild-*` 標籤是固定網址，且保留規則相同。若 yt-dlp/FFmpeg-Builds 停止維護，改用 BtbN 只需要修改 lock 檔（網域已在允許清單中）。

## 更新 lock 檔的方式（維護者）

1. 在上面兩個網站找到新的版本（macOS 用 Release Build；Windows 用某個月底的 `autobuild-*`）。
2. 修改 `release/components.lock.json` 的 `url`、`sha256`（從官方檢查碼檔案複製）、`checksums` 與 `version`（Windows 的 `platforms.windows-amd64.version` 寫 FFmpeg 的 git 版本）。
3. 執行 `cd host && go run ./cmd/ytm-release lock-check -download`，確認官方檢查碼與實際下載的檔案都相符。

ffmpeg 不會自動更新（008 FR-20）；lock 檔中的版本改變後，下一個小幫手版本的自動更新會依清單替換安裝資料夾中的 ffmpeg 與 ffprobe。

## 其他工具（同一個 lock 檔）

- yt-dlp **2026.10.21**：`yt-dlp_macos`（Intel 與 Apple Silicon 共用）、`yt-dlp.exe`，官方 `SHA2-256SUMS`。
- deno **2.9.8**：`deno-aarch64-apple-darwin.zip`、`deno-x86_64-apple-darwin.zip`、`deno-x86_64-pc-windows-msvc.zip`，官方 `<檔名>.sha256sum`。注意 Windows 版的 `.sha256sum` 是 PowerShell `Get-FileHash` 的輸出格式（`Algorithm : SHA256`、`Hash : <大寫十六進位>`、`Path : …`），`release.ParseChecksums` 兩種格式都支援。
- GitHub Release 的檔案會轉址到 `release-assets.githubusercontent.com`（plan 4.9 只列了 `objects.githubusercontent.com`），兩者都列入允許清單（QUESTIONS Q54）。
