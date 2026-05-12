@echo off
REM Nightly Futbin auto-refresh — closes terminal on completion.
REM Schedule with Windows Task Scheduler: cmd.exe /c "<absolute path to this file>"
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
node "_scrape_futbin_auto.js" %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
