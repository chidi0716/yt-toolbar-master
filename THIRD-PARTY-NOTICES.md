# Third-party notices

**English** | [繁體中文](#繁體中文)

This project is licensed under the [MIT License](./LICENSE). It uses the following third-party software.

## Programs installed by the download helper

The one-line installer downloads these programs from their official sources and verifies their checksums. This project does not modify or redistribute them; each keeps its own license.

| Program | Used for | Source | License |
|---|---|---|---|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Downloading videos and audio | [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) | yt-dlp itself is released under [The Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE). The installer uses the official builds (macOS: the unpacked `yt-dlp_macos.zip`; Windows: `yt-dlp.exe`), which bundle Python and other libraries; according to yt-dlp, these bundles include GPLv3+ code, so the combined builds are GPLv3+. Details: [THIRD_PARTY_LICENSES.txt](https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt). |
| [deno](https://deno.com) | JavaScript runtime that yt-dlp needs for YouTube | [deno releases](https://github.com/denoland/deno/releases) | [MIT](https://github.com/denoland/deno/blob/main/LICENSE.md) |
| [FFmpeg](https://ffmpeg.org) (`ffmpeg`, `ffprobe`) | Merging video and audio, converting to MP3, embedding covers and chapters | macOS: [Martin Riedl's FFmpeg Build Server](https://ffmpeg.martin-riedl.de); Windows: [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) | GNU GPL: both are GPL builds of FFmpeg (they include GPL-licensed libraries such as x264). See [FFmpeg legal](https://ffmpeg.org/legal.html) and the build sites for the exact license and the corresponding source code. |

If ffmpeg (or yt-dlp, or deno) is already installed on your computer, for example with Homebrew or winget, the helper uses that copy under its own license.

## Code included in the helper (`ytm-host`)

| Component | License |
|---|---|
| [Go](https://go.dev) standard library and runtime | [BSD-3-Clause](https://go.dev/LICENSE) |
| [golang.org/x/sys](https://pkg.go.dev/golang.org/x/sys) (Windows only) | [BSD-3-Clause](https://cs.opensource.google/go/x/sys/+/master:LICENSE) |

## Code and assets included in the extension

| Component | License |
|---|---|
| [Preact](https://preactjs.com) | [MIT](https://github.com/preactjs/preact/blob/main/LICENSE) |
| [Material Symbols](https://github.com/google/material-design-icons) (`@material-symbols/svg-400`, icons bundled as SVG) | [Apache-2.0](https://github.com/google/material-design-icons/blob/master/LICENSE) |
| [WXT](https://wxt.dev) runtime helpers (`wxt`, `@wxt-dev/storage`, `@wxt-dev/browser`) | [MIT](https://github.com/wxt-dev/wxt/blob/main/LICENSE) |

Build and test tools (TypeScript, Vite, Vitest, web-ext) are used only during development and are not included in the extension.

---

## 繁體中文

本專案採用 [MIT 授權](./LICENSE)，並使用下列第三方軟體。

### 下載功能安裝的程式

一行指令從各程式的官方來源下載並核對檢查碼；本專案不修改、也不轉存這些程式，它們各自保有自己的授權。

| 程式 | 用途 | 來源 | 授權 |
|---|---|---|---|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 下載影片與音訊 | [yt-dlp 正式版本](https://github.com/yt-dlp/yt-dlp/releases) | yt-dlp 本身採用 [The Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE)。安裝程式使用官方的建置版本（macOS：未封裝版本 `yt-dlp_macos.zip`；Windows：`yt-dlp.exe`），其中打包了 Python 等程式庫；依 yt-dlp 的說明，這些版本包含 GPLv3+ 的程式碼，因此整體為 GPLv3+。詳見 [THIRD_PARTY_LICENSES.txt](https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt)。 |
| [deno](https://deno.com) | yt-dlp 讀取 YouTube 需要的 JavaScript 執行環境 | [deno 正式版本](https://github.com/denoland/deno/releases) | [MIT](https://github.com/denoland/deno/blob/main/LICENSE.md) |
| [FFmpeg](https://ffmpeg.org)（`ffmpeg`、`ffprobe`） | 合併影音、轉 MP3、嵌入封面與章節 | macOS：[Martin Riedl 的 FFmpeg Build Server](https://ffmpeg.martin-riedl.de)；Windows：[yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) | GNU GPL：兩者都是 FFmpeg 的 GPL 版本（包含 x264 等 GPL 授權的程式庫）。確切的授權與對應的原始碼見 [FFmpeg 授權說明](https://ffmpeg.org/legal.html) 與各建置網站。 |

電腦上已經有 ffmpeg（或 yt-dlp、deno，例如以 Homebrew 或 winget 安裝）時，小幫手會沿用那一份，依其原本的授權使用。

### 小幫手（`ytm-host`）中包含的程式碼

| 元件 | 授權 |
|---|---|
| [Go](https://go.dev) 標準函式庫與執行環境 | [BSD-3-Clause](https://go.dev/LICENSE) |
| [golang.org/x/sys](https://pkg.go.dev/golang.org/x/sys)（只有 Windows 版） | [BSD-3-Clause](https://cs.opensource.google/go/x/sys/+/master:LICENSE) |

### 擴充功能中包含的程式碼與素材

| 元件 | 授權 |
|---|---|
| [Preact](https://preactjs.com) | [MIT](https://github.com/preactjs/preact/blob/main/LICENSE) |
| [Material Symbols](https://github.com/google/material-design-icons)（`@material-symbols/svg-400`，以 SVG 打包的圖示） | [Apache-2.0](https://github.com/google/material-design-icons/blob/master/LICENSE) |
| [WXT](https://wxt.dev) 的執行期工具（`wxt`、`@wxt-dev/storage`、`@wxt-dev/browser`） | [MIT](https://github.com/wxt-dev/wxt/blob/main/LICENSE) |

建置與測試工具（TypeScript、Vite、Vitest、web-ext）只在開發時使用，不包含在擴充功能中。
