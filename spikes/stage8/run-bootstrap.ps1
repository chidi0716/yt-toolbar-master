# Run a release copy of install.ps1 the way `irm ... | iex` does on Windows PowerShell 5.1:
# the text is decoded as Latin-1 and passed to Invoke-Expression. Invoke-WebRequest is replaced by a
# function that serves files from a local folder (only for this project's release URLs).
# Used by test-bootstrap-windows.sh with the official PowerShell for Linux.
param(
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$ReleaseDir,
    [Parameter(Mandatory = $true)][string]$Tag
)

$text = [IO.File]::ReadAllText($Script, [Text.Encoding]::GetEncoding(28591))

function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
    $prefix = "https://github.com/chidi0716/yt-toolbar-master/releases/download/$Tag/"
    if (-not $Uri.StartsWith($prefix)) { throw "unexpected URL $Uri" }
    $src = Join-Path $ReleaseDir $Uri.Substring($prefix.Length)
    if (-not (Test-Path -LiteralPath $src)) { throw "404 Not Found: $Uri" }
    Copy-Item -LiteralPath $src -Destination $OutFile
    & chmod 755 $OutFile
}

$env:LOCALAPPDATA = Join-Path $ReleaseDir 'LocalAppData'
Invoke-Expression $text
# The installer must never call `exit` (it would close the user's PowerShell window).
Write-Host 'STILL-RUNNING'
