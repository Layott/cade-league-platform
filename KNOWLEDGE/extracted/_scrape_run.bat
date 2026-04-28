@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  Auto-runner for the Futbin scrape. Wired to Windows Task Scheduler
REM  via _scrape_setup_schedule.bat. Runs headless against the persistent
REM  Chromium profile under KNOWLEDGE/extracted/.futbin_chromium_profile/
REM  so cookies survive across runs.
REM
REM  Logs land at  KNOWLEDGE/extracted/_scrape_logs/<yyyymmdd-HHMM>.log
REM  Failures are non-fatal (exit 0) so the scheduled task doesn't get
REM  retried by Windows after a transient error — next nightly run picks
REM  up where it left off.
REM ─────────────────────────────────────────────────────────────────────

setlocal
set "REPO=C:\Users\Sweez\Desktop\LAYO\CLAUDE\GAMEEVO\ESOCCER"
set "LOGDIR=%REPO%\KNOWLEDGE\extracted\_scrape_logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM wmic was deprecated + locale-dependent. Use PowerShell for the
REM timestamp so the log filename is portable.
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "STAMP=%%a"
set "LOG=%LOGDIR%\%STAMP%.log"

cd /d "%REPO%"

REM Step 1 — full-catalogue refresh: walks all 800+ pages of
REM /26/players (rating + price + image + meta) via the cookie-injected
REM scraper. ~45-90min. Writes/updates fc26_players rows where
REM source_dataset='futbin.com'.
echo [%DATE% %TIME%] starting Futbin full-catalogue scrape >> "%LOG%"
node KNOWLEDGE\extracted\_scrape_futbin_cookies.js >> "%LOG%" 2>&1
echo [%DATE% %TIME%] full-catalogue exit=%ERRORLEVEL% >> "%LOG%"

REM Step 2 — filter-band sweep: catches the ~12k bronze / silver /
REM non-default-promo cards absent from /26/players default view.
REM ~30-60min. Append-only on the same DB rows.
echo [%DATE% %TIME%] starting Futbin filter-band sweep >> "%LOG%"
node KNOWLEDGE\extracted\_scrape_futbin_filters.js >> "%LOG%" 2>&1
echo [%DATE% %TIME%] filter-band exit=%ERRORLEVEL% >> "%LOG%"

REM Step 3 — price refresh on rows already in the catalogue. Tiny
REM compared to the above when most rows are fresh.
echo [%DATE% %TIME%] starting Futbin price refresh >> "%LOG%"
node KNOWLEDGE\extracted\_scrape_futbin_prices.js >> "%LOG%" 2>&1
echo [%DATE% %TIME%] price-refresh exit=%ERRORLEVEL% >> "%LOG%"

echo [%DATE% %TIME%] nightly scrape complete >> "%LOG%"
exit /b 0
