# Remove the download helper (Windows). plan 4.8, 4.9, 002 FR-77, 008 FR-31.
#
#   irm https://github.com/chidi0716/yt-toolbar-master/releases/latest/download/uninstall.ps1 | iex
#   (or, from the manual-install zip: powershell -ExecutionPolicy Bypass -File uninstall.ps1)
#
# Removes everything the installer created: %LOCALAPPDATA%\youtube-extension-host\ (the helper,
# yt-dlp, deno, ffmpeg, state and logs) and the Chrome and Firefox registry keys under HKCU.
# Downloaded videos are not touched. yt-dlp, ffmpeg or deno installed by you (for example with
# winget) are not touched either.
#
# Comments are English only and every Chinese message is wrapped in Z '...' so that the release
# workflow can turn it into an ASCII file for `irm | iex` (see install/bootstrap/install.ps1).
# The script never calls `exit`, which would close the PowerShell window when run through `iex`.
& {
    $ErrorActionPreference = 'Stop'
    function Z([string]$s) { return [regex]::Unescape($s) }

    if (-not $env:LOCALAPPDATA) {
        Write-Host 'Error: LOCALAPPDATA is not set.' -ForegroundColor Red
        return
    }
    $Name = 'com.chidi0716.youtube_extension'
    $AppDir = Join-Path $env:LOCALAPPDATA 'youtube-extension-host'
    $Keys = @(
        "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$Name",
        "HKCU:\Software\Mozilla\NativeMessagingHosts\$Name"
    )

    foreach ($key in $Keys) {
        if (Test-Path -LiteralPath $key) {
            Remove-Item -LiteralPath $key -Recurse -Force
            Write-Host ((Z '已移除') + " / Removed: $key")
        }
    }

    if (Test-Path -LiteralPath $AppDir) {
        try {
            Remove-Item -LiteralPath $AppDir -Recurse -Force
            Write-Host ((Z '已移除') + " / Removed: $AppDir")
        } catch {
            Write-Host ((Z '無法刪除 ') + $AppDir + (Z '。請關閉 Chrome 與 Firefox（可能有下載正在進行）後再執行一次。')) -ForegroundColor Red
            Write-Host "Could not remove $AppDir. Close Chrome and Firefox (a download may be running) and run this again." -ForegroundColor Red
            return
        }
    }

    Write-Host ((Z '完成。下載功能已移除，已下載的檔案沒有被刪除。') + ' / Done. The download helper was removed; downloaded files were not touched.')
}
