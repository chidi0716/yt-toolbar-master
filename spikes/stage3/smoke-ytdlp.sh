#!/usr/bin/env bash
# 階段 3 冒煙測試：用真正的 yt-dlp 對「本機」HTTP 伺服器上的測試影片執行
# 橋接程式會使用的參數，確認輸出格式（進度、最終路徑）與暫存資料夾的行為。
# 不連 YouTube。yt-dlp 放在 spikes/stage3/.cache/bin/（官方 release）。
#
# 用法：spikes/stage3/smoke-ytdlp.sh <情境名稱> [額外的 yt-dlp 參數...]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cache="$here/.cache"
name="${1:?scenario name}"
shift
ytdlp="$cache/bin/yt-dlp"
out="$cache/out-$name"
port=18731

mkdir -p "$cache/www" "$out"
if [ ! -f "$cache/www/test.mp4" ]; then
  ffmpeg -loglevel error -y -f lavfi -i testsrc=size=320x240:rate=25 -f lavfi -i sine=frequency=440 \
    -t 20 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$cache/www/test.mp4"
fi

# python 的 http.server 不支援 Range，ffmpeg 裁切時會失敗，所以用 Go 寫的小伺服器。
go build -C "$here/rangeserver" -o "$cache/rangeserver" main.go
"$cache/rangeserver" "$port" "$cache/www" &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
sleep 1

set +e
"$ytdlp" --ignore-config --newline --no-colors --progress \
  --progress-template "download:YTM-PROGRESS %(progress)j" \
  --progress-template "postprocess:YTM-POST %(progress.postprocessor)j" \
  --print "after_move:YTM-FILE %(filepath)j" \
  -P "$out/tmpjob" -o "%(title)s [%(id)s].%(ext)s" --windows-filenames --no-playlist \
  "$@" -- "http://127.0.0.1:$port/test.mp4" >"$out/stdout.txt" 2>"$out/stderr.txt"
echo "exit=$?"
set -e
echo "--- stdout"
head -c 4000 "$out/stdout.txt"
echo
echo "--- stderr"
head -c 4000 "$out/stderr.txt"
echo
echo "--- files"
find "$out" -type f | sort
