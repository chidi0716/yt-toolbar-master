# One-line installer for the download helper (Windows). plan 4.9, 008 FR-10, FR-11.
#
#   irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/install.ps1 | iex
#
# This script only does three things; the helper (yte-host --install) does the rest and explains each step:
#   1. Download components.json and the helper over HTTPS from the same (fixed-version) GitHub release of this project.
#   2. Check that the helper's SHA256 matches components.json.
#   3. Run the helper with --install (the helper checks the list and the SHA256 of every file it downloads).
# This project does not use its own signing key (008 FR-51); the repository has GitHub immutable releases on.
# No administrator rights are needed; everything goes into your user folder.
#
# Comments are English only and every Chinese message is wrapped in Z '...': the release workflow
# (scripts/release.mjs) replaces @RELEASE_TAG@ with the tag, removes the BOM and turns the Chinese
# text into \u escapes, because Windows PowerShell 5.1 decodes `irm` output without a charset as
# Latin-1. The script never calls `exit`, which would close the PowerShell window when run through `iex`.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $Tag = '@RELEASE_TAG@'
    $Base = "https://github.com/chidi0716/yt-toolbar-master/releases/download/$Tag"
    $Platform = 'windows-amd64'
    $Helper = 'yte-host-windows-amd64.exe'

    function Z([string]$s) { return [regex]::Unescape($s) }
    function Say([string]$s) { Write-Host $s }
    function Fail([string]$zh, [string]$en) {
        Write-Host ''
        Write-Host ((Z '失敗') + ' / Failed: ' + $zh + ' / ' + $en) -ForegroundColor Red
        Write-Host ((Z '再執行一次同一個指令即可重試。') + ' / Run the same command again to retry.')
    }

    if ($Tag.StartsWith('@')) {
        Fail (Z '請從 GitHub Release 下載這個腳本。') 'Download this script from a GitHub release (the version tag is missing).'
        return
    }
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
        Fail (Z '只支援 64 位元（x64）的 Windows 10/11。') 'Only 64-bit (x64) Windows 10/11 is supported.'
        return
    }
    if (-not $env:LOCALAPPDATA) {
        Fail 'LOCALAPPDATA' 'LOCALAPPDATA is not set.'
        return
    }

    # Windows PowerShell 5.1 does not enable TLS 1.2 by default.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $Tmp = Join-Path ([IO.Path]::GetTempPath()) ('yte-install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Tmp | Out-Null
    try {
        Say ((Z '下載功能安裝程式') + " $Tag / Download helper installer $Tag")
        Say ((Z '從本專案的 GitHub 下載小幫手') + ' / Downloading the helper from this project''s GitHub:')
        Say "  $Base/"
        foreach ($name in @('components.json', $Helper)) {
            try {
                Invoke-WebRequest -UseBasicParsing -Uri "$Base/$name" -OutFile (Join-Path $Tmp $name)
            } catch {
                Fail ((Z '無法下載 ') + $name + (Z '，請確認網路連線。')) ("Could not download $name. Check your internet connection. " + $_.Exception.Message)
                return
            }
        }

        try {
            $manifest = Get-Content -Raw -LiteralPath (Join-Path $Tmp 'components.json') | ConvertFrom-Json
            $expected = [string]$manifest.helper.$Platform.sha256
        } catch {
            $expected = ''
        }
        if ($expected -notmatch '^[0-9a-f]{64}$') {
            Fail (Z 'components.json 格式不正確。') 'components.json is not valid.'
            return
        }
        $exe = Join-Path $Tmp $Helper
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            Fail (Z '下載的小幫手與清單不符（SHA256），已停止。') 'The downloaded helper does not match the release list (SHA256).'
            return
        }
        Say ((Z '小幫手的 SHA256 相符') + " / Helper SHA256 verified: $actual")

        # Run the helper directly (not captured) so that its Chinese output goes straight to the console.
        & $exe --install --manifest (Join-Path $Tmp 'components.json')
        if ($LASTEXITCODE -ne 0) {
            Write-Host ''
            Write-Host ((Z '安裝沒有完成，請看上面的說明。') + ' / The installation did not finish; see the messages above.') -ForegroundColor Yellow
        }
    } finally {
        Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
