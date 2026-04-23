# Futbin auto-refresh setup

Keeps `fc26_players` fresh every night:
- Updates prices on all cards visible on Futbin
- Detects + inserts new cards EA drops (promos, icons, heroes, TOTY/TOTS releases)
- Logs every run for visibility

## One-time warmup (manual)

1. Ensure Sharp VPN (UK) is active.
2. Run the **headful** scraper — it opens a visible Chromium window so Cloudflare can fingerprint a real browser and store trust in a persistent profile:
   ```
   node KNOWLEDGE/extracted/_scrape_futbin_headful.js
   ```
3. When the window loads the `/26/players` list, press ENTER in terminal.
4. Let the scrape finish.

The persistent profile lives at `KNOWLEDGE/extracted/.futbin_chromium_profile/`. After this first pass, subsequent runs can go headless.

## Nightly unattended run

```
node KNOWLEDGE/extracted/_scrape_futbin_auto.js
```

- Launches persistent Chromium **headless**, reuses warmed cookies.
- Probes page 1 first — if 0 rows (CF trust expired), exits with status code 2 + tells you to re-run the headful warmup.
- On success: walks all pages, upserts prices / card images / variants, INSERTs new cards.
- Logs to `futbin_auto_runlog.json` (rolling 60 runs).
- Dumps newly-discovered cards to `futbin_auto_new.json` so you can see what EA dropped since the last run.

## Schedule with Windows Task Scheduler

1. Open **Task Scheduler** (Start → type "task scheduler").
2. **Create Basic Task** → Name: `Futbin Refresh`, Trigger: Daily at **03:00 AM**.
3. **Action** → Start a program:
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `KNOWLEDGE\extracted\_scrape_futbin_auto.js`
   - Start in: `C:\Users\Sweez\Desktop\LAYO\CLAUDE\GAMEEVO\ESOCCER`
4. **Conditions** tab → uncheck "Start only if computer is on AC power" if you want it to run on battery.
5. **Settings** tab → check "Run task as soon as possible after a scheduled start is missed" so a missed night catches up.
6. Before saving, set the account to run whether you are logged on or not (for PC-asleep wake via wake timer if that's wanted).

**Critical:** the VPN needs to be connected when the task fires. If you use Sharp VPN's auto-connect-on-boot, you are covered. If not, either leave Sharp running, or schedule the VPN to start 5 minutes before the scrape.

## What to check each morning

1. `KNOWLEDGE/extracted/futbin_auto_runlog.json` — last N runs with stats. Ensure the newest has `finishedAt` (not just `startedAt`).
2. `KNOWLEDGE/extracted/futbin_auto_new.json` — new cards inserted last run. Empty most nights; non-empty on EA promo-release days.
3. Supabase: `select count(*) from public.fc26_players where attributes->>'price_source'='futbin_live' and (attributes->>'price_snapshot_at')::timestamptz > now() - interval '36 hours';` — expect >90% of live-price rows refreshed.

## When things break

| Symptom | Fix |
|---|---|
| `_scrape_futbin_auto.js` exits code 2 (`0 rows`) | Run the headful script to refresh CF trust. |
| `Profile dir missing` | Run the headful script — it creates the profile on first launch. |
| All pages return 0 partway through | CF flipped mid-run. Re-run auto; if still 0, run headful. |
| VPN dropped mid-run | Script saves state every 10 pages; re-run picks up from `state.lastPage + 1`. |

## Disabling

Delete or disable the scheduled task in Task Scheduler. The scripts keep working standalone.
