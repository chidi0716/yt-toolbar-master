# T29、T30 頁面整理：設定頁分類、CSS 開關機制與只靠樣式的選項

日期：2026-10-22　負責：實作方

## 機制（T29，plan 3.7.2）

- 新的內容腳本 `entrypoints/tidy.content.ts`（isolated world、`document_start`、只在 `www.youtube.com` 與 `youtube.com`）啟動 `features/tidy`：
  - 先在頁面加入一個 `<style id="ytm-tidy-styles">`（`<head>` 還不存在時放在 `<html>` 底下），樣式全部在 `features/tidy/styles.ts`，選擇器來自 `utils/youtube/dom.ts`；
  - 讀取設定後在 `<html>` 加上對應的 class，並以 `storage.watch` 監聽設定變更即時增減（005 FR-3）。沒有計時器或輪詢（005 NFR-1）。
- class 與設定的對應在 `features/tidy/classes.ts`：

  | class | 設定 | 工具列關閉時 |
  |---|---|---|
  | `ytm-hide-comments` | `sync:hideComments`（003 FR-64，「更多」面板） | 移除（003 FR-5） |
  | `ytm-hide-end-cards` | `sync:tidyHideEndCards` | 照常（005 FR-6） |
  | `ytm-no-thumbnail-preview` | `sync:tidyNoThumbnailPreview` | 照常 |
  | `ytm-hide-shorts` | `sync:tidyHideShorts` | 照常 |
  | `ytm-full-titles` | `sync:tidyFullTitles` | 照常 |

- 003 的「隱藏留言」改用此機制：「更多」面板的開關只寫入設定，class 由上述內容腳本處理；原本 `features/viewing/page-styles.ts` 中的規則已移除。重新整理時，頁面解析完成前（工具列出現前）`<html>` 就已有 class。
- 設定頁（`entrypoints/options/`）：「頁面整理」區依觀看頁、干擾、Shorts、介面分組，每個選項一個開關（`role="switch"`）附一行說明，預設全部關閉；保留「下載」區（T23 再加入內容）。分類與選項的清單在 `features/tidy/options.ts`，有單元測試。

## 只靠樣式的選項（T30）

選擇器都在 `utils/youtube/dom.ts`，以 `:is(…)` 組成一條規則（`:is()` 會略過無法解析的選擇器，單一選擇器失效不影響其他）。

| 選項 | 選擇器 | 真實頁面 |
|---|---|---|
| 隱藏片尾卡片與結尾畫面 | `.ytp-ce-element`、`.html5-endscreen.videowall-endscreen`、`.ytp-endscreen-content`、播完時（`#movie_player.ended-mode`）的 `.ytp-fullscreen-grid-stills-container` | **未確認**：影片在本環境無法播放。觀看頁上 `.ytp-fullscreen-grid`（含 `.ytp-fullscreen-grid-stills-container`）存在且平時不顯示（`results-details.txt`）；其他元素名稱依公開觀察。自動播放倒數（`.ytp-autonav-endscreen-*`）不在清單中。 |
| 停用縮圖自動預覽 | `ytd-app > #video-preview`、`ytd-video-preview`、`ytd-moving-thumbnail-renderer` | **已確認**：搜尋頁游標停在縮圖上時，預覽在 `ytd-app > #video-preview`（`results-home.txt`、`results-watch.txt`）；開啟選項後該元素 `display: none`（`results-real-tidy.txt`）。預覽播放器是否仍在背景載入影片未確認。 |
| 隱藏 Shorts | 區塊：`ytd-rich-shelf-renderer[is-shorts]` 與包住它的 `ytd-rich-section-renderer`、`grid-shelf-view-model:has(ytm-shorts-lockup-view-model)`、`ytd-reel-shelf-renderer`；項目：`ytm-shorts-lockup-view-model(-v2)`、縮圖連到 `/shorts/` 的 `ytd-rich-item-renderer`、`ytd-video-renderer`、`ytd-grid-video-renderer`、`ytd-compact-video-renderer`、`yt-lockup-view-model`；導覽：`title="Shorts"` 或 Shorts 圖示 SVG path 開頭的 `ytd-guide-entry-renderer`、`ytd-mini-guide-entry-renderer` | **搜尋頁、左側導覽已確認**：開啟後搜尋頁可見的 Shorts 連結 40 → 0、Shorts 區塊 3 → 0，左側導覽的 Shorts 入口隱藏（`results-real-tidy.txt`）。觀看頁推薦清單的 `ytd-reel-shelf-renderer` 與 `ytm-shorts-lockup-view-model-v2` 已在真實頁面看到（`results-watch.txt`）。**首頁與訂閱未確認**：未登入時首頁沒有影片、訂閱需要登入；`ytd-rich-shelf-renderer[is-shorts]` 依公開的元素名稱。 |
| 顯示完整影片標題 | `#video-title`、`.ytLockupMetadataViewModelTitle`、`.shortsLockupViewModelHostMetadataTitle`：取消 `-webkit-line-clamp`、`max-height`、`overflow` | 實測這些標題是 2 行截斷（`-webkit-line-clamp: 2`、`max-height: 52px`）。真實搜尋頁那次的結果中沒有被截斷的標題，所以「變長」只在假頁面驗證。 |

- 導覽的 Shorts 入口：實測連結沒有 `href`、`title="Shorts"`。為了不依賴介面語言，另以 Shorts 圖示的 SVG path 開頭（`m13.467 1.19-8 4.7`）辨識；YouTube 換圖示時需要更新 `SHORTS_GUIDE_SELECTORS`。
- 直接開啟 `/shorts/<ID>` 時，Shorts 頁本身的播放器不在清單中（005 FR-63，有單元測試確認樣式中沒有 `ytd-shorts`、`ytd-reel-video-renderer`）。

## 假頁面驗證

`spikes/stage1-smoke/convenience-test.mjs`：

- T29（9 項）：設定頁分類、說明、預設關閉、下載區、sync、兩個設定頁同步、隱藏留言改用 class、重新整理時 class 在工具列出現前就套用、繁體中文。
- T30（21 項）：從設定頁開關後已開啟分頁立即生效；片尾卡片、播完的格狀畫面（傳統與新版）隱藏，自動播放倒數照常並換到下一部；首頁、搜尋、推薦清單的縮圖不顯示預覽且點擊照常開啟；首頁、訂閱、搜尋、推薦清單、導覽與迷你導覽的 Shorts 隱藏，格狀清單重新排列沒有空位；直接開啟 Shorts 網址不受影響；首頁、搜尋、頻道、推薦清單的長標題完整顯示且不重疊；工具列關閉後仍生效。
- 假頁面：`fixtures/home.html`（也用於 `/feed/subscriptions`、`/@…`）、`fixtures/search.html`、`fixtures/shorts.html`、`fixtures/browse.js`（縮圖預覽、站內換頁到 Shorts），觀看頁的附加模擬在 `fixtures/stage2c-watch.js`。
- 截圖：`screenshots/T29-options-en.png`、`T29-options-zh-TW.png`、`T30-home-before.png`、`T30-home-after.png`、`T30-search-after.png`、`T30-end-screen-hidden.png`（都是假頁面）。

## 給專案擁有者的手動驗證步驟

已登入的 Chrome 與 Firefox（或 Zen）上，打開擴充功能的設定頁：

1. 「頁面整理」有四個類別，所有開關預設關閉。開關任一選項時，已開啟的 YouTube 分頁不需重新整理就改變。
2. 開啟「隱藏 Shorts」：首頁、訂閱、搜尋結果、觀看頁右側推薦清單、左側選單（展開與收合兩種）都看不到 Shorts，首頁格狀清單沒有空位。若仍看到 Shorts，請在開發者工具中選取該區塊，回報它與上層幾個元素的 tag 名稱與 class。
3. 開啟「隱藏片尾推薦卡片與結尾畫面」：
   - 找一部有片尾卡片的影片，跳到最後 20 秒：畫面上沒有推薦影片／頻道的方塊；
   - 關閉 YouTube 的自動播放，看完影片：播放器內沒有推薦影片格子；
   - 開啟自動播放再看完一次：「下一部」倒數照常出現並自動播放下一部。
   若格子仍出現，請回報播完時 `#movie_player` 的 class 與格子元素的 class。
4. 開啟「停用縮圖自動預覽」：首頁、搜尋、訂閱、觀看頁推薦清單中，游標停在縮圖上不播放預覽；點縮圖照常開啟影片。
5. 開啟「顯示完整影片標題」：首頁、搜尋、訂閱、頻道、推薦清單中很長的標題完整顯示，不與頻道名稱、觀看次數重疊。
6. 從彈出視窗關閉「啟用」：上述選項仍然生效；「更多」面板的「隱藏留言」則不再作用（003 FR-5）。
