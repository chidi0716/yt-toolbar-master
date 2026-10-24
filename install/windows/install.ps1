# 手動安裝下載功能的小幫手（Windows，使用者層級，不需要系統管理員權限）。plan 4.8、4.9、008 FR-16。
#
# 一般使用者請改用 README 的一行指令（會一併下載 yt-dlp、ffmpeg、deno）。這個腳本給
# 「自己建置小幫手」或「已經自己裝好 yt-dlp、ffmpeg、deno」的人使用：執行
# ytm-host --install --offline，小幫手把自己複製到 %LOCALAPPDATA%\yt-toolbar-master\，
# 寫入原生訊息設定檔與 HKCU 的 Chrome、Firefox 登錄機碼，並檢查 yt-dlp、ffmpeg、deno（不下載任何東西）。
#
# 用法（PowerShell 預設不允許執行腳本，所以以 -ExecutionPolicy Bypass 執行這一次）：
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Binary <小幫手的路徑>]
# 沒有指定 -Binary 時，依序尋找與本腳本同一個資料夾、以及 repo 的 host\dist\ 中的
# ytm-host-windows-amd64.exe。
[CmdletBinding()]
param(
    [string]$Binary
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3

function Fail([string]$Message) {
    Write-Host "Error: $Message" -ForegroundColor Red
    exit 1
}

if (-not $env:LOCALAPPDATA) {
    Fail 'LOCALAPPDATA is not set.'
}

$BinName = 'ytm-host-windows-amd64.exe'
if (-not $Binary) {
    foreach ($candidate in @((Join-Path $PSScriptRoot $BinName), (Join-Path $PSScriptRoot "..\..\host\dist\$BinName"))) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $Binary = $candidate
            break
        }
    }
}
if (-not $Binary -or -not (Test-Path -LiteralPath $Binary -PathType Leaf)) {
    Fail "could not find $BinName. Build it with 'npm run build:host' or pass its path: install.ps1 -Binary C:\path\to\$BinName"
}

# 從網路下載的檔案帶有「來自網際網路」標記，移除後 SmartScreen 才不會阻擋。
Unblock-File -LiteralPath $Binary -ErrorAction SilentlyContinue

& $Binary --install --offline
if ($LASTEXITCODE -ne 0) {
    Fail "the helper could not be installed (exit code $LASTEXITCODE). Close Chrome and Firefox and try again."
}
