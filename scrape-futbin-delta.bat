@echo off
REM Double-click to run the fast "new releases" Futbin delta scraper.
REM Walks https://www.futbin.com/26/latest-released-players newest-first,
REM only writes cards that changed since last run. Stops automatically
REM after 2 consecutive unchanged pages.

title CADE - Futbin Delta Scraper
cd /d "%~dp0"

echo.
echo ========================================================
echo   CADE Futbin Delta Scraper (new releases only)
echo ========================================================
echo.
echo Make sure your UK VPN is ON before continuing.
echo.
pause

node "KNOWLEDGE\extracted\_scrape_futbin_new.js"

echo.
echo ========================================================
echo   Done. Review futbin_new_inserted.json + futbin_new_updates.json
echo ========================================================
echo.
pause
