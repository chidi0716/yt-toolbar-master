#!/usr/bin/env bash
# 在 Linux 上模擬執行一行指令的引導腳本 install/bootstrap/install.sh（T41）：
#   - curl 以小腳本代替：把 Release 網址對應到本機資料夾中的檔案（可以模擬下載失敗）；
#   - uname、sysctl、id、shasum、xattr 以小腳本代替；
#   - 「小幫手」是一個記錄參數的小腳本，components.json 以 ytm-release manifest 產生。
# 檢查：選對晶片、核對 SHA256、以正確參數執行 --install、竄改時停止、拒絕 root 與非 macOS、
# 沒有替換版本標籤時停止、結束後刪除暫存資料夾。
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cache="$here/.cache"
rm -rf -- "$cache"
mkdir -p "$cache/release" "$cache/shims" "$cache/tmp" "$cache/user"
tag="v0.2.0"

# 假的小幫手：記錄自己的名稱與參數。
for p in darwin-arm64 darwin-amd64; do
  printf '#!/bin/sh\necho "$(basename "$0") $*" >> "%s/helper.log"\necho "fake helper ran"\n' "$cache" >"$cache/release/ytm-host-$p"
done
echo "windows" >"$cache/release/ytm-host-windows-amd64.exe"
(cd "$repo/host" && GOTOOLCHAIN=local go run ./cmd/ytm-release manifest -version 0.2.0 -helpers "$cache/release" -out "$cache/release/components.json")

cat >"$cache/shims/curl" <<EOF
#!/bin/sh
# 假 curl：只接受 https 的本專案 Release 網址，對應到 $cache/release。
out=""; url=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    https://*) url="\$1"; shift ;;
    *) shift ;;
  esac
done
case "\$url" in
  https://github.com/chidi0716/yt-toolbar-master/releases/download/$tag/*) ;;
  *) echo "unexpected url \$url" >&2; exit 22 ;;
esac
name="\${url##*/}"
[ -f "$cache/fail-\$name" ] && exit 22
cp "$cache/release/\$name" "\$out"
EOF
printf '#!/bin/sh\necho Darwin\n' >"$cache/shims/uname"
printf '#!/bin/sh\ncat "%s/arm64"\n' "$cache" >"$cache/shims/sysctl"
printf '#!/bin/sh\nexit 0\n' >"$cache/shims/xattr"
printf '#!/bin/sh\n[ "$1" = "-a" ] && shift 2\nsha256sum "$@"\n' >"$cache/shims/shasum"
printf '#!/bin/sh\necho 501\n' >"$cache/user/id"
chmod +x "$cache/shims"/* "$cache/user/id" "$cache/release"/ytm-host-darwin-*
echo 1 >"$cache/arm64"

script="$cache/install.sh"
sed "s/@RELEASE_TAG@/$tag/" "$repo/install/bootstrap/install.sh" >"$script"

run() { env -i HOME="$cache" TMPDIR="$cache/tmp" PATH="$cache/user:$cache/shims:/usr/bin:/bin" sh "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== Apple Silicon"
run "$script" >"$cache/out.txt" 2>&1 || { cat "$cache/out.txt"; fail "install failed"; }
grep -q "^ytm-host-darwin-arm64 --install --manifest [^ ]*components.json$" "$cache/helper.log" || fail "helper not run correctly: $(cat "$cache/helper.log")"
grep -q "Helper SHA256 verified" "$cache/out.txt" || fail "no SHA256 message"
[ -z "$(ls -A "$cache/tmp")" ] || fail "temporary folder left behind: $(ls -A "$cache/tmp")"

echo "== Intel"
echo 0 >"$cache/arm64"
rm -f "$cache/helper.log"
run "$script" >"$cache/out.txt" 2>&1 || { cat "$cache/out.txt"; fail "intel install failed"; }
grep -q "^ytm-host-darwin-amd64 --install" "$cache/helper.log" || fail "intel helper not chosen"
echo 1 >"$cache/arm64"

echo "== tampered helper"
rm -f "$cache/helper.log"
echo "echo evil" >>"$cache/release/ytm-host-darwin-arm64"
if run "$script" >"$cache/out.txt" 2>&1; then fail "tampered helper accepted"; fi
grep -q "does not match the release list" "$cache/out.txt" || fail "no mismatch message: $(cat "$cache/out.txt")"
[ ! -f "$cache/helper.log" ] || fail "tampered helper was executed"
[ -z "$(ls -A "$cache/tmp")" ] || fail "temporary folder left behind after failure"
(cd "$repo/host" && GOTOOLCHAIN=local go run ./cmd/ytm-release manifest -version 0.2.0 -helpers "$cache/release" -out "$cache/release/components.json")

echo "== download failure"
touch "$cache/fail-ytm-host-darwin-arm64"
if run "$script" >"$cache/out.txt" 2>&1; then fail "download failure ignored"; fi
grep -q "Could not download ytm-host-darwin-arm64" "$cache/out.txt" || fail "no download message"
grep -q "Run the same command again" "$cache/out.txt" || fail "no retry hint"
rm -f "$cache/fail-ytm-host-darwin-arm64"

echo "== root, other OS, missing tag"
printf '#!/bin/sh\necho 0\n' >"$cache/user/id"
if run "$script" >"$cache/out.txt" 2>&1; then fail "root accepted"; fi
grep -q "sudo" "$cache/out.txt" || fail "no sudo message"
printf '#!/bin/sh\necho 501\n' >"$cache/user/id"
printf '#!/bin/sh\necho Linux\n' >"$cache/shims/uname"
if run "$script" >"$cache/out.txt" 2>&1; then fail "Linux accepted"; fi
printf '#!/bin/sh\necho Darwin\n' >"$cache/shims/uname"
if run "$repo/install/bootstrap/install.sh" >"$cache/out.txt" 2>&1; then fail "script without tag accepted"; fi
grep -q "version tag is missing" "$cache/out.txt" || fail "no missing-tag message"

echo "== piped through sh (curl ... | sh)"
rm -f "$cache/helper.log"
env -i HOME="$cache" TMPDIR="$cache/tmp" PATH="$cache/user:$cache/shims:/usr/bin:/bin" sh <"$script" >"$cache/out.txt" 2>&1 || { cat "$cache/out.txt"; fail "piped install failed"; }
grep -q "^ytm-host-darwin-arm64 --install" "$cache/helper.log" || fail "piped: helper not run"

echo "all bootstrap checks passed"
