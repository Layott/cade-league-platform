@echo off
REM Filtered Futbin scrape (icons / heroes / etc). Closes terminal on exit.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
node "_scrape_futbin_filters.js" %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
