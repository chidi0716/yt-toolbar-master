# What the download helper installs

**English** | [繁體中文](./what-gets-installed.zh-TW.md)

What the one-line install command puts on your computer, where, what it connects to, and how to remove it.

## In short

- Four programs: about 150 MB on macOS, about 300 MB on Windows (the Windows ffmpeg package is larger).
- Everything goes into **one folder in your user account**. No administrator password, no system settings, no changes to `PATH`.
- Programs you installed yourself (for example with Homebrew or winget) are never changed.
- Nothing about you or your downloads is collected or sent anywhere.
- You can remove everything with one click in the settings page.

## The programs

| Program | What it does | Where it comes from |
|---|---|---|
| **Helper** (`ytm-host`) | A small program from this project that lets the browser extension use the programs below. It only accepts a fixed set of commands from this extension, never web addresses or arbitrary commands. | [This project's GitHub releases](https://github.com/chidi0716/yt-toolbar-master/releases) |
| **yt-dlp** | The open-source program that actually downloads videos and audio from YouTube. | [yt-dlp on GitHub](https://github.com/yt-dlp/yt-dlp/releases) (official releases) |
| **ffmpeg** and **ffprobe** | Join the video and audio tracks, convert audio to MP3, add covers and chapters. | macOS: [ffmpeg.martin-riedl.de](https://ffmpeg.martin-riedl.de) · Windows: [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds/releases) (maintained by the yt-dlp team) |
| **deno** | A JavaScript runtime that yt-dlp needs to see all of YouTube's formats. | [deno on GitHub](https://github.com/denoland/deno/releases) (official releases) |

If ffmpeg and ffprobe are already on your computer, the installer uses them instead of downloading another copy.

## How downloads are checked

- Every release of this project includes a list of the exact files to install and their SHA-256 checksums (`components.json`). The helper only accepts this list from this project's GitHub releases, over HTTPS, and refuses a list that is not in the expected format or points anywhere other than the sources above.
- The project's GitHub releases are **immutable**: once a release is published, its files (including the list) cannot be changed or replaced.
- Each downloaded file must match the checksum in that list. Before a release is published, the release process downloads every file and compares it with the checksum published by yt-dlp, deno or the ffmpeg build site.
- Anything that does not match is deleted and the old version is kept.

## Where everything goes

| | macOS | Windows |
|---|---|---|
| Helper, tools, settings | `~/Library/Application Support/yt-toolbar-master/` | `%LOCALAPPDATA%\yt-toolbar-master\` |
| Log file | `~/Library/Logs/yt-toolbar-master/host.log` | `%LOCALAPPDATA%\yt-toolbar-master\logs\host.log` |
| Browser registration | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` and `~/Library/Application Support/Mozilla/NativeMessagingHosts/` (one small file each) | Two registry keys under `HKCU\Software\Google\Chrome\NativeMessagingHosts\` and `HKCU\Software\Mozilla\NativeMessagingHosts\` |

The browser registration tells Chrome and Firefox (and Firefox-based browsers such as Zen) where the helper is, and that **only this extension** can start it.

The log file only contains command names and error messages (never cookies, passwords or account data) and is limited to 5 MB.

## What it connects to, and when

| Who | Connects to | When |
|---|---|---|
| The install command | This project's GitHub releases; the yt-dlp, deno and ffmpeg sources above (GitHub release files are served from `objects.githubusercontent.com` / `release-assets.githubusercontent.com`) | Only while you run it |
| The helper | The same places, to check for and download updates | When you start a download, at most once a day (you can turn this off) |
| yt-dlp | YouTube, to download the video you asked for; GitHub, when it updates itself | When you download |
| The extension | YouTube only. When it was loaded unpacked (Chrome) or as a temporary add-on, it also asks this project's GitHub for the latest version number, at most once a day, without any identifying information | When you open a YouTube video |

No other servers are contacted. There is no analytics, tracking or telemetry. Videos are processed on your computer and never uploaded anywhere.

## Updates

- yt-dlp, deno and the helper update themselves in the background, at most once a day, only when you start a download. The download is not delayed; files are replaced after downloads finish, and the old version is kept if anything goes wrong.
- When YouTube changes and a download fails because yt-dlp is out of date, the helper updates yt-dlp immediately and retries once.
- ffmpeg is not updated automatically; a new helper release can include a newer ffmpeg.
- The settings page (**Downloads**) shows the version and source of each program, the last update check, and lets you turn automatic updates off or check now.

## How to remove it

- **From the extension:** settings page → **Downloads** → **Remove downloads…**. It deletes the folder above (helper, yt-dlp, deno, ffmpeg, log) and the browser registration.
- **Without the extension:**
  - macOS (Terminal): `curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.sh | sh`
  - Windows (PowerShell): `irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.ps1 | iex`

Your downloaded videos and MP3 files are never removed. Programs you installed yourself are not touched.

## Licenses

This project is [MIT licensed](../LICENSE). yt-dlp, deno and ffmpeg are separate programs with their own licenses; see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
