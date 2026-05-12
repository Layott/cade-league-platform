# Python Scrapling-based Futbin scraper — PowerShell wrapper.
# Activates .scrapling-venv if present, otherwise uses system py launcher.
# Run: powershell -File scrapling.ps1 --from 1 --to 600 --tabs 8
$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extracted = Split-Path -Parent $scriptDir
$repoRoot = Resolve-Path (Join-Path $extracted "..\..")
$venvActivate = Join-Path $repoRoot ".scrapling-venv\Scripts\Activate.ps1"

try {
    Push-Location $extracted
    if (Test-Path $venvActivate) {
        & $venvActivate
        & python "_scrape_futbin_scrapling.py" @args
    } else {
        & py -3 "_scrape_futbin_scrapling.py" @args
    }
    $code = $LASTEXITCODE
} finally {
    Pop-Location
    exit $code
}
