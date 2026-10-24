#!/bin/sh
# 手動安裝下載功能的小幫手（macOS，使用者層級，不需要 sudo）。plan 4.8、4.9、008 FR-16。
#
# 一般使用者請改用 README 的一行指令（會一併下載 yt-dlp、ffmpeg、deno）。這個腳本給
# 「自己建置小幫手」或「已經自己裝好 yt-dlp、ffmpeg、deno」的人使用：
#   1. 移除小幫手的隔離屬性，確認可以執行；
#   2. 執行 ytm-host --install --offline：小幫手把自己複製到
#      ~/Library/Application Support/yt-toolbar-master/，寫入 Chrome 與 Firefox 的
#      原生訊息設定檔，並檢查 yt-dlp、ffmpeg、deno（不下載任何東西）。
#
# 用法：sh install.sh [小幫手的路徑]
# 沒有指定路徑時，依序尋找與本腳本同一個資料夾、以及 repo 的 host/dist/ 中
# 符合這台 Mac 架構的 ytm-host-darwin-arm64 或 ytm-host-darwin-amd64。
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

if [ "$(id -u)" = "0" ]; then
  fail "do not run this script with sudo; it installs for the current user only."
fi
if [ "$(uname -s)" != "Darwin" ]; then
  fail "this script is for macOS. On Windows, use install/windows/install.ps1."
fi

# Apple Silicon 上即使在 Rosetta 下執行，也安裝 arm64 版本。
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
  ARCH="arm64"
else
  ARCH="amd64"
fi
BIN_NAME="ytm-host-darwin-$ARCH"

if [ $# -ge 1 ]; then
  SRC="$1"
else
  SRC=""
  for candidate in "$SCRIPT_DIR/$BIN_NAME" "$SCRIPT_DIR/../../host/dist/$BIN_NAME"; do
    if [ -f "$candidate" ]; then
      SRC="$candidate"
      break
    fi
  done
fi
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  fail "could not find $BIN_NAME. Build it with 'npm run build:host' or pass its path: sh install.sh /path/to/$BIN_NAME"
fi

# 從網路下載的檔案帶有隔離屬性，Gatekeeper 會阻擋執行（plan 6 R4）。
chmod 755 "$SRC" 2>/dev/null || true
xattr -d com.apple.quarantine "$SRC" 2>/dev/null || true
if ! "$SRC" --version >/dev/null 2>&1; then
  # 簽章失效時，重新加上本機（ad-hoc）簽章。
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - "$SRC" >/dev/null 2>&1 || true
  fi
  "$SRC" --version >/dev/null 2>&1 || fail "the helper does not run on this Mac ($SRC)."
fi

"$SRC" --install --offline
