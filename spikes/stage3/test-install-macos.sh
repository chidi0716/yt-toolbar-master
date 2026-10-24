#!/usr/bin/env bash
# 在 Linux 上模擬執行 install/macos/install.sh 與 uninstall.sh：
# HOME 指向 spikes/stage3/.cache/ 中的假家目錄，uname、sysctl、xattr 以小腳本代替，
# 橋接程式用 Linux 版代替 darwin 版（只用來確認 --version 能執行）。
# 檢查原生訊息設定檔的 JSON、路徑與 ID，以及解除安裝後全部移除。
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cache="$here/.cache"
fakehome="$cache/fake-home-macos"
shims="$cache/shims-macos"
rm -rf -- "$fakehome" "$shims"
mkdir -p "$fakehome/Library/Application Support" "$shims"

printf '#!/bin/sh\necho Darwin\n' >"$shims/uname"
printf '#!/bin/sh\necho 1\n' >"$shims/sysctl"
printf '#!/bin/sh\nexit 0\n' >"$shims/xattr"
chmod +x "$shims"/*
# 容器以 root 執行；一般情況用假的 id 模擬一般使用者，最後再測試 root 會被拒絕。
mkdir -p "$shims/user"
printf '#!/bin/sh\necho 501\n' >"$shims/user/id"
chmod +x "$shims/user/id"

(cd "$repo/host" && go build -o "$cache/ytm-host-linux" ./cmd/ytm-host)

run() { env -i HOME="$fakehome" PATH="$shims/user:$shims:/usr/bin:/bin" sh "$@"; }

echo "== install"
run "$repo/install/macos/install.sh" "$cache/ytm-host-linux"

app="$fakehome/Library/Application Support/yt-toolbar-master/ytm-host"
chrome="$fakehome/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.chidi0716.yt_toolbar_master.json"
firefox="$fakehome/Library/Application Support/Mozilla/NativeMessagingHosts/com.chidi0716.yt_toolbar_master.json"

python3 -I - "$chrome" "$firefox" "$app" <<'EOF'
import json, sys
chrome, firefox, app = sys.argv[1:4]
c = json.load(open(chrome))
f = json.load(open(firefox))
assert c["name"] == f["name"] == "com.chidi0716.yt_toolbar_master"
assert c["path"] == f["path"] == app, (c["path"], app)
assert c["type"] == f["type"] == "stdio"
assert c["allowed_origins"] == ["chrome-extension://bkjlangdjfpllnkcpfpdlajchbginjdj/"]
assert f["allowed_extensions"] == ["yt-toolbar-master@chidi0716"]
assert "allowed_extensions" not in c and "allowed_origins" not in f
print("manifests OK:", c["path"])
EOF
"$app" --version

echo "== install again (upgrade in place)"
run "$repo/install/macos/install.sh" "$cache/ytm-host-linux" >/dev/null

echo "== uninstall"
mkdir -p "$fakehome/Library/Logs/yt-toolbar-master"
touch "$fakehome/Library/Logs/yt-toolbar-master/host.log"
run "$repo/install/macos/uninstall.sh"
left=$(cd "$fakehome" && find . -path '*youtube*' -o -name 'com.chidi0716*' | head -n 5)
if [ -n "$left" ]; then
  echo "left behind: $left" >&2
  exit 1
fi
echo "uninstall OK: nothing left"

echo "== refuses sudo (the container runs as root)"
if [ "$(id -u)" = "0" ]; then
  out=$(env -i HOME="$fakehome" PATH="$shims:/usr/bin:/bin" sh "$repo/install/macos/install.sh" "$cache/ytm-host-linux" 2>&1 || true)
  if printf '%s' "$out" | grep -q sudo && [ ! -e "$fakehome/Library/Application Support/yt-toolbar-master" ]; then
    echo "root check OK"
  else
    echo "root check FAILED" >&2
    exit 1
  fi
fi
