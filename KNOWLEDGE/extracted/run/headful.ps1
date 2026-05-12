# First-time Cloudflare warm-up (visible browser) — PowerShell wrapper.
$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extracted = Split-Path -Parent $scriptDir
try {
    Push-Location $extracted
    & node "_scrape_futbin_headful.js" @args
    $code = $LASTEXITCODE
} finally {
    Pop-Location
    exit $code
}
