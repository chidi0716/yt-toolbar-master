# YT Toolbar Master

**English** | [繁體中文](./README.zh-TW.md)

A YouTube browser extension that adds a native-looking toolbar under the video player, with download tools and viewing tools. Built with [WXT](https://wxt.dev) + TypeScript for Chrome and Firefox (Firefox-based browsers such as Zen are treated as Firefox).

> **Status:** all planned features are implemented and are waiting for hands-on testing on macOS, Windows, Chrome and Firefox/Zen (see the [test checklist](./specs/e2e-checklist.md)).

## Features

A toolbar appears between the player and the video title on watch pages. It follows YouTube's light or dark look, can be hidden with ✕ (turn it back on from the extension's popup), and every panel can be pinned. You can choose which tools appear and in what order (“More” → “Edit toolbar”, or in the settings page); hidden tools stay available from the “More” menu.

**Download tools**

- **Video:** a quality list from high to low (8K / 4K / 2K / 1080 / HD labels) with file sizes, as MP4 by default and WEBM under “Show more formats”. 2K and above, which YouTube has no H.264 version of, use AV1 (or VP9) inside MP4 and are marked “May not play in some players”.
- **MP3:** 64–320 kbps (remembers your choice).
- **Time range** for video and MP3: download only a part, with a range slider, start/end fields, “Sync with player” and “Set to current time”.
- Cover, title, channel, upload date, link and chapters are embedded into videos and MP3 (can be turned off).
- Progress on the toolbar button, speed and time left in the panel, cancel, retry, clear error messages, a notification when finished (click it to show the file), and downloads keep running if you close the tab or the browser.
- **Thumbnails** (only sizes that really exist), **subtitles** (uploaded and auto-generated, as SRT / VTT / TXT) and **screenshots** of the current frame work without the helper and are saved to the browser's download folder. When a direct subtitle download fails, yt-dlp is used instead.
- Videos, MP3 and subtitles that go through yt-dlp are saved to a folder you choose in the settings page, with a file name format of your choice.

Video and MP3 downloads use [yt-dlp](https://github.com/yt-dlp/yt-dlp), [ffmpeg](https://ffmpeg.org) and [deno](https://deno.com) on your computer through a small helper program; see [Install the helper](#install-the-helper).

**Viewing tools**

- Dark mode (switches YouTube's own appearance setting), cinema mode (dims everything except the player and the toolbar), picture-in-picture
- Floating player while scrolling (drag it to any corner), A–B loop or repeat N times
- Pause on tab switch, autoplay toggle, audio-only mode, mouse-wheel volume, hide comments
- Lock the playback quality (for example always 1080p, unless you change it by hand)
- Copy a `youtu.be` link with or without the current time, or as Markdown

**Page tidy** (in the settings page, works on all YouTube pages even when the toolbar is hidden)

- Always play the original audio instead of an AI dub; hide end cards and the end screen
- Dismiss “Continue watching?”; turn off thumbnail previews
- Open Shorts in the normal player; hide Shorts; show full video titles

## Privacy and security

- No analytics or tracking. The extension only talks to YouTube and to the local helper program. When it is loaded unpacked (Chrome) or as a temporary add-on, it also asks this project's GitHub for the latest version number, at most once a day and without any identifying information, so it can remind you to update; you can turn the reminder off.
- The helper and its installer only connect to this project's GitHub releases, the official yt-dlp and deno releases, and the ffmpeg build sites listed in [what gets installed](./docs/what-gets-installed.md); yt-dlp connects to YouTube.
- No remote code: everything is bundled; no CDN scripts, no `eval`.
- Minimal permissions; content scripts run on `youtube.com` only.
- Video processing happens locally. Nothing is uploaded to third-party services.

See [`specs/constitution.md`](./specs/constitution.md) for the full set of principles.

## How downloads work

Browser extensions cannot run yt-dlp directly, so a small helper program (written in Go) is installed on your computer and connected through the browser's Native Messaging API:

```
Toolbar on YouTube  →  extension background  →  local helper  →  yt-dlp  →  ffmpeg
```

Install it once with one command (see [Install the helper](#install-the-helper)); after that it keeps itself, yt-dlp and deno up to date. Thumbnails, screenshots, subtitles and all viewing tools work without the helper.

## Install the helper

Video and MP3 downloads (and subtitles, when the direct download fails) need four programs on your computer: the **helper** from this project, [yt-dlp](https://github.com/yt-dlp/yt-dlp) (the open-source video downloader), [ffmpeg](https://ffmpeg.org) (merges video and audio, converts to MP3) and [deno](https://deno.com) (the JavaScript runtime yt-dlp needs). Thumbnails, screenshots, subtitles and all viewing tools work without them.

One command installs everything, about 150 MB (about 300 MB on Windows), in a single folder in your user account. No administrator rights, `sudo` or developer tools are needed, nothing outside your user folder is changed, and you can remove it at any time. See [what gets installed](./docs/what-gets-installed.md) for every file, download source and network connection.

### macOS (Apple Silicon and Intel)

1. Press ⌘ + Space, type **Terminal** and press Enter.
2. Paste this line and press Enter:
   ```bash
   curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh
   ```
3. When you see **Done!**, go back to the browser. The Video and MP3 panels switch to the download view by themselves.

### Windows 10/11 (x64)

1. Press the Start key, type **PowerShell** and open it.
2. Paste this line and press Enter:
   ```powershell
   irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex
   ```
3. When you see **Done!**, go back to the browser. The Video and MP3 panels switch to the download view by themselves.

The same command and steps are shown in the extension's Video and MP3 panels and in the settings page.

### What does the command do?

1. Downloads the helper for your system from this project's [GitHub releases](https://github.com/chidi0716/yt-toolbar-master/releases) and checks its SHA-256 against the release list (`components.json`).
2. The helper checks the release list (it only accepts it from this project's GitHub releases over HTTPS), then downloads:
   - yt-dlp from the [official yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases), checked against the official checksums;
   - deno from the [official deno releases](https://github.com/denoland/deno/releases), checked against the official checksums;
   - ffmpeg and ffprobe from [Martin Riedl's FFmpeg build server](https://ffmpeg.martin-riedl.de) (macOS) or [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) (Windows), checked against the checksums recorded when the release was made. If ffmpeg and ffprobe are already on your computer (for example from Homebrew), they are used instead.
3. Puts everything in `~/Library/Application Support/youtube-extension-host/` (macOS) or `%LOCALAPPDATA%\youtube-extension-host\` (Windows) and registers the helper for Chrome and Firefox (including Zen).

Every downloaded file must match the SHA-256 in the release list, or it is deleted and nothing is replaced. The project's releases are immutable on GitHub: once published, their files cannot be changed.

Every step is printed as it happens. Running the command again only repairs or updates what is needed; if a step fails, it prints the reason and running the same command again continues from there. Programs you installed yourself (for example yt-dlp from Homebrew) are never changed; the helper prefers its own copies, and the settings page shows which copy is used.

**Prefer to read the script first?** Download it, read it, then run it:

```bash
curl -fsSL -o install.sh https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh
less install.sh
sh install.sh
```

```powershell
irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 -OutFile install.ps1
notepad install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Automatic updates

- **yt-dlp, deno and the helper** update themselves in the background when you start a download, at most once a day (no download, no check). The download you started is not delayed; replacements happen after downloads finish, and the old version is kept if anything fails. yt-dlp is updated with its own `yt-dlp -U`, everything else is checked against the signed release list.
- When YouTube changes and a download fails with “Please update yt-dlp”, the helper updates yt-dlp right away and retries the download once.
- ffmpeg is not updated automatically (it rarely needs to be); a new helper release can bring a newer one.
- You can turn automatic updates off, check now, and see the version and source of every component in the settings page (**Downloads**).

### Uninstall

Use **Remove download feature** in the settings page (**Downloads**). It removes the folder above (helper, yt-dlp, deno, ffmpeg, logs) and the browser registration. Your downloaded files are not touched.

If the extension is already gone, run:

```bash
curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.sh | sh
```

```powershell
irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.ps1 | iex
```

### Manual install

If you prefer to install yt-dlp, ffmpeg and deno yourself, or to build the helper from source:

1. Install the tools, for example with [Homebrew](https://brew.sh) (`brew install yt-dlp ffmpeg deno`) or [winget](https://learn.microsoft.com/windows/package-manager/winget/) (`winget install yt-dlp.yt-dlp Gyan.FFmpeg DenoLand.Deno`).
2. Get the helper: download `yt-toolbar-master-host-macos.zip` or `yt-toolbar-master-host-windows.zip` from the [releases page](https://github.com/chidi0716/yt-toolbar-master/releases) and unzip it, or build it with [Go](https://go.dev/dl/) 1.24+ and Node.js: `npm run build:host` (output in `host/dist/`).
3. Run the script in that folder (no `sudo`):
   ```bash
   sh install.sh
   ```
   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```
   It runs `yte-host --install --offline`: the helper copies itself to the folder above and registers itself for Chrome and Firefox, without downloading anything, and lists which of yt-dlp, ffmpeg and deno it found.
4. Restart the browser and click **Check again** in the Video or MP3 panel.

To remove a manual install, run `uninstall.sh` or `uninstall.ps1` from the same folder (or the one-line commands above).

### Troubleshooting

- **The panel still says the helper is missing:** restart the browser after installing. Firefox-based browsers such as Zen use the Firefox registration.
- **The command stops with “Failed”:** read the reason it prints (network, disk space, a file that did not match its checksum). Fix it if needed and run the same command again; it continues where it stopped.
- **“yt-dlp is out of date” or some qualities are missing:** the helper updates yt-dlp automatically; you can also click **Check for updates now** in the settings page. If you use your own yt-dlp (Homebrew or winget), update it with `brew upgrade yt-dlp` or `winget upgrade --id yt-dlp.yt-dlp`.
- **Logs:** `~/Library/Logs/youtube-extension-host/host.log` (macOS) or `%LOCALAPPDATA%\youtube-extension-host\logs\host.log` (Windows). They contain command names and error messages only, never cookies or account data.
- Downloads keep running if you close the YouTube tab or the browser. Unfinished files are kept in a hidden `.yte-tmp-…` folder inside the download folder and are removed when the download finishes, fails or is cancelled.

**What the helper can do:** only the fixed commands the extension needs (check status, read video info, download, cancel, list downloads, show a file, choose a folder, update, uninstall). Only this extension may start it (`allowed_origins` / `allowed_extensions` in the registration). It accepts a YouTube video ID, never a URL or command-line options, and opens no network ports. yt-dlp talks to YouTube; the helper itself only connects to GitHub and the ffmpeg build site listed above, to install and update.

## FAQ

**Downloads suddenly fail with “YouTube has changed. Please update yt-dlp.”**
YouTube changes often and yt-dlp follows quickly. With the one-line install, the helper updates yt-dlp and retries automatically; if it still fails, click **Update yt-dlp** in the panel or in the settings page. If you use your own yt-dlp from Homebrew or winget, run the command it shows (`brew upgrade yt-dlp` or `winget upgrade --id yt-dlp.yt-dlp`).

**The panel says only deno is missing. Can I still download?**
Yes. Without deno, yt-dlp may not see some YouTube formats (often the highest qualities). Run the [one-line install command](#install-the-helper) again (it adds what is missing), or install it yourself with `brew install deno` or `winget install DenoLand.Deno`, then click **Check again**.

**macOS says the helper “cannot be opened” or is from an unidentified developer (Gatekeeper).**
Files downloaded by `curl` in Terminal are not marked as coming from the internet, so the one-line install does not trigger this. If you installed manually from a zip downloaded in the browser, run `sh install.sh` from that folder again (it removes the quarantine attribute), or use the one-line install. Do not use `sudo`.

**Zen (or another Firefox-based browser) cannot find the helper.**
The installer registers the helper for Firefox, which Zen normally reads. Restart Zen completely after installing and click **Check again**. If it still says the helper isn't connected, please open an issue with your Zen version, your macOS or Windows version, and whether `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.chidi0716.youtube_extension.json` (macOS) exists. Messages starting with `[yt-toolbar-master]` in the extension's console (open `about:debugging`, find the extension, click **Inspect**) also help.

**Downloads fail with “Couldn't write to the download folder.”**
The folder chosen in the settings page was moved or deleted, the disk is full, or the folder isn't writable. Choose another folder or click **Use default** in the settings page. On macOS, folders such as Desktop or Documents may need permission: if a prompt asks to allow access, allow it.

**The extension disappeared from Firefox after a restart.**
Add-ons loaded from `about:debugging` are temporary and are removed when Firefox restarts. Install the signed `.xpi` from the [releases page](https://github.com/chidi0716/yt-toolbar-master/releases) instead (see [Load the extension manually](#load-the-extension-manually)); it also updates itself.

## Development

```bash
npm install
npm run dev           # Chrome, with auto-reload
npm run dev:firefox   # Firefox
```

## Build

```bash
npm run compile         # type check
npm test                # unit tests (Vitest)
npm run build           # Chrome  → .output/chrome-mv3
npm run build:firefox   # Firefox → .output/firefox-mv3
npm run build:host      # local helper → host/dist/ (macOS arm64/amd64, Windows amd64; requires Go)
npm run zip
npm run zip:firefox
npm run sign:firefox    # Firefox → signed .xpi in .output/firefox-signed (see below)
npm run release:dry     # all release files, without secrets → release/dist (see Releases)
```

## Load the extension manually

Ready-made packages are on the [releases page](https://github.com/chidi0716/yt-toolbar-master/releases): `yt-toolbar-master-<version>-chrome.zip` and `yt-toolbar-master-<version>-firefox.xpi` (a release that is not signed by Mozilla yet has `yt-toolbar-master-<version>-firefox-temporary.zip` instead, which Firefox and Zen can only load as a temporary add-on). To use your own build, use `.output/chrome-mv3` or `.output/firefox-mv3` instead.

- **Chrome:** unzip the Chrome package to a folder you keep, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose that folder (or `.output/chrome-mv3`). Chrome cannot update it by itself; when a new version is out the extension shows a reminder. To update, unzip the new package over the same folder and click the reload button in `chrome://extensions`.
- **Firefox (development):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and choose `.output/firefox-mv3/manifest.json`. Temporary add-ons are removed when Firefox restarts.
- **Firefox (permanent, Firefox 140 or later, including Zen):** release builds of Firefox only install add-ons signed by Mozilla, so the extension is signed through the *unlisted* channel of addons.mozilla.org (it is not published on the AMO website). Open the signed `.xpi` file in Firefox (or drag it onto a Firefox window) and confirm the install prompt. Signed releases update themselves (`about:addons` → gear icon → **Check for Updates** to update now).

### Signing the Firefox build (maintainers)

1. Create an API key at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Export it as environment variables (never commit it or put it in a config file):
   ```bash
   export WEB_EXT_API_KEY=user:12345:67
   export WEB_EXT_API_SECRET=...
   ```
3. Commit your changes, then run `npm run sign:firefox`. It builds `.output/firefox-mv3`, packs the source code of the current commit into `.output/firefox-sources.zip` with `git archive` (without `node_modules`, `.output`, `host/dist` and `spikes`), and runs `web-ext sign --channel unlisted --upload-source-code`. The signed `.xpi` is saved to `.output/firefox-signed/`. Add `-- --dry-run` to create the source archive and print the command without submitting.

### Releases (maintainers)

Pushing a `v*` tag runs [`.github/workflows/release.yml`](./.github/workflows/release.yml). It runs the tests, builds the extension and the three helpers, checks every third-party file against [`release/components.lock.json`](./release/components.lock.json) and the official checksums, writes `components.json` (the address and SHA-256 of every file), and creates the GitHub release with the install scripts, helpers, `components.json`, the Chrome zip, the Firefox package and `SHA256SUMS`. When the Mozilla API key is set, the Firefox build is signed by Mozilla (unlisted channel) and `updates.json` (Firefox auto-update) is added. Tags with a `-` (for example `v0.2.0-beta.1`) become prereleases: they are never “latest”, so they trigger no update reminders or automatic updates, and their Firefox build is not sent for signing (Mozilla signs each version number only once).

This project does not use a signing key of its own. The helper only accepts `components.json` from this project's GitHub releases over HTTPS and checks every file it downloads against the SHA-256 in it; with immutable releases turned on, files of a published release cannot be changed or replaced.

#### First-time setup

1. **Turn on immutable releases:** repository **Settings → General**, in the **Releases** section enable immutable releases. Published releases (and their files) can then no longer be modified.
2. Try everything locally: `npm run release:dry` (output in `release/dist/`; the Firefox package is not signed).
3. Create the first release (below). No secrets are needed: without the Mozilla API key, the release gets an unsigned `yt-toolbar-master-<version>-firefox-temporary.zip` (Firefox/Zen can only load it as a temporary add-on), no `updates.json`, and a note in the release text.

**Later (optional): Mozilla signing for Firefox/Zen.** Create an API key at <https://addons.mozilla.org/developers/addon/api/key/> and add it as repository secrets (**Settings → Secrets and variables → Actions → New repository secret**): `AMO_JWT_ISSUER` (“JWT issuer”) and `AMO_JWT_SECRET` (“JWT secret”). From the next release on, the `.xpi` is signed and Firefox/Zen update by themselves.

#### Making a release

1. Update `version` in `package.json` (for example `0.2.0`) and commit.
2. Optionally update the pinned third-party versions in `release/components.lock.json` (see [`specs/notes/ffmpeg-source.md`](./specs/notes/ffmpeg-source.md)) and check them with `cd host && go run ./cmd/yte-release lock-check -download`.
3. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`. The tag must match `package.json`.
4. After the workflow finishes, check the release page. Signed Firefox/Zen installs get the new version automatically; Chrome users (and temporary Firefox add-ons) get a reminder in the extension with a link to the release.

### Building from source (for add-on reviewers)

The Firefox build is bundled and minified by [WXT](https://wxt.dev)/Vite. To reproduce it from the uploaded source archive:

- Environment: Linux, macOS or Windows with Node.js 22 (npm 10). No other tools are needed for the extension itself.
- Commands:
  ```bash
  npm ci
  npm run build:firefox
  ```
- Output: `.output/firefox-mv3/`, the same files as the submitted package.

## Project documents

This project follows spec-driven development and a clean-room process:

| Document | Content |
|---|---|
| [`specs/constitution.md`](./specs/constitution.md) | Project principles |
| [`specs/CLEANROOM.md`](./specs/CLEANROOM.md) | Clean-room process and records |
| [`specs/001-toolbar`](./specs/001-toolbar/spec.md) | Toolbar shell |
| [`specs/002-downloads`](./specs/002-downloads/spec.md) | Download tools |
| [`specs/003-viewing-tools`](./specs/003-viewing-tools/spec.md) | Viewing tools |
| [`specs/004-convenience`](./specs/004-convenience/spec.md) | Quality lock, embedding, clip downloads, timestamp links |
| [`specs/005-page-tidy`](./specs/005-page-tidy/spec.md) | Page tidy options in the settings page |
| [`specs/006-toolbar-customization`](./specs/006-toolbar-customization/spec.md) | Customize which tools the toolbar shows and their order |
| [`specs/007-ui-language`](./specs/007-ui-language/spec.md) | Choose the interface language in the settings page |
| [`specs/008-install-and-update`](./specs/008-install-and-update/spec.md) | One-line install, automatic updates and update reminders |
| [`docs/what-gets-installed.md`](./docs/what-gets-installed.md) | What the download helper installs, where, and what it connects to |
| [`specs/plan.md`](./specs/plan.md) / [`specs/tasks.md`](./specs/tasks.md) | Technical plan and tasks |
| [`specs/ROADMAP.md`](./specs/ROADMAP.md) | Future directions |
| [`specs/BACKLOG.md`](./specs/BACKLOG.md) | Feature ideas not yet specified |
| [`specs/e2e-checklist.md`](./specs/e2e-checklist.md) | Manual test checklist |

Specs are written in Traditional Chinese.

## Disclaimer

Downloading YouTube content may violate YouTube's Terms of Service. Use this extension only for content you have the right to download, for personal use. Because Chrome Web Store does not allow YouTube downloaders, the extension is meant to be loaded manually.

## License

[MIT](./LICENSE) © chidi0716.

The download helper installs third-party programs from their official sources: yt-dlp ([Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE); the standalone executables are GPLv3+), deno ([MIT](https://github.com/denoland/deno/blob/main/LICENSE.md)) and ffmpeg ([GPL builds](https://ffmpeg.org/legal.html)). They are not part of this project and keep their own licenses. See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) for these programs and for the open-source code bundled in the extension and the helper.
