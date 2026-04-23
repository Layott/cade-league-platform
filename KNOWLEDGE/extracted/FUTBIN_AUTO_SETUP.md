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

Two tasks, both on **Wed / Thu / Fri at 20:00** (8 PM local):

### Task 1 — Price refresh + new-card detection

1. **Start** → type "Task Scheduler" → open it.
2. **Create Task…** (NOT "Create Basic Task" — we need the weekly trigger options).
3. **General** tab:
   - Name: `Futbin Price Refresh`
   - Check "Run whether user is logged on or not"
   - Check "Run with highest privileges"
4. **Triggers** tab → **New…**:
   - Begin the task: **On a schedule**
   - Settings: **Weekly** → recur every 1 week → check **Wednesday**, **Thursday**, **Friday**
   - Start time: `20:00:00`
   - Check "Enabled" at the bottom. OK.
5. **Actions** tab → **New…**:
   - Action: **Start a program**
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `KNOWLEDGE\extracted\_scrape_futbin_auto.js`
   - Start in: `C:\Users\Sweez\Desktop\LAYO\CLAUDE\GAMEEVO\ESOCCER`
6. **Conditions** tab → uncheck "Start only if the computer is on AC power" (safe for laptops).
7. **Settings** tab → check "Run task as soon as possible after a scheduled start is missed".
8. OK → enter Windows password if prompted.

### Task 2 — Stats enrichment + update-detector

Repeat the above with these differences:
- Name: `Futbin Enrichment`
- Triggers: **Weekly** → **Wednesday / Thursday / Friday** at **20:30:00** (runs 30 min after the price refresh so the first task's Chromium profile is free)
- Action arguments: `KNOWLEDGE\extracted\_enrich_futbin_details.js`

**Critical:** Sharp VPN must be connected at 20:00 on those days. Best practice — set Sharp VPN to auto-connect on boot + leave the PC on Wed/Thu/Fri evenings. If the PC is off or asleep at 20:00, Task Scheduler re-runs the task on next wake (thanks to the "run as soon as possible after missed" flag).

### Quick-create via PowerShell (optional)

Paste this in an **elevated** PowerShell to create both tasks in one shot (adjust paths if your repo lives elsewhere):

```powershell
$repo = 'C:\Users\Sweez\Desktop\LAYO\CLAUDE\GAMEEVO\ESOCCER'
$node = 'C:\Program Files\nodejs\node.exe'

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Wednesday,Thursday,Friday -At 8pm
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest

Register-ScheduledTask -TaskName 'Futbin Price Refresh' `
  -Trigger $trigger -Settings $settings -Principal $principal `
  -Action (New-ScheduledTaskAction -Execute $node -Argument 'KNOWLEDGE\extracted\_scrape_futbin_auto.js' -WorkingDirectory $repo)

$trigger2 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Wednesday,Thursday,Friday -At '8:30pm'
Register-ScheduledTask -TaskName 'Futbin Enrichment' `
  -Trigger $trigger2 -Settings $settings -Principal $principal `
  -Action (New-ScheduledTaskAction -Execute $node -Argument 'KNOWLEDGE\extracted\_enrich_futbin_details.js' -WorkingDirectory $repo)

Get-ScheduledTask -TaskName 'Futbin*' | Format-Table TaskName, State, Triggers
```

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
