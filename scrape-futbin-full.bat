@echo off
REM Double-click to run the full-catalog Futbin scraper.
REM Walks the entire /26/players default view front-to-back.
REM Use for big sweeps or initial seeding. Takes 30-60 min.

title CADE - Futbin Full Scraper
cd /d "%~dp0"

echo.
echo ========================================================
echo   CADE Futbin Full Scraper (all pages)
echo ========================================================
echo.
echo This walks every page of /26/players.
echo Expected runtime: 30-60 min.
echo Make sure your UK VPN is ON before continuing.
echo.
pause

node "KNOWLEDGE\extracted\_scrape_futbin_headful.js"

echo.
echo ========================================================
echo   Done.
echo ========================================================
echo.
pause
