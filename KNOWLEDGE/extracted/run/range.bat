@echo off
REM Page-range Futbin scrape. Closes terminal on exit.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
node "_scrape_futbin_range.js" %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
