@echo off
REM Full-reset parallel scrape — wipes all 4 worker profile dirs, then
REM launches 4 workers covering pages 1-803 (whole catalog). Each worker
REM opens its own Chromium window; first page load triggers an
REM auto-Cloudflare-bypass attempt (3 tries). If auto fails, the terminal
REM prompts you to tick the "Verify you are human" box in that window
REM + press ENTER. After that one solve per worker, the rest is hands-off.
REM
REM Expected runtime: 30-60 min with VPN + a quiet network.

title CADE - Futbin FULL RESET + Parallel Scrape
cd /d "%~dp0"

echo.
echo ========================================================
echo   CADE Futbin FULL RESET + PARALLEL SCRAPE
echo ========================================================
echo.
echo This will:
echo   1. WIPE all 4 worker Chromium profiles
echo      (.futbin_chromium_profile_p1..p4)
echo   2. Launch 4 parallel workers covering pages 1-803
echo   3. Auto-attempt Cloudflare bypass per worker
echo   4. Prompt for manual CF solve only if auto fails
echo.
echo Make sure your UK VPN is ON before continuing.
echo.
pause

node "KNOWLEDGE\extracted\_scrape_futbin_parallel.js" --from 1 --to 803 --workers 4 --reset-profiles

echo.
echo ========================================================
echo   Done.
echo ========================================================
echo.
pause
