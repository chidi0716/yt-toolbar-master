#!/bin/sh
# 移除下載功能（macOS）。plan 4.8、4.9、002 FR-77、008 FR-31。
#
#   curl -fsSL https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.sh | sh
#   （或手動安裝的資料夾中：sh uninstall.sh）
#
# 移除安裝時建立的所有檔案：專屬資料夾（小幫手、yt-dlp、deno、ffmpeg、狀態）、
# Chrome 與 Firefox 的原生訊息設定檔、記錄檔。不需要下載小幫手。
# 不會移除已經下載的影片，也不會動到你自己安裝的 yt-dlp、ffmpeg、deno（例如 Homebrew）。
set -eu

NAME="com.chidi0716.youtube_extension"
APP_DIR="$HOME/Library/Application Support/youtube-extension-host"
LOG_DIR="$HOME/Library/Logs/youtube-extension-host"
CHROME_MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$NAME.json"
FIREFOX_MANIFEST="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts/$NAME.json"

if [ "$(id -u)" = "0" ]; then
  echo "請不要用 sudo 執行。/ Do not run this with sudo." >&2
  exit 1
fi

remove() {
  if [ -e "$1" ]; then
    rm -rf -- "$1"
    echo "已移除 / Removed: $1"
  fi
}

remove "$CHROME_MANIFEST"
remove "$FIREFOX_MANIFEST"
remove "$APP_DIR"
remove "$LOG_DIR"

echo "完成。下載功能已移除，已下載的檔案沒有被刪除。/ Done. The download helper was removed; downloaded files were not touched."
