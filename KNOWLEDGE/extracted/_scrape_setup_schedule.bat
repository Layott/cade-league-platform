@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  Register the Futbin auto-scrape with Windows Task Scheduler.
REM  Run this ONCE on the admin's PC. Subsequent edits to the scraper
REM  itself don't require re-running this — the task points at the
REM  fixed wrapper _scrape_run.bat.
REM
REM  Schedule: every day at 03:00 (WAT). Runs whether user is logged
REM  in or not. Won't wake the PC; if the box is off at 03:00, the
REM  task fires at next wake.
REM
REM  Verify after install:
REM    schtasks /Query /TN "CADE-Futbin-Scrape"
REM    schtasks /Run   /TN "CADE-Futbin-Scrape"
REM ─────────────────────────────────────────────────────────────────────

setlocal
set "TASK=CADE-Futbin-Scrape"
set "WRAPPER=C:\Users\Sweez\Desktop\LAYO\CLAUDE\GAMEEVO\ESOCCER\KNOWLEDGE\extracted\_scrape_run.bat"

schtasks /Query /TN "%TASK%" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo Task "%TASK%" already exists — re-creating.
  schtasks /Delete /TN "%TASK%" /F
)

schtasks /Create ^
  /SC DAILY ^
  /ST 03:00 ^
  /TN "%TASK%" ^
  /TR "\"%WRAPPER%\"" ^
  /RL LIMITED ^
  /F

if %ERRORLEVEL% NEQ 0 (
  echo schtasks create failed. Try running this script as Administrator.
  exit /b 1
)

echo.
echo Scheduled. Manual run for verification:
echo   schtasks /Run /TN "%TASK%"
echo.
endlocal
