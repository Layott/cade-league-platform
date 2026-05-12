@echo off
REM Price-only Futbin refresh. Closes terminal on exit.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
node "_scrape_futbin_prices.js" %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
