#!/bin/sh
# 一行指令安裝下載功能（macOS）。plan 4.9、008 FR-10、FR-11。
#
#   curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.sh | sh
#
# 這個腳本只做三件事，其餘全部由小幫手（ytm-host --install）完成並逐步說明：
#   1. 以 HTTPS 從本專案同一個 GitHub Release（固定版本）下載 components.json 與這台 Mac 的小幫手；
#   2. 確認小幫手的 SHA256 與 components.json 相同；
#   3. 執行小幫手的 --install（小幫手檢查清單，並核對之後每個下載檔案的 SHA256）。
# 本專案不使用自己的簽章（008 FR-51）；repo 開啟 GitHub 的「不可變更版本」，發佈後檔案不能被替換。
# 不需要 sudo，只寫入你的使用者資料夾。發佈流程會把下面的 @RELEASE_TAG@ 換成版本標籤。
set -eu

TAG="@RELEASE_TAG@"
BASE="https://github.com/chidi0716/yt-toolbar-master/releases/download/$TAG"

say() { printf '%s\n' "$1"; }
fail() {
  say ""
  say "失敗 / Failed: $1"
  say "再執行一次同一個指令即可重試。/ Run the same command again to retry."
  exit 1
}

case "$TAG" in
  @*) fail "this script must be downloaded from a GitHub release (the version tag is missing)." ;;
esac
if [ "$(id -u)" = "0" ]; then
  fail "請不要用 sudo 執行。/ Do not run this with sudo; it installs for your account only."
fi
if [ "$(uname -s)" != "Darwin" ]; then
  fail "這個指令只適用於 macOS；Windows 請使用 PowerShell 的指令。/ This command is for macOS. On Windows, use the PowerShell command."
fi

# Apple Silicon 上即使在 Rosetta 下執行，也使用 arm64 版本。
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
  PLATFORM="darwin-arm64"
else
  PLATFORM="darwin-amd64"
fi
HELPER="ytm-host-$PLATFORM"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/ytm-install.XXXXXX") || fail "could not create a temporary folder."
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

download() {
  # --proto =https：只允許 HTTPS（包括轉址）；--fail：伺服器錯誤時失敗。
  curl --proto '=https' --tlsv1.2 -fsSL --retry 2 -o "$TMP/$1" "$BASE/$1" ||
    fail "無法下載 $1，請確認網路連線。/ Could not download $1. Check your internet connection."
}

say "下載功能安裝程式 $TAG / Download helper installer $TAG"
say "從本專案的 GitHub 下載小幫手 / Downloading the helper from this project's GitHub:"
say "  $BASE/"
download components.json
download "$HELPER"

# 從 components.json 取出 helper.<平台>.sha256（不依賴 jq 等額外工具）：
# 去掉空白與換行後，取 "helper":{ 之後第一個 "<平台>":{...} 中的 sha256。
FLAT=$(tr -d ' \t\r\n' < "$TMP/components.json")
ENTRY=$(printf '%s' "$FLAT" | sed -e 's/.*"helper":{//' -e "s/\"$PLATFORM\":{\\([^}]*\\)}.*/@@\\1/" -e 's/.*@@//')
EXPECTED=$(printf '%s' "$ENTRY" | sed -n 's/.*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p')
[ -n "$EXPECTED" ] || fail "components.json 格式不正確。/ components.json is not valid."
ACTUAL=$(shasum -a 256 "$TMP/$HELPER" | awk '{print $1}')
if [ "$ACTUAL" != "$EXPECTED" ]; then
  fail "下載的小幫手與清單不符（SHA256），已停止。/ The downloaded helper does not match the release list (SHA256)."
fi
say "小幫手的 SHA256 相符 / Helper SHA256 verified: $ACTUAL"

chmod 755 "$TMP/$HELPER"
xattr -d com.apple.quarantine "$TMP/$HELPER" 2>/dev/null || true
"$TMP/$HELPER" --install --manifest "$TMP/components.json"
