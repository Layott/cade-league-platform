@echo off
REM First-time Cloudflare warm-up (visible browser). Closes terminal on exit.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
node "_scrape_futbin_headful.js" %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
