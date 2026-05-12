@echo off
REM Python Scrapling-based Futbin scraper (anti-bot auto-solve, parallel tabs).
REM Auto-activates the .scrapling-venv if present. Closes terminal on completion.
REM Usage: scrapling.bat --from 1 --to 600 --tabs 8

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%..\..\.."
set "VENV_ACTIVATE=%REPO_ROOT%\.scrapling-venv\Scripts\activate.bat"

pushd "%SCRIPT_DIR%.."

if exist "%VENV_ACTIVATE%" (
    call "%VENV_ACTIVATE%"
    python "_scrape_futbin_scrapling.py" %*
) else (
    REM Fall back to system py launcher
    py -3 "_scrape_futbin_scrapling.py" %*
)

set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
