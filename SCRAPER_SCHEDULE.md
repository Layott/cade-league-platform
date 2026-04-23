# Scheduled Futbin Scrapes (Windows Task Scheduler)

The Futbin scrapers in `KNOWLEDGE/extracted/` write directly to the cloud Supabase DB — every change is live the moment it's upserted. To run them on a schedule without opening the Chromium window every time, point Windows Task Scheduler at the `.bat` launchers.

## One-time setup

1. Press `Win` and type "Task Scheduler". Open it.
2. Right-click **Task Scheduler Library** → **Create Basic Task…**
3. Name: `CADE Futbin Delta`.  Description: `Weekly delta scrape of new releases + price updates`.
4. Trigger: **Weekly**, Thursday 08:30 WAT (or your pick). Pre-deadline Thursday is ideal.
5. Action: **Start a program**.
   - Program/script: full path to `scrape-futbin-delta.bat` — e.g. `C:\Users\Sweez\Desktop\LAYO\CLAUDE\GAMEEVO\ESOCCER\scrape-futbin-delta.bat`
   - Start in: the repo root (same folder).
6. Finish. In the new task's **Properties**:
   - General tab: tick **Run whether user is logged on or not** only if you run headless. With the current headful + CF manual gate, keep "Run only when user is logged on" (you need to be at the PC to solve CF if challenged).
   - Conditions tab: untick "Start the task only if the computer is on AC power" if you run on battery.

## Caveats

- **VPN must be on.** Task Scheduler doesn't auto-start your UK VPN. If the VPN is off when the task fires, Futbin will 403. Either (a) configure the VPN client to auto-connect on login, (b) schedule the VPN to start 5 min before the scrape.
- **Cloudflare may challenge.** If CF shows a challenge, the scraper's manual gate pauses and waits for ENTER. That defeats "hands-off" automation. Mitigation: solve CF once in a manual run — the persistent Chromium profile at `.futbin_chromium_profile/` keeps the clearance cookie for ~30 min to 6 hrs. Scheduled runs within that window don't re-challenge.
- **Picker window cap.** The task shell auto-closes only if the `.bat` reaches the end (`pause` removed). The shipped `.bat` files `pause` at the start + end so you can eyeball the log. For true hands-off:
  - Make a copy of `scrape-futbin-delta.bat` named `scrape-futbin-delta-auto.bat`.
  - Delete the two `pause` lines.
  - Point the task at the `-auto` copy.

## Recommended cadence

| Task | Schedule | Purpose |
|---|---|---|
| Delta (top 10 pages, newest-first) | Thursday 08:30 WAT + Sunday 20:00 WAT | Catch EA's Thu + Fri drops + Sunday price swings before new match day |
| Full sweep | First Sunday each month 02:00 WAT | Belt-and-braces — re-verifies every card frame, stats, image URL |

## Verification after a scheduled run

- `KNOWLEDGE/extracted/futbin_new_state.json` — shows `lastRunAt` + per-run stats. If missing or stale, task didn't fire.
- `node KNOWLEDGE/extracted/_inspect_card.js` — prints the 10 most recently updated rows. Fast eyeball.
- Open `/player/squad` + search a card you know got a new price. Number should match Futbin live.
