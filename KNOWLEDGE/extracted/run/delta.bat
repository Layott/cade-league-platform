@echo off
REM Delta-only Futbin scrape (new + changed rows). Closes terminal on exit.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
node "_scrape_futbin_new.js" %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
