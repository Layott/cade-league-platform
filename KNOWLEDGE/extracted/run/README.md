# Scraper launchers — auto-close edition

Every `.bat` and `.ps1` in this folder wraps one of the Futbin scrapers so
the cmd / PowerShell window **closes itself** on completion (success OR
failure). No key press required.

## Why these exist

Running `node KNOWLEDGE/extracted/_scrape_futbin_auto.js` from an
interactive PowerShell window leaves the window open after Node exits —
that's standard shell behavior. These launchers spawn a fresh cmd
session per scraper that auto-terminates when the child process exits.

## Usage

Double-click any `.bat` from File Explorer, or run from PowerShell:

```powershell
# Nightly auto refresh — call from Windows Task Scheduler
.\run\auto.bat

# Parallel 4-worker scrape pages 1..200 — call interactively
.\run\parallel.bat --from 1 --to 200 --workers 4

# Aggressive: 12 workers × 4 tabs each (48 concurrent sessions) — risky
.\run\parallel.bat --from 1 --to 600 --workers 12 --tabs 4 --aggressive

# New Python Scrapling-based scraper (anti-bot auto-solve, 8 tabs)
.\run\scrapling.bat --from 1 --to 600 --tabs 8

# Resume a checkpointed scrape (same script, no --reset)
.\run\auto.bat
```

For Windows Task Scheduler, set the **Action** to:

- **Program/script:** `cmd.exe`
- **Arguments:** `/c "C:\Users\Sweez\Desktop\LAYO\CLAUDE\GAMEEVO\ESOCCER\KNOWLEDGE\extracted\run\auto.bat"`

`cmd /c` ensures the terminal closes when the .bat exits.

## File index

| Launcher | Wraps | Use case |
|---|---|---|
| `auto.bat` / `auto.ps1` | `_scrape_futbin_auto.js` | Nightly headless refresh (Task Scheduler) |
| `parallel.bat` / `parallel.ps1` | `_scrape_futbin_parallel.js` | Multi-worker page-range scrape |
| `headful.bat` / `headful.ps1` | `_scrape_futbin_headful.js` | First-time CF warm-up (visible browser) |
| `scrapling.bat` / `scrapling.ps1` | `_scrape_futbin_scrapling.py` | Python Scrapling-based scraper (anti-bot auto-solve) |
| `delta.bat` | `_scrape_futbin_new.js` | Delta-only scrape (new/changed rows) |
| `prices.bat` | `_scrape_futbin_prices.js` | Price-only refresh |
| `range.bat` | `_scrape_futbin_range.js` | Specific page range |
| `reverse.bat` | `_scrape_futbin_reverse.js` | High pages first |
| `filters.bat` | `_scrape_futbin_filters.js` | Filtered list (icons / heroes / etc) |
| `cookies.bat` | `_scrape_futbin_cookies.js` | Cookie dump |

## Auto-close rule

All `.bat` files end with `exit /b %ERRORLEVEL%`. All `.ps1` files use
`try { … } finally { exit $LASTEXITCODE }`. These guarantee:

- Window closes on success (exit 0)
- Window closes on Node/Python crash (non-zero exit)
- Exit code propagates to Task Scheduler for retry/alert logic

**Do not add `pause`** at the end of any launcher — that's what keeps
terminals open. If you need to debug a failing scraper, run the
underlying script directly without the launcher.
