# T07a 劇院模式改為分區調暗

日期：2026-10-21　負責：實作方

## 結論

- 舊做法（整頁固定遮罩 `z-index: 2200`，播放器容器與工具列提高到 `2201`）只在播放器與工具列的祖先都不形成堆疊脈絡時有效。只要祖先中有一層 `position` ＋ `z-index`，提高的 `z-index` 就只在那一層裡比較，整頁遮罩會連播放器與工具列一起蓋住（專案擁有者回報的症狀）。
- 新做法（plan 3.7）：在 `<html>` 加上 `ytm-cinema`，以 CSS 把播放器容器與工具列**以外**的區域設為 `opacity: 0.07`（變暗約 93%），`<html>`、`<body>`、`ytd-app` 背景改為黑色。播放器與它的祖先完全不被改動，所以不受堆疊脈絡影響。
- 點被調暗的區域：在 `window` 上以捕獲階段攔截 `pointerdown`、`mousedown`、`pointerup`、`mouseup`、`click`、`auxclick`、`dblclick`，阻止預設動作與傳遞（連結、按鈕、中鍵開新分頁都不會被觸發），`click` 時關閉。Esc 關閉（有未釘選的面板時先收起面板）。
- 工具列宿主在劇院模式中維持 `position: relative; z-index: 2201`（展開的面板不會被同一層中變暗的兄弟元素蓋住），按鈕改用深色背景上的白色。

## 調暗的區域（`utils/youtube/dom.ts` 的 `CINEMA_DIMMED_REGIONS`）

依從站內換頁進入的真實觀看頁確認（`spikes/T07a/results-real-*.txt` 的 `regions`、`container children`）：

| 選擇器 | 區塊 |
|---|---|
| `#masthead-container` | 頂端列 |
| `tp-yt-app-drawer#guide`、`ytd-mini-guide-renderer` | 左側導覽 |
| `ytd-watch-flexy #columns > :not(#primary)` | 播放器欄位以外的欄位（右側欄：推薦影片、播放清單、聊天室、資訊面板） |
| `ytd-watch-flexy #below > :not(ytm-toolbar)` | 播放器下方：標題、頻道、說明、留言（工具列也在 `#below` 中，所以只調暗其他子元素） |
| `ytd-watch-flexy #primary-inner > :not(#player):not(#below)` | 播放器欄位中的其他區塊 |
| `ytd-watch-flexy #full-bleed-container > :not(#player-full-bleed-container)` | YouTube 劇院模式時全寬區中播放器以外的面板 |
| `ytd-watch-flexy #fixed-side-menu`、`ytd-watch-flexy #survey` | 部分版面右側的固定選單（說明、留言按鈕）、問卷 |
| `ytd-watch-flexy #cinematics-container` | 「環境模式」在播放器周圍的光暈 |

真實觀看頁的容器結構（`ytd-watch-flexy` 的子元素有 `#full-bleed-container`、`#single-column-container`、`#columns`、`#fixed-side-menu`、`#survey` 等）：播放器一般在 `#columns > #primary > #primary-inner > #player`，YouTube 劇院模式時在 `#full-bleed-container > #player-full-bleed-container`。以「容器的其他子元素」表示的區域都排除了包含播放器或工具列的那個子元素。`#single-column-container` 在窄版面時可能包含播放器，所以不整個調暗 `ytd-watch-flexy` 的子元素。

## 重現與修正的證據

### 假觀看頁（`spikes/stage1-smoke/viewing-test.mjs` 的 T07）

假觀看頁讓播放器與工具列位於多層形成堆疊脈絡的祖先內（`#primary-inner` `z-index: 0`、`#player` `z-index: 1`、`#player-container-inner` `z-index: 0`），並有頂端列、側欄、標題、「訂閱」、說明、留言。

- **重現**：以舊的建置執行舊測試（`spikes/T07a/results-fixture-before.txt`）：播放器與工具列位置的 `elementFromPoint` 都是遮罩（`{"player":"overlay","toolbar":"overlay"}`），工具列的「說明」按鈕無法點擊（Playwright 等待逾時）。截圖：`screenshots/T07a-before-player-covered.png`（播放器跟著變暗，工具列消失）。新測試也保留這個重現：在假頁面上套用舊做法的遮罩與 `z-index`，確認會蓋住播放器與工具列。
- **修正後**（14 項全部通過）：
  - `elementFromPoint`：播放器中央、控制列、播放／暫停按鈕 → 播放器；工具列「影片」「劇院模式」「關閉」按鈕 → 工具列；展開的說明面板中央 → 工具列。
  - 頂端列、標題、說明、留言、側欄連結的實際不透明度（含祖先）都是 0.07；播放器與工具列是 1；`<html>`、`<body>`、`ytd-app` 背景 `rgb(0, 0, 0)`。
  - 播放器的播放／暫停可以點擊且不關閉劇院模式；說明面板可展開，Esc 先收起面板。
  - 換到另一部影片時繼續生效；Esc、點變暗區域的空白處、點變暗的連結（不會開啟連結）、點頂端列的按鈕（不會被觸發）都會關閉；重新整理後不記住。
  - 深色主題同樣通過。
- 截圖：`screenshots/T07a-cinema-light.png`、`screenshots/T07a-cinema-dark.png`。

### 真實觀看頁（`spikes/T07a/real-cinema.mjs`）

觀看頁直接載入會被驗證頁擋住；從首頁以站內換頁（頂端列搜尋 → 點影片）可以進入，載入擴充功能的建置。影片本身在本環境無法播放（Video unavailable），播放器的元素與控制列仍在。

- **舊做法**（`results-real-before.txt`）：本環境的真實頁面中，播放器的祖先沒有形成堆疊脈絡（只有 `#movie_player` 本身是 `position: relative; z-index: 0`），所以播放器沒有被蓋住；但工具列的按鈕位置都是遮罩（`toolbarCinema`、`toolbarHelp` → `div.ytm-cinema-overlay`），工具列無法使用。專案擁有者的環境中播放器也被蓋住，表示該環境的祖先有形成堆疊脈絡（YouTube 版面實驗或瀏覽器差異），假觀看頁依此重現。
- **新做法**（`results-real-after-light.txt`、`results-real-after-dark.txt`、`results-real-after-theater.txt`）：
  - 淺色、深色、與 YouTube 劇院模式同時使用（FR-23）三種情況下，播放器中央、控制列、工具列「劇院模式」「說明」按鈕的 `elementFromPoint` 都是播放器或工具列。
  - 整個畫面每 40px 取一點，播放器與工具列以外、實際不透明度大於 0.1 且有畫出內容的元素：0 個。
  - 右側欄縮圖實際畫出來的平均亮度（截圖後計算，0–255）：淺色 151.4 → 10.1、深色主題（以深色縮圖為例）9.8 → 0.6，約變暗 93%。
  - 點變暗的右側欄縮圖：劇院模式關閉，網址不變（沒有開啟那部影片）。
- 曾有一次 YouTube 以不同的版面實驗載入（留言面板在右側、右邊有固定的「說明／留言」選單），其中右側選單的一個按鈕沒有被調暗（截圖中最大亮度 51／255，其他變暗區域不超過 17；該次的輸出已被之後的執行覆蓋）。依真實頁面的結構把 `#fixed-side-menu` 加入調暗區域，並把右側欄改為「`#columns` 中 `#primary` 以外的欄位」。之後多次載入都是一般版面，無法再次確認該版面（QUESTIONS Q19）。
- 真實頁面的截圖含有第三方推薦影片的內容，沒有放進 repo（在 `spikes/T07a/.cache/`）。

### 關於截圖「看起來」偏亮

檢視真實頁面的截圖時，變暗的縮圖看起來仍可辨識，但以程式計算截圖的像素，變暗區域的最大亮度都在 17／255 以下（`measure-png.mjs`、`results-dim-methods.txt`、`results-thumb-time*.txt`）。看起來可辨識是因為整張圖幾乎全黑時的視覺對比，不是縮圖沒有被調暗。

## 單元測試（`features/viewing/cinema.test.ts`）

不依賴 DOM 的設定檢查：調暗區域包含頂端列、右側欄、播放器下方；任何區域都不是播放器、播放器的容器或祖先、工具列；以「其他子元素」表示的區域都排除包含播放器的子元素；樣式只在 `<html>` 有 class 時作用、背景黑色、不透明度在 0.05–0.1 之間、不再使用遮罩；攔截的事件包含 `click`、`auxclick`、`pointerdown`、`mousedown`。

## 給專案擁有者的手動驗證步驟

在原本回報問題的瀏覽器（Zen）與 Chrome 上，打開影片頁並播放：

1. 按劇院模式（燈泡）按鈕：播放器亮度正常、可以點擊播放／暫停、進度列、音量、設定選單、全螢幕；工具列按鈕可見（白色）且可以點擊、展開面板。
2. 頂端列、右側推薦影片、標題、說明、留言都幾乎看不見，背景是黑色。深色與淺色主題各測一次；也開啟 YouTube 自己的劇院模式（播放器加寬）再測一次。
3. 點任何變暗的地方（例如推薦影片）：只關閉劇院模式，不會開啟那部影片。Esc 也會關閉。
4. 若有任何區塊沒有變暗，請記下它在頁面上的位置，並在開發者工具中選取該區塊，回報它與上層幾個元素的 tag 與 id。
