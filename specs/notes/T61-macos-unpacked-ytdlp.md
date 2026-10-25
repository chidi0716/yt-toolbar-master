# 階段 12：macOS 的 yt-dlp 改用未封裝版本（T61）

日期：2026-10-25　負責：實作方

008 FR-15a、FR-15b、FR-20、FR-22。取代 `T40-T43-install-and-release.md` 中 macOS yt-dlp 的部分（`bin/yt-dlp` 單一執行檔、`yt-dlp -U`）。

## 官方檔案（實際下載確認）

- `https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp_macos.zip`：53,879,210 位元組，SHA256 `2b5251788b36fcbc476568b4eea8cb239f0a775759456f2ff9344a437c52f000`，與同一個版本的 `SHA2-256SUMS` 相同（`ytm-release lock-check -online` 通過）。
- 162 個項目：根目錄的 `yt-dlp_macos`（755）與 `_internal/`（27 個資料夾、161 個檔案，其中 107 個 755），解壓後 128,816,219 位元組。
- **這個版本的 zip 沒有符號連結**：`_internal/Python.framework/` 中 `Versions/Current/`、`Python`、`Resources/` 都是實際的資料夾與檔案（內容重複）。符號連結的處理仍依 T61 實作，以測試用的 zip 驗證。

## 清單格式（與 v0.1.0 相容）

lock 檔與 `components.json` 的 macOS yt-dlp：

```json
{ "url": "…/2026.10.21/yt-dlp_macos.zip", "sha256": "2b52…", "archive": "zip", "extract": ["yt-dlp"] }
```

- `release.UnpackedExe("yt-dlp", "darwin-*")` 回傳 `yt-dlp_macos`：這個工具的 zip 整個解壓到 `bin/<extract[0]>/`，執行檔為 `bin/yt-dlp/yt-dlp_macos`。驗證要求 macOS 的 yt-dlp 只有一個 zip。
- 沒有新增欄位或 `archive` 種類：v0.1.0 的小幫手以 `DisallowUnknownFields` 與固定的檔名規則檢查清單，它只要求 `extract` 是 `yt-dlp`。用這個寫法，v0.1.0 的自動更新才讀得懂 v0.1.1 的 `components.json` 並更新小幫手（`TestRepoLockFile` 檢查這個形式）。v0.1.0 的自動更新不會從清單安裝 yt-dlp（只執行 `yt-dlp -U`），所以不會誤用這個 zip。

## 解壓（`installer.ExtractTree`）

- 先建立資料夾與一般檔案，最後才建立符號連結，寫入檔案時路徑中沒有符號連結。
- 任何一個項目不安全就整個失敗（不是略過）：絕對路徑、`..`、多餘的 `.` 或 `/`、反斜線、磁碟代號；指向絕對路徑或解析後在資料夾以外的符號連結；所在資料夾不是實際資料夾（經過另一個符號連結）的符號連結；裝置、具名管道等其他類型；重複的項目。
- 權限：原本有任何執行位元的檔案為 755，其他 644；資料夾 755。
- 上限：5,000 個項目、解壓後總共 1 GiB、單一檔案 1 GiB、連結目標 1 KiB。

## 放入與替換

- 下載到 `bin/.download-<隨機>/`，核對 SHA256、解壓成 `out/yt-dlp/`、確認 `yt-dlp_macos` 是一般檔案、遞迴移除隔離屬性，再以 `ReplaceDir` 放入：舊的 `bin/yt-dlp`（資料夾，或 v0.1.0 的單一執行檔）先改名為 `bin/yt-dlp.old-<隨機>`，新資料夾改名進來後刪除舊的；失敗時改回。`CleanupOld` 改為 `RemoveAll`，也刪除留下的 `.old-*` 資料夾。
- `install-state.json` 新增 `archives`：`{"yt-dlp": "<目前安裝的 yt-dlp_macos.zip 的 SHA256>"}`（舊版本讀取時忽略）。

## 隔離屬性（FR-15b）

- `platform.ClearQuarantine`（只在 macOS 編譯，`golang.org/x/sys/unix.Lremovexattr`）：遞迴、不跟隨符號連結、個別失敗略過。取代原本對單一檔案執行 `/usr/bin/xattr -d`。
- 呼叫時機：每個工具放入 `bin/` 之前（yt-dlp 是整個資料夾）；小幫手；`--install`、`--install --offline`、`--update` 結束前，以及下載中與按鈕觸發的 yt-dlp 更新之後，整個安裝資料夾再處理一次。
- 安裝程式透過可替換的 `removeQuarantine` 呼叫，測試以 macOS 的 Layout 確認呼叫的位置；非 macOS 不呼叫。

## 尋找工具

- macOS：安裝資料夾中的 yt-dlp 只認 `bin/yt-dlp/yt-dlp_macos`。v0.1.0 的單一執行檔 `bin/yt-dlp` **不使用**（由瀏覽器啟動時會跳出「Python.framework 已損毀」），接著找 PATH、Homebrew；`IsBundled`、`Source` 認得新位置。
- Windows 與 Linux（開發用）不變。

## 更新（`Installer.UpdateMacYtDlp`）

1. 安裝資料夾中沒有 yt-dlp（未封裝版本或舊的單一執行檔都沒有）：不做任何事、不連網。
2. 取得 `https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS`，找出 `yt-dlp_macos.zip` 的 SHA256。
3. 與 `install-state.json` 的 `archives.yt-dlp` 相同、而且不是舊的單一執行檔：已是最新，結束。`SHA2-256SUMS` 沒有版本號，所以以「檢查碼與目前安裝的不同」判斷 latest 是新版本（Q77）。
4. 否則下載 `…/releases/latest/download/yt-dlp_macos.zip`，核對、解壓、整個替換，更新 `archives`（並刪除 `tools.yt-dlp` 的清單版本）。任何一步失敗都保留舊版。
- 允許的網址：`release.AllowedURL` 的 `/releases/latest/` 只接受 `latestURLs`（本專案的 `components.json`，yt-dlp 的 `SHA2-256SUMS` 與 `yt-dlp_macos.zip`）；轉址到 `releases/download/<版本>/` 與 GitHub 的檔案主機照常檢查。以正式的 Fetcher 實際取得 latest 的 `SHA2-256SUMS` 與 zip，轉址都在允許範圍內、檢查碼相符。
- 使用的地方：
  - `--update`（Layout 為 macOS 時取代 `yt-dlp -U`；其他系統不變）。
  - 下載中的立即更新（FR-22，`--run-job`）與擴充功能的「更新 yt-dlp」（`updateYtDlp` 指令，時限 5 分鐘）：持有 `update.lock`，`--update` 正在執行時回傳 `BUSY`（Q78）。

## 從 v0.1.0 升級

- **重新執行安裝指令**：`bin/yt-dlp/yt-dlp_macos` 不存在就從清單安裝未封裝版本（取代舊的單一執行檔）；已存在就「已安裝，略過（之後自動更新）」。
- **自動更新**：v0.1.0 的 `--update` 讀新清單、更新小幫手（過程中仍會對舊的單一執行檔執行一次 `yt-dlp -U`）。之後的 v0.1.1 小幫手因為不使用舊檔，status 回報找不到 yt-dlp、不會開始下載，因此改由 **status** 觸發：macOS、安裝資料夾中是舊的單一執行檔、版本為 x.y.z、自動更新開啟、沒有 `--update` 在執行、上一次更新不是在 10 分鐘內失敗（`updater.ShouldMigrate`）時，啟動分離的 `--update`，其中的 `UpdateMacYtDlp` 一律改裝未封裝版本（Q76）。
- 自動更新關閉時不會自動改裝；面板依 status 顯示缺少 yt-dlp，照說明重新執行安裝指令即可。

## 驗證紀錄

- `cd host && GOTOOLCHAIN=local go test -count=1 ./...`、`go vet ./...`（另以 `GOOS=darwin`、`GOOS=windows`）通過；`go test -race` 對 installer、updater、app 通過。新增或修改的測試：
  - release：清單中 macOS yt-dlp 必須是一個 zip（單一執行檔、其他 `extract` 名稱、兩個檔案都拒絕）；`latest` 只允許三個網址；repo 的 lock 檔是 v0.1.0 也接受的形式。
  - installer：全新安裝後 `bin/yt-dlp/` 保留執行權限與 framework 的符號連結；取代 v0.1.0 的單一執行檔且不留 `.old`；隔離屬性在 macOS 上的處理位置、非 macOS 不處理；`ExtractTree` 拒絕 18 種不安全的 zip 且不寫到資料夾以外、項目過多；`UpdateMacYtDlp` 已是最新只下載 `SHA2-256SUMS`、新版本整個替換、竄改的 zip、不安全的 zip、缺少 `yt-dlp_macos`、`SHA2-256SUMS` 缺少項目、連不上都保留舊版；舊的單一執行檔即使檢查碼相同也改裝、下載失敗時保留舊檔；沒有安裝資料夾中的 yt-dlp 時不連網；`ReplaceDir` 與 `.old-*` 資料夾的清理。
  - updater：macOS 從 latest 更新 yt-dlp、不呼叫 `yt-dlp -U`、等到下載結束才替換；舊的單一執行檔在 `--update` 中改裝，失敗時其他元件照常、舊檔保留；macOS 以外仍使用 `yt-dlp -U` 且不連到 yt-dlp 的 latest；`ShouldMigrate`。
  - ytdlp：macOS 找 `bin/yt-dlp/yt-dlp_macos`、不使用舊的單一執行檔、`IsBundled` 的範圍。
  - app：status 觸發改裝的條件（自動更新關閉、開發版、已是未封裝版本、非 macOS、10 分鐘內失敗都不觸發）；`updateYtDlp` 在 macOS 使用小幫手的更新並回報版本。
  - cmd：下載中的立即更新只用於安裝資料夾中的 yt-dlp，macOS 使用小幫手的更新。
- 以實際的 `yt-dlp_macos.zip`（2026.10.21）執行 `ExtractTree`：163 個項目（含根資料夾）、128,816,219 位元組、107 個執行檔，`yt-dlp_macos` 為 755。
- `npm test`、`npm run compile`、`npm run build:host`、`npm run release:dry`（`components.json` 的 macOS yt-dlp 為上述形式）、`spikes/stage4/e2e-test.mjs`（83/83）通過。
- 無法在容器中驗證的部分列在 `specs/e2e-checklist.md` 第 10.6 節。
