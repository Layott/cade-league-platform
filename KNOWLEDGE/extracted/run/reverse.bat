@echo off
REM Reverse-order Futbin scrape (high pages first). Closes terminal on exit.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
node "_scrape_futbin_reverse.js" %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
