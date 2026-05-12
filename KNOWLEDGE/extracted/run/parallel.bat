@echo off
REM Parallel multi-worker Futbin scrape — closes terminal on completion.
REM Usage: parallel.bat --from 1 --to 600 --workers 6 [--tabs 4] [--aggressive] [--reset-profiles]
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
node "_scrape_futbin_parallel.js" %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
