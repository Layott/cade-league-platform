# Nightly Futbin auto-refresh — PowerShell wrapper that closes window on exit.
# Run: powershell -File auto.ps1
$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extracted = Split-Path -Parent $scriptDir
try {
    Push-Location $extracted
    & node "_scrape_futbin_auto.js" @args
    $code = $LASTEXITCODE
} finally {
    Pop-Location
    exit $code
}
