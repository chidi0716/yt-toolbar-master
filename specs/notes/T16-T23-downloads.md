# 階段 4：經由橋接程式的下載（T16、T18 至 T23）

日期：2026-10-22　負責：實作方

橋接程式的協定見 [`T11-T15-host.md`](./T11-T15-host.md)；直接下載（縮圖、截圖、字幕）見 [`T17-T21a-T22a-downloads.md`](./T17-T21a-T22a-downloads.md)。

## T16 背景腳本與橋接程式連線

- `utils/native-protocol.ts`：指令、事件、錯誤代碼與各回應的型別；`parseHostMessage`、`parseStatus`、`parseInfo`、`parseJobs`、`parseUpdate`
  只取已知欄位並檢查型別（橋接程式的回應不直接交給畫面）。`status` 依 T15a 讀取 `deno`、`complete`、`missing`（固定順序 yt-dlp、ffmpeg、deno）、`installCommand`。
- `utils/native.ts` 的 `NativeClient`（有單元測試）：`connectNative('com.chidi0716.youtube_extension')`，請求 ID 與回應配對、每種指令各自的逾時
  （status 45 秒、getInfo 100 秒、pickFolder 30 分鐘、updateYtDlp 6 分鐘等）、事件轉給背景腳本；連線中斷時等待中的請求以 `HOST_UNREACHABLE` 失敗，
  有進行中的下載時自動重連（1、2、4、8、16、30 秒）。
- `features/downloads/host-background.ts`：
  - `status` 暫存 60 秒（「重新檢查」不使用暫存），`getInfo` 依影片 ID 暫存 30 分鐘、最多 30 部（002 NFR-2：影片、MP3、字幕面板共用）。
  - 下載工作清單存在 `storage.session`，每次改變推播（`tabs.sendMessage`，不需要 tabs 權限）給曾經查詢過工作的分頁；分頁關閉後自動移除。
  - `download` 的參數由背景腳本組出（`downloadArgs`，有單元測試）：只帶該種類允許的欄位，補上下載資料夾（設定值或 `status.defaultDir`）、
    檔名格式（必須在 `status.namePresets` 中，否則 `title-id`）與嵌入資訊（影片、MP3）。
  - 完成與失敗時建立通知（`yte-job:<jobId>`，標題「下載完成」／「下載失敗」，內容為檔名或標題與原因）；取消不通知。
    點完成的通知送出 `reveal`（002 FR-5）。
  - 連線後先送 `jobs`：合併橋接程式的狀態，對 `missed` 的工作補發通知，清單中進行中但橋接程式不知道的工作標為 `INTERRUPTED`。
  - 瀏覽器重新啟動：以 `local:hostJobsUnfinished` 記錄還有沒看到結束的下載，背景腳本啟動時連線一次補發通知（QUESTIONS Q44）。
  - 沒有進行中的下載與等待中的請求 60 秒後關閉連線（Q45）。
- 內容腳本端（`features/downloads/host-client.ts`）只透過背景腳本使用橋接程式；訊息在 `utils/messages.ts` 驗證（有單元測試）：
  影片 ID、格式 ID（與橋接程式相同的規則）、容器、位元率白名單、整數的時間範圍、字幕語言與格式、工作 ID。
- 取代 T22a 一律「無法連線」的檢查：面板以 `hostStatus` 判斷，四個元件（橋接程式、yt-dlp、ffmpeg、deno）各自顯示狀態與版本。
  - 無法連線：列出四項、安裝指令（`brew install yt-dlp ffmpeg deno`／`winget install …`）與安裝腳本的指令、README 連結、「重新檢查」。
  - 已連線但缺 yt-dlp 或 ffmpeg（`ready: false`）：標題改為「缺少部分下載工具」，指令使用橋接程式回報的 `installCommand`，不顯示安裝腳本。
  - 只缺 deno（`ready: true`、`complete: false`）：可以下載，面板上方顯示建議安裝 deno 的提示與指令。

## T18 畫質清單（`utils/format-list.ts`）

依 plan 3.8 與 002 FR-10 至 FR-13（有單元測試，含舊影片只有合併格式、直式影片、8K／HDR、大小未知、沒有聲音可搭配、格式 ID 不合法等範例）：

- 只有影像的格式搭配最佳聲音：MP4 組只用 H.264（`avc1`）搭配非 DRC 的 M4A；其他格式組（WEBM）用 VP9／AV1 搭配 Opus；已含聲音的格式直接列出。
- 依容器、解析度（直式影片以短邊）、幀率（> 30 時標示，例如 1080p60）、HDR 分組，同組取已含聲音者優先、其次位元率較高者。
- 由高到低排列，同解析度 MP4 在前；畫質標籤 4K／8K／2K／1080／HD。
- 大小為影像加聲音；任一方只有估計值時加「約」（英文為「~」）；未知時「—」。時間範圍不是整部影片時依比例估算並加「約」。
- 2K 以上沒有 H.264 時，以 AV1（沒有才用 VP9）＋M4A 合併成 MP4 列在主清單，列中加註「部分播放器可能無法播放」（T18a、QUESTIONS Q43、002 FR-13）。

## T19 影片面板、T20 MP3 面板

- 共通的閘門：直播或尚未開始的影片（頁面資料或 yt-dlp 的 `liveStatus`）顯示無法下載；橋接程式不能下載時顯示 T16 的安裝說明。
- 時間範圍（`components/panels/TimeRange.tsx`，兩個面板共用）：區間滑桿、「開始」「結束」輸入框（時:分:秒）、「與播放器同步」開關；
  同步時拖動把手讓播放器跳轉，並在兩個輸入框旁出現「設為目前時間」按鈕（002 FR-23）。兩個面板各自記住範圍，換影片時重設（004 FR-26）。
  影片長度改變時（先用播放器的長度，取得 yt-dlp 的資料後改用它），原本是整部影片就跟著改成新的整部影片。
- 影片面板：範圍不合法時畫質列停用（004 FR-25）；範圍不是整部影片時大小改為比例估算，第一次出現時顯示一次「裁切需要額外處理時間」，
  第一次裁切下載後不再顯示（`local:clipHintSeen`）。點畫質列立即開始下載（FR-14）。
- MP3 面板：位元率 64／128／192／256／320（預設 192，記住上次選擇，`sync:mp3Bitrate`）、時間範圍、「釘選面板」與「下載」。
- 檔名由橋接程式組出：裁切時加「 01m00s-01m30s」（一小時以上「01h02m03s」）。

## T21 字幕改用橋接程式

直接下載失敗時，先查詢橋接程式狀態：可以下載就改用 yt-dlp（`subtitle`，`subAuto` 依字幕是否自動產生，格式沿用面板的選擇），
面板顯示「已改用 yt-dlp 下載，檔案會存到下載資料夾」與下載進度；無法使用時維持 T21a 的錯誤說明。

## T22 共通狀態

- 工具列按鈕的進度環（`data-progress`）：該影片、該類型進行中下載的最小百分比；沒有百分比時為轉動的不確定進度（FR-6b）。
- 面板內的工作清單只列出目前影片、該類型的下載（新的在前，已取消的不列）：標籤、狀態、進度條、百分比·速度·剩餘時間、「取消」；
  完成後顯示檔名與「顯示檔案」；失敗時依 FR-6a 顯示原因：

| 錯誤代碼 | 訊息 | 操作 |
|---|---|---|
| `HOST_UNREACHABLE`、`YTDLP_NOT_FOUND`、`FFMPEG_NOT_FOUND` | 缺少橋接程式、yt-dlp 或 ffmpeg | 安裝說明連結、重試 |
| `YTDLP_OUTDATED`、`VERIFICATION_REQUIRED` | YouTube 有變動，請更新 yt-dlp | 重試、「更新 yt-dlp」 |
| `LOGIN_REQUIRED` | 這部影片需要登入才能觀看，目前不支援 | — |
| `VIDEO_UNAVAILABLE` | 這部影片無法觀看 | — |
| `LIVE_NOT_SUPPORTED` | 直播與尚未開始的影片無法下載 | — |
| `FORMAT_UNAVAILABLE` | 這個畫質已經無法下載，請改選其他畫質 | 重試 |
| `NO_SUBTITLES` | 這個語言沒有字幕 | — |
| `NETWORK`、`TIMEOUT` | 網路連線問題，請重試 | 重試 |
| `DISK_FULL`、`PERMISSION_DENIED` | 無法寫入下載資料夾 | 開啟設定頁、重試 |
| `TOO_MANY_JOBS` | 同時下載數已達上限（8 個） | 重試 |
| 其他（`INTERRUPTED`、`UNKNOWN` 等） | 下載失敗 | 重試 |

  詳細代碼只寫進 console。設定的資料夾不存在、不是資料夾或無法寫入時，橋接程式回應 `PERMISSION_DENIED`（T15b、Q46）。
- 「更新 yt-dlp」呼叫 `updateYtDlp`：直接更新時顯示結果（已更新到某版本／已是最新版本）；由套件管理工具安裝時顯示可複製的指令。

## T23 設定頁的下載區

`entrypoints/options/downloads.ts`（以 DOM API 建立元素，沒有 innerHTML）：

- 說明：經由 yt-dlp 下載的影片、MP3 與字幕存到下方資料夾；縮圖、截圖與直接下載的字幕存到瀏覽器本身的下載位置。
- 連線狀態：橋接程式、yt-dlp、ffmpeg、deno 是否可用與版本；缺少時顯示安裝指令與安裝說明連結；「重新檢查」「更新 yt-dlp」。
- 下載資料夾：預設顯示「系統的『下載』資料夾（路徑）」；「選擇資料夾…」呼叫 `pickFolder`（取消時不變；不支援時顯示說明），「使用預設」。
- 下載的檔案：檔名格式（橋接程式的 `namePresets`，以翻譯過的名稱顯示；沒有連線時顯示四個內建選項）、「嵌入封面、章節與影片資訊」開關（預設開啟，004 FR-11）。
- 設定：`local:downloadDir`（每台電腦不同的路徑，不同步）、`sync:namePreset`、`sync:embedInfo`。

## 驗證

### 單元測試

`npm test`：29 個測試檔、330 項通過（新增 `utils/native.test.ts`、`utils/format-list.test.ts`、`features/downloads/jobs.test.ts`、
`features/downloads/host-background.test.ts`，以及 `utils/messages.test.ts` 的新訊息）。

### 端到端（Chromium，真正的橋接程式＋假 yt-dlp）

- `sh spikes/stage4/build-host.sh`：以工作目錄內的 Go 快取編譯 `yte-host` 與 `host/testdata/fake-yt-dlp`，產生三個工具資料夾
  （齊全、缺 deno、缺 yt-dlp）。yt-dlp 是一個小腳本，每次執行時讀 `.cache/e2e/scenario`、`.cache/e2e/delay`，測試不用重新啟動瀏覽器就能切換情境。
- 原生訊息：Playwright 的 Chromium 以 `--user-data-dir` 啟動時，從該資料夾的 `NativeMessagingHosts/` 讀取設定檔（`spikes/stage4/probe-native.mjs` 先確認可行）。
  瀏覽器的 `HOME`、`XDG_STATE_HOME`、`PATH` 指到 `spikes/stage4/.cache/`，橋接程式繼承後，狀態檔、記錄檔與預設下載資料夾（`~/Downloads`）都在工作目錄內。
- `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node spikes/stage4/e2e-test.mjs`：**73/73 通過**，涵蓋：
  - 畫質清單、大小、「顯示更多格式」；整部影片下載（進度、速度、剩餘時間、取消按鈕、工具列進度環、完成檔名、通知內容）；
  - 時間範圍：比例估算、一次性提示、`--download-sections *60-90`、檔名「01m00s-01m30s」、不合法範圍停用；
  - MP3：預設 192、記住 320、同步開關、「設為目前時間」、拖動把手讓播放器跳轉、輸入「00:99:00」時停用、裁切下載與參數；
  - 取消（不留下 `.part`／`.ytdl`、不通知）；八種錯誤情境的訊息與操作；失敗通知；「更新 yt-dlp」；重試；
  - 字幕直接下載失敗改用 yt-dlp（上傳字幕 `--write-subs`、自動字幕 `--write-auto-subs`、沒有字幕的訊息）；
  - 下載時 yt-dlp 判定為直播；關閉分頁後下載仍完成並通知；
  - 設定頁：四個元件與版本、預設資料夾、說明文字、檔名格式、嵌入預設開啟、pickFolder 不支援的說明、更新 yt-dlp、
    資料夾不存在時的錯誤、改設定後下載使用新的資料夾／檔名格式／不嵌入、「使用預設」；
  - 瀏覽器在下載途中結束：橋接程式仍完成檔案；重新啟動後補發完成通知（`missed`）；
  - 已連線但缺 yt-dlp；只缺 deno 時的提示與下載；繁體中文介面。
- Linux 上 `reveal`、`pickFolder` 回應 `UNSUPPORTED_PLATFORM`（橋接程式只支援 macOS、Windows），所以「顯示檔案」以橋接程式記錄檔中的 `reveal` 確認；
  headless 無法點擊系統通知，點通知的部分沒有自動化。
- 既有的假頁面測試：`viewing-test` 110/110、`convenience-test` 72/72、`fixture-test` 10/10、`downloads-test` 41/41（T22a 的預期改為四個元件與新的指令）、
  `gallery-shot` 8/8、`spikes/T08a/repro.mjs` 正常。假頁面 `bbbbbbbbbbb` 新增一個直接下載會失敗的自動字幕（日文），供 T21 測試自動字幕。

### Firefox

`node spikes/stage4/firefox-smoke.mjs`（官方 Firefox 158.0.1 headless，以 WebDriver BiDi 安裝暫時附加元件；
`HOME` 指到 `spikes/stage4/.cache/ff/home`，原生訊息設定檔放在 `$HOME/.mozilla/native-messaging-hosts/`；代理設為 127.0.0.1:9，不連外）：
**9/9 通過**——事件頁面以 `connectNative` 取得 status（含 deno）、getInfo、裁切下載完成、取消、失敗代碼、拒絕不合法的訊息、設定頁的連線狀態。
headless 且沒有 D-Bus 時 Firefox 的 `notifications.getAll()` 一律是空的（連直接建立的通知也是），通知列為無法驗證。
BiDi 不能導覽到 `moz-extension:`，以 `--remote-allow-system-access` 從瀏覽器視窗開新分頁。

### 截圖（`specs/notes/screenshots/`）

`T19-video-panel.png`、`T19-video-panel-more.png`、`T19-clip.png`、`T19-video-panel-zh-TW.png`、`T20-mp3-panel.png`、
`T21-subtitles-via-host.png`、`T22-progress.png`、`T22-done.png`、`T22-error-update.png`、`T22-error-disk.png`、`T22-error-zh-TW.png`、
`T22-tools-missing.png`、`T22-deno-hint.png`、`T23-options-downloads.png`、`T23-options-downloads-zh-TW.png`；
另更新 `T22a-video-panel-{mac,windows,zh-TW}.png`（四個元件）與 `T21a-subtitles-direct-failed.png`（假頁面多了自動字幕）。

## macOS 手動驗證步驟（專案擁有者）

以下在 Apple Silicon 或 Intel Mac 上、Chrome 與 Firefox 各做一次（Firefox 以 `about:debugging` 載入 `.output/firefox-mv3/manifest.json`）。

1. **安裝工具**：`brew install yt-dlp ffmpeg deno`；確認 `yt-dlp --version`、`ffmpeg -version`、`deno --version` 都有輸出。
2. **建置**：在 repo 中 `npm install`、`npm run build`、`npm run build:firefox`、`npm run build:host`（需要 Go 1.24 以上）。
3. **安裝橋接程式**：`sh host/dist/yt-toolbar-master-host-macos/install.sh`（不要 sudo）。
4. **載入擴充功能**：Chrome 在 `chrome://extensions` 開啟開發人員模式，「載入未封裝項目」選 `.output/chrome-mv3`（ID 應為 `bkjlangdjfpllnkcpfpdlajchbginjdj`）；
   Firefox 如上。重新啟動瀏覽器。
5. **未安裝狀態（先做）**：安裝橋接程式之前（或執行 `uninstall.sh` 後），開一部影片的「影片」「MP3」面板：顯示四個元件、macOS 安裝步驟與「重新檢查」；
   縮圖、截圖仍可使用。安裝後按「重新檢查」，面板顯示畫質清單。
6. **畫質清單**：開一部有 4K 的影片（例如官方 4K 示範影片），清單由高到低，標籤 1080／HD，大小合理；按「顯示更多格式」後出現 2160p「4K」、1440p「2K」的 WEBM。
7. **影片下載**：點 1080p MP4，工具列「影片」按鈕出現進度環，面板顯示百分比、速度、剩餘時間；完成後收到「下載完成」通知，**點通知後 Finder 選取該檔案**；
   檔案在「下載」資料夾，可用 QuickTime 播放且有聲音、有封面（Finder 的預覽）、有章節（IINA 或 VLC，有章節的影片）。
8. **裁切**：影片面板設定 00:01:00–00:01:30，第一次會出現「裁切需要額外處理時間」，大小顯示「約」；點 720p，得到約 30 秒、開頭正常、聲音同步的 MP4，檔名含「01m00s-01m30s」。
9. **MP3**：選 320 kbps、範圍 00:01:00–00:02:00，下載得到約 60 秒、320 kbps 的 MP3（Finder「取得資訊」），音樂 App 可看到封面、標題、頻道；
   輸入「00:99:00」或開始晚於結束時「下載」停用；開啟「與播放器同步」後拖動把手，播放器跟著跳轉；「設為目前時間」設定為播放器目前時間；
   關閉面板再開，位元率仍是 320。
10. **取消**：開始一個大的下載後按「取消」，下載停止，「下載」資料夾中沒有 `.part` 或 `.yte-tmp-…` 資料夾。
11. **關閉分頁**：開始下載後關閉 YouTube 分頁，下載仍完成並收到通知。
12. **關閉瀏覽器**：開始下載後按 Cmd+Q 結束瀏覽器，等一兩分鐘再開啟瀏覽器：應收到該下載的「下載完成」通知。
13. **字幕**：一般影片的字幕仍直接下載到瀏覽器的下載位置；若遇到直接下載失敗，面板顯示「已改用 yt-dlp 下載」，檔案存到設定的下載資料夾。
14. **設定頁**：連線狀態四項都有版本；「選擇資料夾…」出現 macOS 的選擇資料夾視窗（請回報是否出現「要求控制其他 App」的權限提示），
    選擇後下載存到新資料夾；「使用預設」恢復；檔名格式改為「頻道 - 標題 [ID]」後下載的檔名正確；關閉「嵌入」後下載的檔案沒有封面與章節；
    「更新 yt-dlp」顯示 `brew upgrade yt-dlp`（Homebrew 安裝）。
15. **只缺 deno**：`brew uninstall deno` 後按「重新檢查」：仍可下載，面板上方顯示建議安裝 deno 的提示與 `brew install deno`；測完 `brew install deno`。
16. **錯誤訊息**：拔掉網路後下載顯示「網路連線問題，請重試」與「重試」；會員限定或年齡限制影片顯示需要登入。
17. **直播**：直播中的影片，影片、MP3、字幕面板都顯示無法下載。
18. **解除安裝**：`sh host/dist/yt-toolbar-master-host-macos/uninstall.sh` 後面板回到未安裝狀態。
