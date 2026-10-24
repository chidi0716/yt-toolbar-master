# 階段 8（甲）：發佈清單、一行指令安裝、自動更新、發佈流程（T40–T43）

日期：2026-10-23　負責：實作方（甲）

## 結構

```
host/
  cmd/yte-host/            install.go（--install、--uninstall）、update.go（--update）
  cmd/yte-release/         維護者與發佈流程的工具：lock-check、manifest、check、zip
  internal/release/        components.json 格式與驗證、允許的下載網址與清單網址（hosts.go）、
                           官方檢查碼解析、版本比較、下載工具
  internal/installer/      --install／--uninstall：下載、核對、解壓、替換、註冊瀏覽器
  internal/updater/        自動更新：update-state.json、24 小時限制、鎖檔、--update 流程
  internal/platform/       layout.go（安裝資料夾、bin/、原生訊息設定檔與登錄機碼位置）、
                           registry_windows.go（golang.org/x/sys/windows/registry）
install/
  bootstrap/install.sh     一行指令（macOS）：下載清單與小幫手、核對 SHA256、執行 --install
  bootstrap/install.ps1    一行指令（Windows）：同上；發佈時轉成純 ASCII（scripts/ps1-ascii.mjs）
  macos/install.sh         手動安裝：yte-host --install --offline
  macos/uninstall.sh       移除（也就是 Release 的 uninstall.sh）
  windows/install.ps1      手動安裝：yte-host.exe --install --offline
  windows/uninstall.ps1    移除（也就是 Release 的 uninstall.ps1，可以 irm | iex）
release/
  components.lock.json     固定的第三方工具版本、網址、SHA256、官方檢查碼網址
  notes-template.md        Release 說明範本（{{version}}、{{tag}}）
  dist/                    npm run release:dry 與發佈流程的輸出（不進版控）
scripts/release.mjs        產生 Release 的所有檔案（--dry 或 --tag）
scripts/ps1-ascii.mjs      PowerShell 腳本轉 ASCII
.github/workflows/release.yml
spikes/stage8/             引導腳本的模擬測試（macOS：假 curl 等；Windows：官方 PowerShell for Linux）
```

## components.json（與 plan 4.9 範例的差異見 Q55）

```json
{
  "schema": 1,
  "version": "0.2.0",
  "helper": {
    "darwin-amd64":  { "url": "https://github.com/chidi0716/yt-toolbar-master/releases/download/v0.2.0/yte-host-darwin-amd64", "sha256": "…" },
    "darwin-arm64":  { … },
    "windows-amd64": { "url": "…/yte-host-windows-amd64.exe", "sha256": "…" }
  },
  "tools": {
    "yt-dlp": { "version": "2026.10.21", "platforms": { "darwin-arm64": { "files": [ { "url": "…/yt-dlp_macos", "sha256": "…", "name": "yt-dlp" } ] }, … } },
    "deno":   { "version": "2.9.8", "platforms": { "darwin-arm64": { "files": [ { "url": "…/deno-aarch64-apple-darwin.zip", "sha256": "…", "archive": "zip", "extract": ["deno"] } ] }, … } },
    "ffmpeg": { "version": "9.0.2", "platforms": {
      "darwin-arm64":  { "files": [ { "url": "…/ffmpeg.zip", …, "extract": ["ffmpeg"] }, { "url": "…/ffprobe.zip", …, "extract": ["ffprobe"] } ] },
      "windows-amd64": { "version": "N-127043-g5a54fcf75e", "files": [ { "url": "…-win64-gpl.zip", …, "extract": ["ffmpeg.exe", "ffprobe.exe"] } ] } } }
  }
}
```

- 鍵依字母排序、兩格縮排、結尾換行（Go `json.MarshalIndent`）。引導腳本以文字比對取出小幫手的 SHA256，所以格式必須固定。
- **不使用自己的簽章**（008 FR-51，T49 移除原本自己的簽章與內建公鑰）：清單只從本專案 GitHub 以 HTTPS 取得（`release.AllowedManifestURL`：第一個網址與每一次轉址都只能是 `github.com/chidi0716/yt-toolbar-master/releases/` 或 GitHub 的檔案主機），每個檔案核對清單中的 SHA256，repo 開啟「不可變更版本」。
- 驗證（`release.ParseManifest`）：不認得的欄位、缺少的平台或工具、不是 64 位小寫十六進位的 SHA256、不在允許清單的網址、`/latest/` 網址、不符合預期的執行檔名稱都拒絕。
- 允許的網址（`release/hosts.go`）：`github.com` 的本專案、`yt-dlp/yt-dlp`、`denoland/deno`、`yt-dlp/FFmpeg-Builds`、`BtbN/FFmpeg-Builds` 的 `/releases/`；`ffmpeg.martin-riedl.de/download/`；GitHub 的轉址目的地 `objects.githubusercontent.com`、`release-assets.githubusercontent.com`。只允許 https，每一次轉址都重新檢查。測試掃描 `host/` 的 Go 原始碼與 `install/bootstrap/`，確認沒有其他網域（YouTube 只出現在交給 yt-dlp 的影片網址）。

## 安裝資料夾

| | macOS | Windows |
|---|---|---|
| 安裝資料夾 | `~/Library/Application Support/youtube-extension-host/` | `%LOCALAPPDATA%\youtube-extension-host\` |
| 小幫手 | `yte-host` | `yte-host.exe` |
| 工具 | `bin/yt-dlp`、`bin/deno`、`bin/ffmpeg`、`bin/ffprobe` | `bin\*.exe` |
| 狀態 | `install-state.json`（各工具依哪個清單版本安裝）、`update-state.json`、`update.lock`、`state/jobs/` | 同左 |
| 記錄檔 | `~/Library/Logs/youtube-extension-host/host.log`（--update 的記錄以 `update` 標示） | `logs\host.log` |
| 註冊 | `~/Library/Application Support/{Google/Chrome,Mozilla}/NativeMessagingHosts/com.chidi0716.youtube_extension.json` | 安裝資料夾中的 `….chrome.json`、`….firefox.json`，加上 `HKCU\Software\{Google\Chrome,Mozilla}\NativeMessagingHosts\com.chidi0716.youtube_extension` |

Linux（只供開發與測試）：`$XDG_STATE_HOME`（或 `~/.local/state`）`/youtube-extension-host/`，註冊在 `~/.config/google-chrome/NativeMessagingHosts/` 與 `~/.mozilla/native-messaging-hosts/`。

工具尋找順序（`ytdlp.Env.Find`）：安裝資料夾 `bin/` → PATH → `/opt/homebrew/bin`、`/usr/local/bin`（macOS）→ WinGet（Windows）。

## yte-host --install

1. 檢查清單（`--manifest` 的檔案，或以 HTTPS 從本專案 GitHub 的 `releases/latest/download/` 下載）：格式錯誤、網址不在允許清單、清單網址或轉址不是本專案 GitHub 時為 `MANIFEST_INVALID`，不下載任何東西。
2. 小幫手：安裝資料夾中的檔案 SHA256 已與清單相同就略過；目前執行的小幫手（引導腳本剛核對過的）與清單相同就複製自己，否則從清單網址下載並核對。
3. yt-dlp：已存在就略過（之後由 `yt-dlp -U` 自己更新）。
4. deno：已存在且 `install-state.json` 記錄的版本與清單相同就略過。
5. ffmpeg、ffprobe：安裝資料夾中沒有、但系統上兩者都找得到（Homebrew、winget、PATH）就沿用；否則同 deno。
6. 註冊 Chrome 與 Firefox（Windows 另寫登錄機碼）。
- 下載到 `bin/.download-<隨機>/`，核對 SHA256，zip 只依檔名取出需要的檔案（含 `..`、絕對路徑、磁碟代號或不是一般檔案的項目一律略過），全部成功後才逐一改名放入；Windows 先把舊檔改名為 `.old`。失敗時 `bin/` 不變、暫存資料夾刪除。每次啟動刪除 `.old` 與一小時以上的 `.download-*`。
- 輸出逐步的中英文說明與來源網址；失敗時印出原因（依錯誤代碼）與「再執行一次同一個指令即可從這裡繼續」，結束代碼 1。
- macOS 上以 root 執行時拒絕（引導腳本也會先拒絕）。
- `--install --offline`：只把自己複製到安裝資料夾並註冊，列出找到／缺少的 yt-dlp、ffmpeg、ffprobe、deno。

## yte-host --uninstall [--delay N]

刪除註冊（設定檔與登錄機碼）、安裝資料夾、macOS 的記錄檔資料夾；刪除失敗時重試最多 2 分鐘。Windows 上從安裝資料夾執行時，先把自己複製到 `%TEMP%\yte-uninstall-<時間>.exe` 並以分離的方式執行複本（執行中的檔案無法刪除），複本留在暫存資料夾（Q59）。

## 自動更新（yte-host --update）

- `download` 成功建立工作後，若版本是 x.y.z（開發版不更新）、自動更新開啟、距 `lastCheck` 超過 24 小時（或時鐘被往回調超過一小時），且沒有其他 `--update` 在執行，就以分離的方式啟動 `--update`。`checkUpdates` 不受 24 小時限制。
- 流程：鎖檔（`update.lock`，內容為 PID；程序已不在的鎖檔會被取代）→ 從 `releases/latest/download/` 下載並驗證清單 → 每 10 秒檢查一次進行中的下載，最多 6 小時 → 安裝資料夾中的 yt-dlp 執行 `yt-dlp -U` → deno、ffmpeg（只限安裝資料夾中已有的）版本與清單不同時替換 → 清單版本比自己新、且自己就是安裝資料夾中的小幫手時替換小幫手 → 寫入 `update-state.json`。任何一個元件失敗時繼續處理其他元件，結果為 `failed`。
- `update-state.json`：`auto`（省略時為開啟）、`lastCheck`、`lastResult`（`ok`／`updated`／`failed`）、`consecutiveFailures`（成功時歸零）、`lastError`（只有錯誤代碼）、`updated`（最近更新的元件）。

## 通訊協定的新增部分（給擴充功能端，plan 4.9）

`status` 新增：

```json
"installDir": "/Users/me/Library/Application Support/youtube-extension-host",
"components": [
  {"name": "helper",  "version": "0.2.0",      "path": "…/yte-host",   "source": "bundled", "found": true},
  {"name": "yt-dlp",  "version": "2026.10.21", "path": "…/bin/yt-dlp", "source": "bundled", "found": true},
  {"name": "deno",    "version": "2.9.8",      "path": "…",            "source": "bundled", "found": true},
  {"name": "ffmpeg",  "version": "8.0",        "path": "/opt/homebrew/bin/ffmpeg", "source": "homebrew", "found": true},
  {"name": "ffprobe", "version": "",           "path": "",             "source": "",        "found": false}
],
"update": {"auto": true, "lastCheck": "2026-10-23T12:00:00Z", "lastResult": "ok", "consecutiveFailures": 0, "running": false}
```

- `components` 一律依 helper、yt-dlp、deno、ffmpeg、ffprobe 的順序列出五項；找不到時 `found: false`，其他欄位為空字串（`found` 是 plan 之外多加的欄位）。`source`：`bundled`（安裝資料夾）、`homebrew`、`winget`、`path`。helper 從安裝資料夾執行時為 `bundled`，否則為 `path`。
- `update.lastCheck`、`update.lastResult` 沒有檢查過時為 `null`；`running` 表示 `--update` 正在執行。
- 原本的欄位（`ready`、`complete`、`ytDlp`、`ffmpeg`、`deno`、`missing`、`installCommand`…）不變。

| 指令 | 參數 | 結果 |
|---|---|---|
| `setAutoUpdate` | `enabled`（布林，必要；其他型別或多餘欄位為 `INVALID_ARGS`） | `{"auto": <enabled>}` |
| `checkUpdates` | — | `{"started": true}`；已經在執行時 `{"started": false}` |
| `uninstall` | — | `{"ok": true}`（2 秒後由分離的程序刪除）；有進行中的下載時錯誤 `JOBS_RUNNING` |

新錯誤代碼：`JOBS_RUNNING`、`MANIFEST_INVALID`（T49 前為 `SIGNATURE_INVALID`）、`CHECKSUM_MISMATCH`（後兩者出現在 `--install` 的輸出與 `update-state.json` 的 `lastError`）。

008 FR-22：下載遇到 `YTDLP_OUTDATED` 或 `VERIFICATION_REQUIRED`，且 yt-dlp 在安裝資料夾中時，執行下載的程序執行 `yt-dlp -U`（同一個工作只試一次），期間送出

```json
{"event": "progress", "jobId": "…", "videoId": "…", "kind": "video", "state": "downloading", "stage": "updating-ytdlp"}
```

（沒有 `percent`）。更新到新版本後重新下載一次（之後的進度事件沒有 `stage`）；已是最新或更新失敗時回報原本的錯誤。使用者自己安裝的 yt-dlp 不會被自動更新。

## 發佈流程（plan 4.10）

`node scripts/release.mjs --tag vX.Y.Z`（GitHub Actions）與 `npm run release:dry`：

1. 測試（`npm test`、`npm run compile`、`go test ./...`；Actions 中在前面的步驟執行）。
2. `yte-release lock-check`：正式發佈加 `-download`，下載每個第三方檔案，與 lock 的 SHA256 及官方檢查碼比對。
3. 建置三種小幫手與手動安裝的 zip。
4. 產生 `components.json` 並以 `yte-release check` 再檢查一次。
5. 引導腳本與移除腳本：代入版本標籤（`@RELEASE_TAG@`）；`.ps1` 轉成純 ASCII。
6. 擴充功能：Chrome zip；Firefox 先以 `web-ext lint --self-hosted` 檢查。有 Mozilla 金鑰（Actions 把 `AMO_JWT_ISSUER`、`AMO_JWT_SECRET` 傳成 `WEB_EXT_API_KEY`、`WEB_EXT_API_SECRET`）、不是預先發行版本、也不是試跑時，以 `scripts/sign-firefox.mjs` 送 Mozilla 簽署並附 `.xpi`；否則附未簽署的 `yt-toolbar-master-<版本>-firefox-temporary.zip`（008 FR-52）。
7. `updates.json`：只在有簽署的 `.xpi` 時附上；版本取自建置出的 Firefox manifest，`update_link` 指向這個版本的 `.xpi`，附 `update_hash`（sha256）與 `applications.gecko.strict_min_version`。試跑時寫到 `release/dist/updates.preview.json`（不附加）。
8. `release-notes.md`（範本中的 `{{firefoxSteps}}`、`{{firefoxStepsZh}}`、`{{firefoxFiles}}` 依是否簽署代入不同的說明）與 `SHA256SUMS`。
- Actions 以 `gh release create <tag> release/dist/upload/* --notes-file … --verify-tag` 建立 Release；標籤含 `-` 時加 `--prerelease`。

## 驗證紀錄

- `cd host && go vet ./... && go test ./...`（另以 `GOOS=windows`、`GOOS=darwin` 執行 `go vet`）：全部通過；`go test -race` 對 release、installer、updater、jobs、app 通過。
  - release：清單只接受本專案 GitHub 的網址（`AllowedManifestURL`）、清單欄位缺漏與不合法（24 種）、允許與拒絕的網址、官方檢查碼的各種格式、版本比較（`0.10.0 > 0.9.0`）、repo 的 lock 檔、`BuildManifest`、lock 與官方檢查碼及實際檔案不符、轉址到不允許的網域。
  - installer（本機 TLS 假伺服器）：全新安裝、重複執行全部略過且不再下載、清單版本改變時只重新下載 deno、複製自己、中途失敗（NETWORK）後再執行從失敗處繼續、SHA256 不符時保留舊版本、竄改的小幫手不安裝、格式不正確的清單完全不下載（`MANIFEST_INVALID`）、從 latest 下載清單、清單轉址到不允許的位置時拒絕、系統已有 ffmpeg 時跳過、zip 路徑穿越、Windows 的 `.old` 替換與清理、手動安裝與移除（已下載的影片保留）、設定檔與 `install/manifests/` 範本相同。
  - updater：24 小時判斷、鎖檔、等到下載結束才替換、只更新安裝資料夾中的元件、自我更新、開發版不更新、連續失敗次數、等待逾時。
  - jobs：`outdated-once`、`bot-once` 情境（假 yt-dlp 在 `-U` 前回報過舊或要求驗證）更新後重試成功並送出 `stage`；已是最新、更新失敗、更新後仍失敗、其他錯誤都不重試。
  - e2e（真正的 yte-host）：`--install --offline`、非法參數、Linux 上 `--install` 回報不支援、`--uninstall`；經由原生訊息的 `status` 新欄位、`setAutoUpdate`、`checkUpdates`、`uninstall`（2 秒後安裝資料夾被刪除）。
- `bash spikes/stage8/test-bootstrap-macos.sh`：以假 curl、uname、sysctl、id、shasum 執行引導腳本：Apple Silicon 與 Intel 選對小幫手、以正確參數執行 `--install`、竄改的小幫手不執行、下載失敗時說明、拒絕 root 與非 macOS、沒有版本標籤時停止、`curl … | sh` 方式也可以、暫存資料夾刪除。
- `bash spikes/stage3/check-ps1.sh`（官方 PowerShell 7.4.6 for Linux）：三個 `.ps1` 語法正確。
- `bash spikes/stage8/test-bootstrap-windows.sh`：把發佈版 `install.ps1` 以 Latin-1 解碼後 `Invoke-Expression`（模擬 Windows PowerShell 5.1 的 `irm | iex`），`Invoke-WebRequest` 換成本機檔案：中文訊息正確還原、核對 SHA256 後以正確參數執行小幫手、竄改時停止、下載失敗時說明、沒有版本標籤時停止，且腳本結束後 PowerShell 仍在執行（沒有呼叫 `exit`）。
- `npm run release:dry`：成功，輸出 13 個檔案（未簽署的 Firefox 套件、沒有 `updates.json`）；`SHA256SUMS` 正確；`web-ext lint --self-hosted` 0 個錯誤。
- T50：以去掉 `-download` 的副本在本機執行 `node scripts/release.mjs --tag v0.1.0 --skip-tests`（沒有 Mozilla 金鑰）：流程完成，附 `-firefox-temporary.zip`、沒有 `updates.json`，Release 說明為未簽署的版本。
- 無法在容器中驗證的部分列在 `specs/e2e-checklist.md` 第 10 節。

## 其他

- `spikes/stage3/test-install-macos.sh`（階段 3 的手動安裝模擬）以 Linux 版小幫手代替 darwin 版；改為 `--install --offline` 後，Linux 版會寫到 Linux 的開發位置，這個舊模擬不再適用，由 `internal/e2e/install_test.go` 與 `spikes/stage8/` 取代。
