@echo off
REM Parallel Futbin scraper launcher. Prompts for page range + worker count.
REM Each worker opens its own Chromium window. First time each worker
REM starts you'll need to solve Cloudflare in its window once (separate
REM profile dir per worker, cookie caches afterwards).
REM Max 6 workers — more risks Cloudflare concurrent-session detection.

title CADE - Futbin Parallel Scraper
cd /d "%~dp0"

echo.
echo ========================================================
echo   CADE Futbin Parallel Scraper
echo ========================================================
echo.
echo Each worker opens its own Chromium window.
echo First run of each worker needs a one-time CF solve.
echo UK VPN must be on before continuing.
echo.

set /p from_page="Start page: "
set /p to_page="End page: "
set /p workers="Workers (1-6, default 4): "
if "%workers%"=="" set workers=4

echo.
echo Running: --from %from_page% --to %to_page% --workers %workers%
echo.
pause

node "KNOWLEDGE\extracted\_scrape_futbin_parallel.js" --from %from_page% --to %to_page% --workers %workers%

echo.
echo ========================================================
echo   Done.
echo ========================================================
echo.
pause
