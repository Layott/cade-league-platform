@echo off
REM Double-click this for an interactive menu that picks a scraper mode.

title CADE - Futbin Scraper Menu
cd /d "%~dp0"

:menu
cls
echo.
echo ========================================================
echo   CADE FUTBIN SCRAPER
echo ========================================================
echo.
echo   Make sure UK VPN is ON before running any option.
echo.
echo   [1] Delta  — newest releases only (~5-10 min)
echo   [2] Full   — every page (~30-60 min)
echo   [3] Range  — specific page window
echo   [4] Audit  — show DB completeness report
echo   [5] Reclassify — rebuild item_type from variants
echo   [Q] Quit
echo.
set /p choice="Pick [1/2/3/4/5/Q]: "

if /i "%choice%"=="1" goto delta
if /i "%choice%"=="2" goto full
if /i "%choice%"=="3" goto range
if /i "%choice%"=="4" goto audit
if /i "%choice%"=="5" goto reclassify
if /i "%choice%"=="Q" goto end
echo.
echo Invalid choice. Try again.
timeout /t 2 >nul
goto menu

:delta
echo.
echo [Running delta scraper...]
node "KNOWLEDGE\extracted\_scrape_futbin_new.js"
echo.
pause
goto menu

:full
echo.
echo [Running full scraper — this may take an hour...]
node "KNOWLEDGE\extracted\_scrape_futbin_headful.js"
echo.
pause
goto menu

:range
echo.
set /p from_page="Start page: "
set /p to_page="End page: "
echo.
echo [Running range scraper p%from_page%..p%to_page%...]
node "KNOWLEDGE\extracted\_scrape_futbin_range.js" --from %from_page% --to %to_page%
echo.
pause
goto menu

:audit
echo.
echo [Running completeness audit...]
node "KNOWLEDGE\extracted\_audit_futbin_completeness.js"
echo.
pause
goto menu

:reclassify
echo.
echo [Reclassifying item_type for all futbin rows...]
node "KNOWLEDGE\extracted\_reclassify_futbin_item_type.js"
echo.
pause
goto menu

:end
exit /b 0
