# Parallel multi-worker Futbin scrape — PowerShell wrapper.
# Run: powershell -File parallel.ps1 --from 1 --to 200 --workers 6 --tabs 2
$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extracted = Split-Path -Parent $scriptDir
try {
    Push-Location $extracted
    & node "_scrape_futbin_parallel.js" @args
    $code = $LASTEXITCODE
} finally {
    Pop-Location
    exit $code
}
