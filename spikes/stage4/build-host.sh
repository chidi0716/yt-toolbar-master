#!/bin/sh
# 階段 4 端到端測試用：在工作目錄內編譯真正的橋接程式與 repo 內的假 yt-dlp。
# Go 的模組與建置快取也放在工作目錄內（spikes/stage4/.cache/go/），不使用家目錄中的快取。
#   sh spikes/stage4/build-host.sh
#
# 產生的工具資料夾（以瀏覽器的 PATH 指定其中一個，橋接程式就會在那裡找到工具）：
#   bin/tools/          yt-dlp、ffmpeg、deno 都有
#   bin/tools-nodeno/   缺 deno（可以下載，但顯示建議安裝 deno 的提示）
#   bin/tools-noytdlp/  缺 yt-dlp（無法下載，顯示安裝說明）
# yt-dlp 是一個小腳本：每次執行時讀取 .cache/e2e/scenario 與 .cache/e2e/delay，
# 再以 FAKE_YTDLP_SCENARIO、FAKE_YTDLP_DELAY_MS 執行假 yt-dlp，測試程式不用重新啟動瀏覽器就能切換情境。
# 每次執行的參數記錄在 .cache/e2e/yt-dlp.log（FAKE_YTDLP_LOG）。
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
cache="$root/spikes/stage4/.cache"
mkdir -p "$cache/go/mod" "$cache/go/build" "$cache/bin" "$cache/e2e"
export GOTOOLCHAIN=local GOMODCACHE="$cache/go/mod" GOCACHE="$cache/go/build" GOFLAGS=-modcacherw
cd "$root/host"
go build -o "$cache/bin/ytm-host" ./cmd/ytm-host
go build -o "$cache/bin/fake-yt-dlp" ./testdata/fake-yt-dlp

rm -rf "$cache/bin/tools" "$cache/bin/tools-nodeno" "$cache/bin/tools-noytdlp"
mkdir -p "$cache/bin/tools" "$cache/bin/tools-nodeno" "$cache/bin/tools-noytdlp"
cat > "$cache/bin/tools/yt-dlp" <<EOF
#!/bin/sh
scenario=\$(cat "$cache/e2e/scenario" 2>/dev/null || true)
delay=\$(cat "$cache/e2e/delay" 2>/dev/null || true)
FAKE_YTDLP_SCENARIO="\${scenario:-ok}" FAKE_YTDLP_DELAY_MS="\${delay:-0}" FAKE_YTDLP_LOG="$cache/e2e/yt-dlp.log" exec "$cache/bin/fake-yt-dlp" "\$@"
EOF
chmod +x "$cache/bin/tools/yt-dlp"
cp "$cache/bin/fake-yt-dlp" "$cache/bin/tools/ffmpeg"
cp "$cache/bin/fake-yt-dlp" "$cache/bin/tools/deno"
cp "$cache/bin/tools/yt-dlp" "$cache/bin/tools/ffmpeg" "$cache/bin/tools-nodeno/"
cp "$cache/bin/tools/ffmpeg" "$cache/bin/tools/deno" "$cache/bin/tools-noytdlp/"
"$cache/bin/ytm-host" --version
