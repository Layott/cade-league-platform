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

for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "DT=%%a"
set "STAMP=%DT:~0,8%-%DT:~8,4%"
set "LOG=%LOGDIR%\%STAMP%.log"

cd /d "%REPO%"
echo [%DATE% %TIME%] starting Futbin auto-refresh >> "%LOG%"
node KNOWLEDGE\extracted\_scrape_futbin_auto.js >> "%LOG%" 2>&1
echo [%DATE% %TIME%] finished with exit %ERRORLEVEL% >> "%LOG%"
exit /b 0
