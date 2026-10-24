#!/usr/bin/env bash
# 在 Linux 上以官方 PowerShell（spikes/stage3/.cache/pwsh/，見 spikes/stage3/check-ps1.sh）模擬
# `irm … | iex` 執行 install/bootstrap/install.ps1 的發佈版本（T41、T43）：
#   - 以 scripts/ps1-ascii.mjs 轉成純 ASCII 並代入版本標籤（與 scripts/release.mjs 相同）；
#   - 以 Latin-1 解碼後 Invoke-Expression（Windows PowerShell 5.1 的 irm 行為）；
#   - Invoke-WebRequest 換成從本機資料夾複製檔案；「小幫手」是記錄參數的小腳本。
# 檢查：中文訊息正確還原、核對 SHA256、以正確參數執行 --install、竄改時停止、下載失敗時說明、
# 沒有替換版本標籤時停止，以及腳本不會呼叫 exit（不會關掉使用者的 PowerShell 視窗）。
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cache="$here/.cache/windows"
pwsh="$repo/spikes/stage3/.cache/pwsh/pwsh"
[ -x "$pwsh" ] || { echo "run spikes/stage3/check-ps1.sh first (it unpacks PowerShell)" >&2; exit 1; }
rm -rf -- "$cache"
mkdir -p "$cache/release"
tag="v0.2.0"

for p in darwin-arm64 darwin-amd64; do echo "$p" >"$cache/release/ytm-host-$p"; done
printf '#!/bin/sh\necho "$(basename "$0") $*" >> "%s/helper.log"\necho "fake helper ran"\n' "$cache" >"$cache/release/ytm-host-windows-amd64.exe"
manifest() { (cd "$repo/host" && GOTOOLCHAIN=local go run ./cmd/ytm-release manifest -version 0.2.0 -helpers "$cache/release" -out "$cache/release/components.json"); }
manifest

sed "s/@RELEASE_TAG@/$tag/" "$repo/install/bootstrap/install.ps1" >"$cache/tagged.ps1"
node "$repo/scripts/ps1-ascii.mjs" "$cache/tagged.ps1" "$cache/install.ps1"
if LC_ALL=C grep -q '[^[:print:][:space:]]' "$cache/install.ps1"; then
  echo "FAIL: the release install.ps1 is not ASCII" >&2
  exit 1
fi
node "$repo/scripts/ps1-ascii.mjs" "$repo/install/windows/uninstall.ps1" "$cache/uninstall.ps1"
"$pwsh" -NoProfile -NonInteractive -File "$repo/spikes/stage3/parse-ps1.ps1" "$cache/install.ps1" "$cache/uninstall.ps1"

run() { "$pwsh" -NoProfile -NonInteractive -File "$here/run-bootstrap.ps1" -Script "$1" -ReleaseDir "$cache/release" -Tag "$tag" >"$cache/out.txt" 2>&1 || true; }
fail() { echo "FAIL: $*" >&2; cat "$cache/out.txt" >&2; exit 1; }

echo "== install"
run "$cache/install.ps1"
grep -q "^ytm-host-windows-amd64.exe --install --manifest [^ ]*components.json$" "$cache/helper.log" || fail "helper not run correctly"
grep -q "下載功能安裝程式 $tag" "$cache/out.txt" || fail "Chinese text was not restored"
grep -q "Helper SHA256 verified" "$cache/out.txt" || fail "no SHA256 message"
grep -q "STILL-RUNNING" "$cache/out.txt" || fail "the script ended the PowerShell session"

echo "== tampered helper"
rm -f "$cache/helper.log"
echo "echo evil" >>"$cache/release/ytm-host-windows-amd64.exe"
run "$cache/install.ps1"
grep -q "does not match the release list" "$cache/out.txt" || fail "no mismatch message"
[ ! -f "$cache/helper.log" ] || fail "tampered helper was executed"
grep -q "STILL-RUNNING" "$cache/out.txt" || fail "exit after a failure"
manifest

echo "== download failure"
mv "$cache/release/ytm-host-windows-amd64.exe" "$cache/release/helper.bak"
run "$cache/install.ps1"
grep -q "Could not download ytm-host-windows-amd64.exe" "$cache/out.txt" || fail "no download message"
grep -q "STILL-RUNNING" "$cache/out.txt" || fail "exit after a download failure"
mv "$cache/release/helper.bak" "$cache/release/ytm-host-windows-amd64.exe"

echo "== untagged script"
node "$repo/scripts/ps1-ascii.mjs" "$repo/install/bootstrap/install.ps1" "$cache/untagged.ps1"
run "$cache/untagged.ps1"
grep -q "version tag is missing" "$cache/out.txt" || fail "no missing-tag message"

echo "== converter rejects Chinese outside Z '...'"
printf "Write-Host '中文'\n" >"$cache/bad.ps1"
if node "$repo/scripts/ps1-ascii.mjs" "$cache/bad.ps1" "$cache/bad-out.ps1" 2>/dev/null; then
  echo "FAIL: converter accepted non-ASCII outside Z" >&2
  exit 1
fi

echo "all Windows bootstrap checks passed"
