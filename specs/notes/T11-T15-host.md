# 階段 3：橋接程式（T11–T15）

日期：2026-10-22　負責：實作方

## 結構

```
host/
  cmd/yte-host/main.go       進入點：瀏覽器模式、--run-job 執行程序模式、--version
  internal/protocol/         原生訊息讀寫（4 位元組本機位元組順序長度＋JSON）
  internal/errs/             固定錯誤代碼
  internal/validate/         參數驗證（plan 4.4）
  internal/commands/         指令白名單與分派
  internal/app/              各指令的實作（組合下列套件）
  internal/ytdlp/            尋找 yt-dlp／ffmpeg、組參數、解析輸出、錯誤分類、VTT→TXT、-U
  internal/jobs/             下載工作：狀態資料夾、執行程序、取消、子程序樹（build tag 分檔）
  internal/platform/         路徑、預設下載資料夾、reveal、pickFolder（build tag 分檔）
  internal/logx/             記錄檔（5MB 輪替、遮蔽家目錄與帳號資訊）
  internal/e2e/              端到端測試（編譯真正的 yte-host，經 stdin/stdout 交談）
  internal/testenv/          測試用：暫存檔放在 host/.testtmp/、編譯假 yt-dlp
  testdata/fake-yt-dlp/      假 yt-dlp（Go，測試時編譯；檔名為 ffmpeg 時模擬 ffmpeg -version）
install/
  macos/install.sh、uninstall.sh
  windows/install.ps1、uninstall.ps1（UTF-8 含 BOM，Windows PowerShell 5.1 才能正確讀取中文註解）
  manifests/chrome.json、firefox.json（@HOST_PATH@ 由安裝腳本代換）
spikes/stage3/                冒煙測試與安裝腳本的模擬測試（.cache/ 不進版控）
```

`npm run build:host` 產出 `host/dist/yte-host-darwin-arm64`、`yte-host-darwin-amd64`、`yte-host-windows-amd64.exe`，並組出 `host/dist/yt-toolbar-master-host-macos/` 與 `-windows/` 兩個安裝資料夾。`npm run test:host` 執行 `go vet` 與 `go test`。

依賴：只有 `golang.org/x/sys`（v0.30.0，Windows 的 Job Object 與已知資料夾）。`go.mod` 維持 `go 1.24`；建置時設定 `GOTOOLCHAIN=local`，不自動下載其他版本的 Go。

## 協定

- 請求：`{"id": "<1–64 個英數字、-、_>", "cmd": "<指令>", "args": {...}}`。`args` 可省略；多餘的頂層欄位、`args` 不是物件都回 `INVALID_REQUEST`。
- 回應：`{"id": ..., "ok": true, "result": {...}}` 或 `{"id": ..., "ok": false, "error": {"code": ..., "message": ...}}`。無法取得合法 id 時 `id` 為 `null`。`message` 是英文的除錯說明，擴充功能應依 `code` 顯示文字。
- 大小：送出上限 1MB（超過時改回 `RESPONSE_TOO_LARGE`；`getInfo` 會先自行精簡到 1MB 以下）；收到的請求上限 64KiB（超過時丟棄並回 `INVALID_REQUEST`，連線繼續）；長度欄位超過 64MiB 視為資料流錯亂而結束。
- 事件（主動推送，沒有 `id`）：
  - `{"event":"progress","jobId","videoId","kind","state":"downloading"|"processing","percent","speed","eta","part","parts"}`：`percent` 0–100，未知時省略；`speed` 位元組／秒；`eta` 秒；`part`／`parts` 是影像＋聲音分段下載時的第幾段。
  - `{"event":"done","jobId","videoId","kind","path","fileName"}`
  - `{"event":"failed","jobId","videoId","kind","error":{"code","message"}}`
  - 取消不送事件（`cancel` 的回應就是結果）。
- 請求可以並行處理（最多 8 個同時），回應順序不一定與請求相同，以 `id` 配對。

## 指令

| 指令 | 參數 | 結果 |
|---|---|---|
| `status` | — | `hostVersion`、`os`、`arch`、`ready`（yt-dlp 與 ffmpeg 都可用，可以下載）、`complete`（另外 deno 也可用）、`ytDlp`／`ffmpeg`／`deno`：`{found, path, version, error?, manager?, updateCommand?}`（`error` 為找不到或無法執行時的代碼：`YTDLP_NOT_FOUND`、`FFMPEG_NOT_FOUND`、`DENO_NOT_FOUND`；`manager`、`updateCommand` 只有 yt-dlp）、`missing`（缺少的元件，依序為 `"yt-dlp"`、`"ffmpeg"`、`"deno"`）、`installCommand`（一次安裝全部缺少元件的指令，例如 `brew install yt-dlp ffmpeg deno`、`winget install yt-dlp.yt-dlp Gyan.FFmpeg DenoLand.Deno`；沒有缺少時為空字串）、`defaultDir`、`namePresets: [{id, example}]` |
| `getInfo` | `videoId` | `id`、`title`、`channel`、`duration`、`uploadDate`、`liveStatus`（not_live／is_live／is_upcoming／was_live／post_live）、`isLive`、`chapters: [{start,end,title}]`、`formats: [{id,ext,vcodec,acodec,width,height,fps,tbr,abr,vbr,filesize,filesizeApprox,note,protocol,dynamicRange,language,audioChannels}]`（已去掉分鏡圖與 DRM 格式，依 yt-dlp 的順序由差到好）、`subtitles: [{lang,name,exts}]`、`autoCaptions: [{lang,name}]`、`truncated?`。不含任何網址 |
| `download` | 見下 | `{jobId, state:"queued"}` |
| `cancel` | `jobId` | `{jobId, state}`（等到子程序樹結束、暫存檔刪除後才回應；已結束的工作直接回傳目前狀態） |
| `jobs` | — | `{jobs: [...]}`：進行中的在前，其餘由新到舊；每筆含 `jobId, videoId, kind, state, percent, speed, eta, downloaded, total, part, parts, path?, fileName?, error?, createdAt, updatedAt, finishedAt?, missed` |
| `reveal` | `jobId` | `{path}`；在 Finder（`open -R`）或檔案總管（`explorer.exe /select,"…"`）中選取檔案 |
| `pickFolder` | — | `{path, cancelled}`；取消時 `path` 為 `null`、`cancelled` 為 `true` |
| `updateYtDlp` | — | `{ran, manager?, command?, updated, upToDate, version?, output?}`；由 Homebrew、winget、pip、pipx、scoop、MacPorts 安裝時 `ran:false` 並給 `command`，不執行 |

`download` 的參數（不屬於該種類的欄位一律拒絕）：

| 種類 `kind` | 必要 | 可選 |
|---|---|---|
| `video` | `videoId`、`formatId`、`container`（mp4／webm）、`dir` | `section {start,end}`、`embed`（預設 true）、`namePreset` |
| `mp3` | `videoId`、`bitrate`（64／128／192／256／320）、`dir` | `section`、`embed`、`namePreset` |
| `subtitle` | `videoId`、`subLang`、`subFormat`（srt／vtt／txt）、`dir` | `subAuto`（自動字幕，預設 false）、`namePreset` |

`namePreset`（預設 `title-id`）：`title-id`「標題 [ID]」、`title`「標題」、`channel-title`「頻道 - 標題 [ID]」、`date-title`「上傳日期 標題 [ID]」。裁切時檔名加上「 01m30s-03m45s」（一小時以上小時補零，例如「01h02m03s」，Q37）。

## 錯誤代碼

| 代碼 | 意義 |
|---|---|
| `INVALID_REQUEST` | 訊息不是合法的請求（JSON 錯誤、缺少或不合法的 id／cmd、多餘欄位、過大） |
| `UNKNOWN_COMMAND` | 不在白名單的指令 |
| `INVALID_ARGS` | 參數沒有通過驗證（下載資料夾的格式錯誤，例如不是絕對路徑或含 `..`） |
| `RESPONSE_TOO_LARGE` | 回應超過 1MB |
| `YTDLP_NOT_FOUND` | 找不到或無法執行 yt-dlp |
| `FFMPEG_NOT_FOUND` | 需要 ffmpeg 但找不到 |
| `DENO_NOT_FOUND` | 找不到 deno（只出現在 `status` 的 `deno.error`，不阻擋 getInfo 與 download；Q39） |
| `UNSUPPORTED_PLATFORM` | 此作業系統不支援（例如 Linux 上的 reveal／pickFolder） |
| `YTDLP_OUTDATED` | 解析失敗、HTTP 403、不認得的選項等，通常更新 yt-dlp 可解決 |
| `LOGIN_REQUIRED` | 私人、會員限定、年齡限制 |
| `VERIFICATION_REQUIRED` | YouTube 要求確認不是機器人 |
| `VIDEO_UNAVAILABLE` | 影片不存在、已移除、地區限制 |
| `LIVE_NOT_SUPPORTED` | 直播中或尚未開始 |
| `FORMAT_UNAVAILABLE` | 指定的格式不存在 |
| `NO_SUBTITLES` | 指定語言沒有字幕 |
| `NETWORK` | 網路錯誤 |
| `DISK_FULL` | 磁碟空間不足 |
| `PERMISSION_DENIED` | 下載資料夾不存在、不是資料夾或無法寫入（T15b、Q46） |
| `TIMEOUT` | 逾時（getInfo 90 秒、版本查詢 30 秒、更新 5 分鐘、取消 20 秒、單一下載 24 小時） |
| `UPDATE_FAILED` | `yt-dlp -U` 失敗（訊息為 yt-dlp 的最後一行） |
| `JOB_NOT_FOUND` | 工作不存在（或屬於另一個瀏覽器） |
| `JOB_NOT_FINISHED` | reveal 一個還沒完成的工作 |
| `FILE_NOT_FOUND` | reveal 時檔案已被移動或刪除 |
| `TOO_MANY_JOBS` | 同一個瀏覽器同時超過 8 個下載 |
| `BUSY` | 已經有選擇資料夾視窗或 yt-dlp 更新在進行 |
| `INTERRUPTED` | 執行下載的程序意外結束 |
| `UNKNOWN` | 其他 |

## 工作與生命週期（plan 4.6 的實作方式）

- 瀏覽器在關閉連線後可能結束橋接程式（Chrome 與 Firefox 都會在連線關閉一段時間後結束原生程式），所以下載**不在**瀏覽器啟動的程序中執行：`download` 驗證參數後寫入 `<資料夾>/state/jobs/<jobId>/spec.json`，再以 `yte-host --run-job <jobId>` 啟動一個脫離瀏覽器的執行程序（macOS：`setsid`；Windows：`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`，並嘗試 `CREATE_BREAKAWAY_FROM_JOB`，瀏覽器不允許時改為不脫離）。執行程序只接受合法的工作 ID，從固定的狀態資料夾讀參數並再驗證一次。
- 執行程序把 yt-dlp 放進可以整組結束的範圍：macOS 為新的程序群組（取消時先 SIGTERM，3 秒後 SIGKILL 整個群組）；Windows 以 `CREATE_SUSPENDED` 建立 yt-dlp、加入設定了 `KILL_ON_JOB_CLOSE` 的 Job Object 後再恢復執行，取消時 `TerminateJobObject`。yt-dlp 結束後也會清掉群組中殘留的程序。
- yt-dlp 的所有輸出先寫到下載資料夾中的 `.yte-tmp-<jobId>`（`-P`），完成後把結果搬到下載資料夾（同名時加「 (2)」），最後刪除暫存資料夾；取消或失敗時直接刪除整個暫存資料夾，不會留下 `.part`、`.ytdl` 或合併前的檔案。
- 執行程序每 5 秒（有進度時最多每 250 毫秒）更新 `status.json`；橋接程式每 300 毫秒讀取並推送事件。超過 2 分鐘沒有更新且程序已不在的工作標記為 `INTERRUPTED`。
- 瀏覽器重新連線時，新的橋接程式會接手追蹤進行中的工作，繼續推送進度與完成事件。擴充功能沒有連線時結束的工作，下一次 `jobs` 會以 `missed: true` 回報一次（之後為 false），供背景腳本補發通知。
- stdin 結束後，橋接程式等這次連線開始的下載全部結束才離開，最長 6 小時（下載本身不受這個時限影響，單一下載上限 24 小時）。
- Chrome 與 Firefox 的工作分開記錄（依瀏覽器啟動時傳入的參數判斷呼叫者），彼此看不到。已結束的工作保留 7 天、每個瀏覽器最多 100 筆。

## yt-dlp 參數

共通：`--ignore-config --no-playlist --newline --no-colors --progress --progress-template "download:YTE-PROGRESS {...}" --progress-template "postprocess:YTE-POST {...}" --print "after_move:YTE-FILE %(filepath)j" --windows-filenames --match-filters "!is_live & live_status!=?is_live & live_status!=?is_upcoming" -P <暫存資料夾> -o <範本> [--ffmpeg-location <ffmpeg>] ... -- https://www.youtube.com/watch?v=<id>`

- `%(...)j` 會把非 ASCII 字元跳脫，Windows 主控台編碼下路徑也能完整傳回；另外設定 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`。
- deno 的找法與 yt-dlp、ffmpeg 相同（PATH、`/opt/homebrew/bin`、`/usr/local/bin`、WinGet Links 與 `Packages\DenoLand.Deno_*\deno.exe`）。
- 子程序的 PATH 補上 `/opt/homebrew/bin`、`/usr/local/bin`（macOS）或 WinGet Links（Windows），以及 ffmpeg、deno 所在資料夾，讓 yt-dlp 找得到 ffprobe 與 deno。
- 影片：`-f <formatId> --merge-output-format <container>`；嵌入時 `--embed-thumbnail`（WEBM 不加）`--embed-metadata --embed-chapters`；裁切時 `--download-sections *S-E --force-keyframes-at-cuts`，並以 `--no-embed-chapters` 取代 `--embed-chapters`（004 FR-13 允許，因為 `--embed-metadata` 預設也會嵌入章節）。
- MP3：`-f bestaudio/best -x --audio-format mp3 --audio-quality <n>K`，嵌入與裁切同上。
- 字幕：`--skip-download --write-subs`（或 `--write-auto-subs`）`--sub-langs <lang> --sub-format vtt`，SRT 加 `--convert-subs srt`；TXT 由橋接程式轉換（去掉檔頭、NOTE／STYLE、時間碼、標籤、實體字元，以及連續重複的行）。

## 驗證紀錄

- `cd host && go vet ./... && go test ./...`：全部通過；`go test -race ./...` 也通過。另以 `GOOS=windows`、`GOOS=darwin` 執行 `go vet ./...`，確認各平台的程式可以編譯。
- 真正的 yt-dlp（官方 release 2026.10.21，放在 `spikes/stage3/.cache/bin/`）：
  - 以 `YTE_REAL_YTDLP=... go test ./internal/ytdlp -run Real -v` 對本機測試伺服器（`httptest`）上的 20 秒測試影片執行 `DownloadArgs` 組出的完整參數：影片、影片裁切（3–8 秒，檔名 `test [test] 00m03s-00m08s.mp4`）、MP3 裁切都成功，yt-dlp 接受全部選項，進度、後處理與 `YTE-FILE` 都能解析。進度與 `YTE-FILE` 寫到 stdout，後處理進度寫到 stderr（兩者都會讀）。裁切下載由 ffmpeg 執行時只有一行完成進度，擴充功能要能處理沒有百分比的情況。
  - `spikes/stage3/smoke-info.sh jNQXAC9IVRw`：對一部 19 秒的公開影片執行一次 `-J`（沒有被阻擋），確認欄位名稱（`format_id` 可能含「-drc」、`subtitles` 項目有 `name`、`automatic_captions` 的 `name` 可能是 null、`chapters`、`live_status`）。yt-dlp 警告沒有 JavaScript 執行環境時部分格式可能缺少；依 Q39 的回答，deno 列為必要元件（T15a）。
- 端到端（`go test ./internal/e2e -v`）：編譯真正的 `yte-host` 與假 yt-dlp，以 Chrome 的來源參數啟動，經 stdin/stdout 送出 `status`、`getInfo`、非法指令與參數、`download`（影片、MP3 裁切）、`jobs`、`reveal`、`download`（慢速）＋`cancel`；另外測試強制結束橋接程式後下載仍完成、重新連線以 `missed` 補報、Firefox 看不到 Chrome 的工作、stdin 結束後立即離開、記錄檔不含家目錄。
- 安裝腳本：`shellcheck`（0.11.0）檢查 `install/macos/*.sh` 無警告；`spikes/stage3/test-install-macos.sh` 在 Linux 上以假的 `uname`、`sysctl`、`xattr`、`id` 模擬執行安裝與解除安裝，確認設定檔 JSON、路徑、ID 正確、重複安裝可覆蓋、解除安裝後沒有留下檔案、以 root 執行會被拒絕。PowerShell 腳本以官方 PowerShell 7.4.6（Linux 版）只做語法解析（`spikes/stage3/check-ps1.sh`），三個腳本（含 pickFolder 內嵌的腳本）都沒有語法錯誤。
- `host/dist/yte-host-darwin-arm64` 含有 Go 連結器產生的 ad-hoc 簽章（LC_CODE_SIGNATURE），Apple Silicon 可以直接執行。

## 需要專案擁有者在 macOS 上手動驗證

1. `npm run build:host`，再執行 `sh host/dist/yt-toolbar-master-host-macos/install.sh`（不加 sudo）。確認輸出中兩個「Registered」路徑存在，且 `~/Library/Application Support/youtube-extension-host/yte-host --version` 印出版本。
2. 未安裝 yt-dlp、ffmpeg 或 deno 時，安裝腳本印出 `brew install yt-dlp ffmpeg deno`；三者都安裝後重新執行不再提示。
3. 重新啟動 Chrome，在擴充功能的背景頁主控台執行：
   ```js
   const p = chrome.runtime.connectNative('com.chidi0716.youtube_extension');
   p.onMessage.addListener((m) => console.log(m));
   p.postMessage({ id: '1', cmd: 'status' });
   ```
   應收到 `ok: true`、`ready: true`、`complete: true`、`missing: []`、`deno.version`，`ytDlp.manager` 為 `homebrew`、`updateCommand` 為 `brew upgrade yt-dlp`，`defaultDir` 為 `~/Downloads`。Firefox（與 Zen）以 `browser.runtime.connectNative` 做同樣的測試。
4. 同一個連線送 `{"id":"2","cmd":"getInfo","args":{"videoId":"<一部短影片>"}}`，應在數秒內收到格式清單。
5. 送 `{"id":"3","cmd":"download","args":{"videoId":"<同一部>","kind":"video","formatId":"<從 getInfo 選一個 mp4 影像>+140","container":"mp4","dir":"<下載資料夾的絕對路徑>"}}`，應收到 progress 事件與 done 事件，檔案出現在下載資料夾，`.yte-tmp-…` 已刪除；用 QuickTime 或 IINA 開啟確認有聲音、封面、章節。
6. 長一點的影片下載途中送 `{"id":"4","cmd":"cancel","args":{"jobId":"<jobId>"}}`：回應 `state: cancelled`，下載資料夾沒有殘留，`ps ax | grep -E 'yt-dlp|ffmpeg'` 沒有殘留程序。
7. 下載途中直接結束瀏覽器（Cmd+Q）：檔案仍會完成；重新開啟瀏覽器後送 `jobs`，該工作 `missed: true`。
8. `{"id":"5","cmd":"reveal","args":{"jobId":"<完成的 jobId>"}}`：Finder 開啟並選取檔案。
9. `{"id":"6","cmd":"pickFolder"}`：出現選擇資料夾視窗且在瀏覽器前面；選擇後回傳路徑，按取消回傳 `cancelled: true`。若出現「要求控制其他 App」的權限提示，請回報。
10. `{"id":"7","cmd":"updateYtDlp"}`：Homebrew 安裝時回傳 `ran: false` 與 `brew upgrade yt-dlp`。
11. 查看 `~/Library/Logs/youtube-extension-host/host.log`：只有指令名稱、工作狀態與錯誤代碼，路徑中的家目錄顯示為 `~`。
12. 執行 `sh host/dist/yt-toolbar-master-host-macos/uninstall.sh`，確認上述設定檔、`~/Library/Application Support/youtube-extension-host/` 與記錄檔資料夾都已刪除，重新檢查時顯示找不到橋接程式。

## T15a（Q37、Q39 的回答）

日期：2026-10-22

- `status` 新增 `deno`、`complete`、`missing`、`installCommand`，找不到的元件在 `error` 標示 `YTDLP_NOT_FOUND`／`FFMPEG_NOT_FOUND`／`DENO_NOT_FOUND`（原本找不到時沒有 `error`）。`ready` 的意義不變（只看 yt-dlp 與 ffmpeg），缺少 deno 不會讓 getInfo 或 download 失敗。
- 安裝腳本檢查 yt-dlp、ffmpeg、deno，任一缺少時提示一次安裝三者：`brew install yt-dlp ffmpeg deno`、`winget install yt-dlp.yt-dlp Gyan.FFmpeg DenoLand.Deno`。README 中英文同步。
- 時間範圍的檔名標記一小時以上改為小時補零：`01h02m03s`（未滿一小時仍為 `01m30s`）。
- 假 yt-dlp 以 deno 為檔名時模擬 `deno --version`（`deno 2.1.4 (...)`），`testenv.FakeToolsDir` 改為列出要放入的工具。
