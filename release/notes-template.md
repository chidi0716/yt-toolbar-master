**English** | [繁體中文](#繁體中文)

## How to update

{{firefoxSteps}}

**Chrome (loaded unpacked):** Chrome cannot update this extension by itself.
1. Download `yt-toolbar-master-{{version}}-chrome.zip` below.
2. Unzip it and replace the contents of the folder you loaded before (keep the same folder so your settings are kept).
3. Open `chrome://extensions` and click the reload button on the extension.

**Download helper (yt-dlp, ffmpeg, deno):** updates itself in the background the next time you download (at most once a day). Nothing to do.
First install — paste one line:

- macOS (Terminal): `curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh`
- Windows (PowerShell): `irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex`

See [what gets installed](https://github.com/chidi0716/yt-toolbar-master/blob/{{tag}}/docs/what-gets-installed.md).

## Files

| File | What it is |
|---|---|
| `yt-toolbar-master-{{version}}-chrome.zip` | Chrome extension (load unpacked) |
{{firefoxFiles}}
| `install.sh`, `install.ps1` | One-line installers for the download helper |
| `uninstall.sh`, `uninstall.ps1` | Remove the download helper |
| `yte-host-*` | The helper itself (the installers download it for you) |
| `yt-toolbar-master-host-macos.zip`, `yt-toolbar-master-host-windows.zip` | Manual install (uses yt-dlp, ffmpeg and deno you installed yourself) |
| `components.json` | List of component versions, download addresses and SHA-256 checksums (the helper checks every file against it) |
| `SHA256SUMS` | SHA-256 of every file in this release |

This repository uses GitHub immutable releases: files of a published release cannot be changed or replaced.

---

## 繁體中文

### 如何更新

{{firefoxStepsZh}}

**Chrome（載入未封裝項目）**：Chrome 無法自動更新這個擴充功能。
1. 下載下方的 `yt-toolbar-master-{{version}}-chrome.zip`。
2. 解壓縮，覆蓋你之前載入的資料夾內容（使用同一個資料夾，設定才會保留）。
3. 開啟 `chrome://extensions`，在這個擴充功能上按「重新載入」。

**下載功能的小幫手（yt-dlp、ffmpeg、deno）**：下次下載時會在背景自動更新（每天最多一次），不需要做任何事。
第一次安裝請貼上一行指令：

- macOS（終端機）：`curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh`
- Windows（PowerShell）：`irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex`

說明：[會安裝什麼](https://github.com/chidi0716/yt-toolbar-master/blob/{{tag}}/docs/what-gets-installed.zh-TW.md)。
