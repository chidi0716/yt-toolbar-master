# YT Toolbar Master

**English** | [繁體中文](./README.zh-TW.md)

A toolbar under the YouTube player for Chrome and Firefox: one-click downloads and viewing tools.

> **Status: beta.** Please [report problems](https://github.com/chidi0716/yt-toolbar-master/issues/new/choose).

## Features

**Downloads**
- **One-click video and MP3:** click **Video** or **MP3** and the download starts in your default quality (1080p MP4, 192 kbps MP3; changeable in settings).
- **Right-click download** on any video link on YouTube.
- Full quality list (up to 8K), time range, embedded cover and chapters.
- **Thumbnails, subtitles (SRT / VTT / TXT) and screenshots** — no helper needed.

**Viewing tools**
- Dark mode, cinema mode, picture-in-picture, floating player, A–B loop
- Quality lock, audio-only mode, mouse-wheel volume, pause on tab switch, copy link with time

**Page tidy** (settings page)
- Original audio instead of AI dubs, hide end cards, dismiss “Continue watching?”, Shorts in the normal player, and more

You can choose which tools the toolbar shows and their order. Interface in English and Traditional Chinese.

## Install

### 1. Install the extension

Download the latest files from [Releases](https://github.com/chidi0716/yt-toolbar-master/releases/latest).

**Chrome**
1. Unzip `yt-toolbar-master-<version>-chrome.zip` into a folder you keep.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder.

**Firefox**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `yt-toolbar-master-<version>-firefox-temporary.zip`.

In this beta, Firefox removes the add-on when it restarts.

<a id="install-the-helper"></a>
### 2. Set up video and MP3 downloads

Needed only for video and MP3. One command installs [yt-dlp](https://github.com/yt-dlp/yt-dlp), [ffmpeg](https://ffmpeg.org), [deno](https://deno.com) and a small helper into your user folder (about 150 MB on macOS, 300 MB on Windows). No administrator rights needed. They update themselves. Details: [what gets installed](./docs/what-gets-installed.md).

**macOS**
1. Press ⌘ + Space, type **Terminal** and press Enter.
2. Paste this line and press Enter:
   ```bash
   curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh
   ```
3. When you see **Done!**, go back to the browser and click **Video** or **MP3** again.

**Windows**
1. Press the Start key, type **PowerShell** and open it.
2. Paste this line and press Enter:
   ```powershell
   irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex
   ```
3. When you see **Done!**, go back to the browser and click **Video** or **MP3** again.

The Video and MP3 panels show the same command with a **Copy** button.

### Update

- **Chrome:** unzip the new version over the same folder, then click the reload button in `chrome://extensions`. A reminder appears under the toolbar when a new version is out.
- **Downloads:** updates itself.

### Uninstall

Settings page → **Downloads** → **Remove downloads…**. Downloaded files are kept.

## FAQ

**The panel still says the helper is missing.** Restart the browser and click **Check again**.

**“Please update yt-dlp.”** The helper updates yt-dlp and retries by itself. If it still fails, click **Update yt-dlp** in the panel.

**macOS says “Python.framework is damaged”.** This happens with the helper from version 0.1.0. Run the install command again.

**Which videos can't be downloaded?** Members-only, private and sign-in-required videos.

## Privacy

- No analytics or tracking. The extension talks only to YouTube and the local helper, plus this project's GitHub once a day to check for a new version (can be turned off).
- Everything is processed on your computer.

## More

- [Development, manual install and releases](./docs/development.md)
- [Specs](./specs/) (Traditional Chinese)
- Use this extension only for content you have the right to download. YouTube's Terms of Service restrict downloading.

## License

[MIT](./LICENSE). yt-dlp, ffmpeg and deno keep their own licenses: see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
