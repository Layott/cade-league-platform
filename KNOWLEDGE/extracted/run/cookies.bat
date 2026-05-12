@echo off
REM Cookie dump utility. Closes terminal on exit.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
node "_scrape_futbin_cookies.js" %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
