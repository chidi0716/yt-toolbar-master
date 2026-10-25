# Development and maintenance

**English** | [繁體中文](./development.zh-TW.md)

## How downloads work

Browser extensions cannot run yt-dlp directly, so a small helper program (written in Go) is installed on your computer and connected through the browser's Native Messaging API:

```
Toolbar on YouTube  →  extension background  →  local helper  →  yt-dlp  →  ffmpeg
```

Install it once with one command (see [Install the helper](../README.md#install-the-helper)); after that it keeps itself, yt-dlp and deno up to date. Thumbnails, screenshots, subtitles and all viewing tools work without the helper.

## What does the command do?

1. Downloads the helper for your system from this project's [GitHub releases](https://github.com/chidi0716/yt-toolbar-master/releases) and checks its SHA-256 against the release list (`components.json`).
2. The helper checks the release list (it only accepts it from this project's GitHub releases over HTTPS), then downloads:
   - yt-dlp from the [official yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases), checked against the official checksums;
   - deno from the [official deno releases](https://github.com/denoland/deno/releases), checked against the official checksums;
   - ffmpeg and ffprobe from [Martin Riedl's FFmpeg build server](https://ffmpeg.martin-riedl.de) (macOS) or [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) (Windows), checked against the checksums recorded when the release was made. If ffmpeg and ffprobe are already on your computer (for example from Homebrew), they are used instead.
3. Puts everything in `~/Library/Application Support/yt-toolbar-master/` (macOS) or `%LOCALAPPDATA%\yt-toolbar-master\` (Windows) and registers the helper for Chrome and Firefox.

Every downloaded file must match the SHA-256 in the release list, or it is deleted and nothing is replaced.

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

## Manual install

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
   It runs `ytm-host --install --offline`: the helper copies itself to the folder above and registers itself for Chrome and Firefox, without downloading anything, and lists which of yt-dlp, ffmpeg and deno it found.
4. Restart the browser and click **Check again** in the Video or MP3 panel.

To remove a manual install, run `uninstall.sh` or `uninstall.ps1` from the same folder (or the one-line commands above).

## Troubleshooting

- **The panel still says the helper is missing:** restart the browser after installing.
- **The command stops with “Failed”:** read the reason it prints (network, disk space, a file that did not match its checksum). Fix it if needed and run the same command again; it continues where it stopped.
- **“yt-dlp is out of date” or some qualities are missing:** the helper updates yt-dlp automatically; you can also click **Check for updates now** in the settings page. If you use your own yt-dlp (Homebrew or winget), update it with `brew upgrade yt-dlp` or `winget upgrade --id yt-dlp.yt-dlp`.
- **Logs:** `~/Library/Logs/yt-toolbar-master/host.log` (macOS) or `%LOCALAPPDATA%\yt-toolbar-master\logs\host.log` (Windows). They contain command names and error messages only, never cookies or account data.
- Downloads keep running if you close the YouTube tab or the browser. Unfinished files are kept in a hidden `.ytm-tmp-…` folder inside the download folder and are removed when the download finishes, fails or is cancelled.

**What the helper can do:** only the fixed commands the extension needs (check status, read video info, download, cancel, list downloads, show a file, choose a folder, update, uninstall). Only this extension can start it (`allowed_origins` / `allowed_extensions` in the registration). It accepts a YouTube video ID, never a URL or command-line options, and opens no network ports. yt-dlp talks to YouTube; the helper itself only connects to GitHub and the ffmpeg build site listed above, to install and update.

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

Ready-made packages are on the [releases page](https://github.com/chidi0716/yt-toolbar-master/releases): `yt-toolbar-master-<version>-chrome.zip` and `yt-toolbar-master-<version>-firefox.xpi` (a release that is not signed by Mozilla yet has `yt-toolbar-master-<version>-firefox-temporary.zip` instead, which Firefox can only load as a temporary add-on). To use your own build, use `.output/chrome-mv3` or `.output/firefox-mv3` instead.

- **Chrome:** unzip the Chrome package to a folder you keep, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose that folder (or `.output/chrome-mv3`). Chrome cannot update it by itself; when a new version is out the extension shows a reminder. To update, unzip the new package over the same folder and click the reload button in `chrome://extensions`.
- **Firefox (development):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and choose `.output/firefox-mv3/manifest.json`. Temporary add-ons are removed when Firefox restarts.
- **Firefox (permanent, Firefox 140 or later):** release builds of Firefox only install add-ons signed by Mozilla, so the extension is signed through the *unlisted* channel of addons.mozilla.org (it is not published on the AMO website). Open the signed `.xpi` file in Firefox (or drag it onto a Firefox window) and confirm the install prompt. Signed releases update themselves (`about:addons` → gear icon → **Check for Updates** to update now).

### Signing the Firefox build (maintainers)

1. Create an API key at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Export it as environment variables (never commit it or put it in a config file):
   ```bash
   export WEB_EXT_API_KEY=user:12345:67
   export WEB_EXT_API_SECRET=...
   ```
3. Commit your changes, then run `npm run sign:firefox`. It builds `.output/firefox-mv3`, packs the source code of the current commit into `.output/firefox-sources.zip` with `git archive` (without `node_modules`, `.output`, `host/dist` and `spikes`), and runs `web-ext sign --channel unlisted --upload-source-code`. The signed `.xpi` is saved to `.output/firefox-signed/`. Add `-- --dry-run` to create the source archive and print the command without submitting.

### Releases (maintainers)

Pushing a `v*` tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml). It runs the tests, builds the extension and the three helpers, checks every third-party file against [`release/components.lock.json`](../release/components.lock.json) and the official checksums, writes `components.json` (the address and SHA-256 of every file), and creates the GitHub release with the install scripts, helpers, `components.json`, the Chrome zip, the Firefox package and `SHA256SUMS`. When the Mozilla API key is set, the Firefox build is signed by Mozilla (unlisted channel) and `updates.json` (Firefox auto-update) is added. Tags with a `-` (for example `v0.2.0-beta.1`) become prereleases: they are never “latest”, so they trigger no update reminders or automatic updates, and their Firefox build is not sent for signing (Mozilla signs each version number only once).

This project does not use a signing key of its own. The helper only accepts `components.json` from this project's GitHub releases over HTTPS and checks every file it downloads against the SHA-256 in it.

#### First-time setup

1. Try everything locally: `npm run release:dry` (output in `release/dist/`; the Firefox package is not signed).
2. Create the first release (below). No secrets are needed: without the Mozilla API key, the release gets an unsigned `yt-toolbar-master-<version>-firefox-temporary.zip` (Firefox can only load it as a temporary add-on), no `updates.json`, and a note in the release text.

**Later (optional): Mozilla signing for Firefox.** Create an API key at <https://addons.mozilla.org/developers/addon/api/key/> and add it as repository secrets (**Settings → Secrets and variables → Actions → New repository secret**): `AMO_JWT_ISSUER` (“JWT issuer”) and `AMO_JWT_SECRET` (“JWT secret”). From the next release on, the `.xpi` is signed and Firefox update by themselves.

#### Making a release

1. Update `version` in `package.json` (for example `0.2.0`) and commit.
2. Optionally update the pinned third-party versions in `release/components.lock.json` (see [`specs/notes/ffmpeg-source.md`](../specs/notes/ffmpeg-source.md)) and check them with `cd host && go run ./cmd/ytm-release lock-check -download`.
3. Either push a tag (`git tag v0.2.0 && git push origin v0.2.0`; it must match `package.json`), or push to the `release` branch (`git push origin main:release`); the workflow then creates the tag `v<package.json version>` itself.
4. After the workflow finishes, check the release page. Signed Firefox installs get the new version automatically; Chrome users (and temporary Firefox add-ons) get a reminder in the extension with a link to the release.

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
| [`specs/constitution.md`](../specs/constitution.md) | Project principles |
| [`specs/CLEANROOM.md`](../specs/CLEANROOM.md) | Clean-room process and records |
| [`specs/001-toolbar`](../specs/001-toolbar/spec.md) | Toolbar shell |
| [`specs/002-downloads`](../specs/002-downloads/spec.md) | Download tools |
| [`specs/003-viewing-tools`](../specs/003-viewing-tools/spec.md) | Viewing tools |
| [`specs/004-convenience`](../specs/004-convenience/spec.md) | Quality lock, embedding, clip downloads, timestamp links |
| [`specs/005-page-tidy`](../specs/005-page-tidy/spec.md) | Page tidy options in the settings page |
| [`specs/006-toolbar-customization`](../specs/006-toolbar-customization/spec.md) | Customize which tools the toolbar shows and their order |
| [`specs/007-ui-language`](../specs/007-ui-language/spec.md) | Choose the interface language in the settings page |
| [`specs/008-install-and-update`](../specs/008-install-and-update/spec.md) | One-line install, automatic updates and update reminders |
| [`specs/009-quick-download`](../specs/009-quick-download/spec.md) | One-click and right-click downloads |
| [`docs/what-gets-installed.md`](./what-gets-installed.md) | What the download helper installs, where, and what it connects to |
| [`specs/plan.md`](../specs/plan.md) / [`specs/tasks.md`](../specs/tasks.md) | Technical plan and tasks |
| [`specs/ROADMAP.md`](../specs/ROADMAP.md) | Future directions |
| [`specs/BACKLOG.md`](../specs/BACKLOG.md) | Feature ideas not yet specified |
| [`specs/e2e-checklist.md`](../specs/e2e-checklist.md) | Manual test checklist |

Specs are written in Traditional Chinese.
