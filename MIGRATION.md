# Vercel Account Migration Runbook — cade-league

**Goal:** move `cade-league` project from current Vercel account to a different Vercel Hobby account, preserving the `cade-league.vercel.app` URL so OBS scenes, vMix layouts, social shares, and bookmarked links keep working.

**Estimated downtime:** ~2–5 minutes (window between deleting old project and renaming new project to claim the subdomain).

---

## Pre-Migration Status

| Item | Status |
|---|---|
| Hardcoded `cade-league.vercel.app` in runtime code | None. Only docstrings + 2 local dev scripts (`_capture-player-shots.mjs`, `_build-player-guide.mjs`). Safe to leave |
| Vercel KV (`KV_*` / `REDIS_URL`) | Used only by `rate-limit.ts`. Safe to re-provision — data loss = reset rate-limit windows (no business state) |
| Supabase DB | External (ref `vqzhczyugpaooegmolgk`). Unaffected by Vercel migration |
| Custom domain | **TBC** — confirm in Phase 0 |
| Crons | Routes exist at `/api/cron/publish-announcements` + `/api/cron/squad-deadline-check`. Not in `vercel.json`. **Verify Vercel dashboard schedules in Phase 0** |
| Webhooks (Supabase, Resend, scraper callbacks) | **TBC** — inventory in Phase 0 |

---

## Phase 0 — Pre-flight (BEFORE touching new account)

### 0.1 Confirm current Vercel state

Open old Vercel dashboard → `cade-league` project. Record:

- [ ] **Custom domain?** Settings → Domains. List every domain pointing here (e.g. `cade.gg`). If empty, only `cade-league.vercel.app` exists
- [ ] **Cron schedules?** Settings → Cron Jobs. Note each entry (path + schedule). Hobby limits to daily-only on free tier — verify current schedule fits
- [ ] **Marketplace integrations?** Settings → Integrations. List each (e.g. Upstash, Vercel KV, anything else)
- [ ] **Production deployment URL** — copy current prod URL for reference (e.g. `cade-league-abc123.vercel.app`)
- [ ] **Environment variable count** — Settings → Environment Variables. Note count per env (Production / Preview / Development)

### 0.2 Backup env vars locally

Your existing `apps/web/.env.local` already holds the live prod values (admin dev workflow). No CLI pull needed. Confirm it has all keys listed in §1.3 by opening the file in an editor.

If any key listed in §1.3 is missing from `apps/web/.env.local`, fetch it from old Vercel dashboard → Settings → Environment Variables before deleting the project.

(Vercel CLI is NOT installed — per session-start reminder. `vercel env pull` would normally work but install + auth take time. Hand-copy from `.env.local` is faster.)

### 0.3 Backup Supabase

```bash
npm run db:dump
```

(Already runs daily per CLAUDE.md. Safety net.)

### 0.4 Inventory external webhooks

Check each provider for webhook URLs registered against old project:

- [ ] **Supabase dashboard** → Auth → URL Configuration → Site URL + Redirect URLs (these will need update if domain changes)
- [ ] **Supabase dashboard** → Database → Webhooks (any URL hitting cade-league.vercel.app?)
- [ ] **Resend dashboard** → Webhooks (any?)
- [ ] **YouTube API** — domain restrictions on API key?
- [ ] **GitHub repo** → Settings → Webhooks (Vercel deploy webhook will be replaced automatically on re-link)

### 0.5 Sanity check current prod

Hit a few endpoints to baseline behavior:

```bash
curl -I https://cade-league.vercel.app/
curl -I https://cade-league.vercel.app/overlay/v2/01-brb
curl -I https://cade-league.vercel.app/standings
```

All should return 200 / 307. If anything's already broken, fix BEFORE migrating.

---

## Phase 1 — New account setup (no impact on prod)

### 1.1 Create new Vercel account

- Sign up at vercel.com with new email
- Choose Hobby tier
- Skip team creation (Hobby = personal only)

### 1.2 Import repo

- Add New → Project → Import GitHub `Layott/cade-league-platform`
- Authorize new Vercel account to access GitHub repo (GitHub will prompt)
- Framework: Next.js (auto-detected)
- Root Directory: `apps/web` (Vercel reads `vercel.json` for build command)
- **Project name:** pick a TEMPORARY name like `cade-league-migration` — we'll rename to `cade-league` only AFTER deleting old project
- **DO NOT click Deploy yet**

### 1.3 Set environment variables

Open `apps/web/.env.local` in editor. Paste each `KEY=VALUE` into new Vercel project's Settings → Environment Variables → "Paste .env" bulk-add (faster than one-by-one).

Critical keys (must be present):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_PROJECT_REF
ANTHROPIC_API_KEY
RESEND_API_KEY
CRON_SECRET
BROADCAST_AMBIENT_SECRET
APP_TIMEZONE=Africa/Lagos
NG_FUTBIN_NATION_ID=133
OCR_DISABLED=1
OCR_DAILY_CAP_USD_CENTS=100
YOUTUBE_API_KEY
```

KV/Redis keys — handled in Phase 1.4 below.

### 1.4 Provision Vercel KV (new instance)

- Storage tab → Create Database → Upstash Redis (or KV — Marketplace product)
- Connect to project
- Vercel auto-injects `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`
- No data migration needed (rate-limit only)

### 1.5 Configure cron jobs (if any)

If Phase 0.1 found cron schedules in old dashboard, recreate in new project: Settings → Cron Jobs → Add. Use same path + schedule.

**Hobby tier limits:** as of 2026-Q1, Hobby supports unlimited crons but daily-only on free tier. If old schedules were more frequent and worked, account may have been grandfathered or upgraded — adjust schedule or use external scheduler (GitHub Actions `schedule:`) if needed.

### 1.6 First deploy (on temp subdomain)

- Trigger first deploy (Deploy button)
- Wait for green build
- Vercel assigns temp URL like `cade-league-migration-<hash>.vercel.app`

### 1.7 Smoke test temp URL

```bash
# Replace <TEMP> with assigned temp subdomain
curl -I https://<TEMP>.vercel.app/
curl -I https://<TEMP>.vercel.app/overlay/v2/01-brb
curl -I https://<TEMP>.vercel.app/standings
curl -I https://<TEMP>.vercel.app/admin
```

All should return 200 / 307. If any 500, check Vercel build logs + env vars.

Walk one admin login flow manually in browser — confirm Supabase auth works from new project against existing DB.

---

## Phase 2 — Cutover (~2–5 min downtime window)

### 2.1 Pre-cutover checklist

- [ ] Phase 1.7 smoke test green on temp URL
- [ ] No active broadcast running (don't migrate mid-live-stream)
- [ ] Old prod deploys frozen — no pending PRs about to merge

### 2.2 Delete old project

Old account → `cade-league` project → Settings → Delete Project. Confirms the name.

**Effect:** `cade-league.vercel.app` subdomain freed within seconds. **Site goes down.**

### 2.3 Rename new project to claim subdomain (DO IMMEDIATELY)

New account → `cade-league-migration` project → Settings → General → Project Name → change to `cade-league` → Save.

**Effect:** Vercel auto-assigns `cade-league.vercel.app` to new project. Site comes back up within ~30s.

### 2.4 Verify subdomain claim

```bash
curl -I https://cade-league.vercel.app/
```

Should return 200/307 served by new deployment. If 404 (project not found) — refresh, give Vercel ~60s to propagate DNS.

### 2.5 If custom domain in play

If Phase 0.1 found custom domains:

- Old account (already deleted) — domain auto-released
- New account → `cade-league` → Settings → Domains → Add → enter domain
- DNS unchanged (still points to Vercel's edge). Re-verification = automatic
- Brief SSL re-issuance ~30s

---

## Phase 3 — Post-cutover updates

### 3.1 Supabase Auth URL config

Supabase dashboard → Authentication → URL Configuration:

- **Site URL:** keep `https://cade-league.vercel.app` (unchanged)
- **Redirect URLs:** unchanged

No change needed since subdomain preserved. **If custom domain different from old**, update both fields.

### 3.2 External webhooks

For each provider listed in Phase 0.4:

- If webhook URL hits `cade-league.vercel.app` → no change needed
- If webhook URL hit a Vercel-issued deployment URL (like `cade-league-abc.vercel.app`) → update to new prod URL

### 3.3 Re-link local CLI

```bash
# Disconnect old project link
rm -rf .vercel

# Re-link to new account's project
vercel link
# When prompted: scope = new account, project = cade-league
```

`.vercel/project.json` will update to new `projectId` + `orgId`.

### 3.4 Vercel CLI re-auth

```bash
vercel logout
vercel login
# Use new account credentials
```

### 3.5 No backup file to delete

Skipped — used `apps/web/.env.local` directly. Nothing to clean up.

---

## Phase 4 — Verification (per CLAUDE.md §12)

Run full route-by-route table. **Do not declare done until every row passes.**

### 4.1 Public routes

```bash
for path in / /signin /standings /fixtures /tournaments /players /orgs; do
  echo -n "$path → "
  curl -o /dev/null -s -w "%{http_code}\n" https://cade-league.vercel.app$path
done
```

Expected: 200 each.

### 4.2 Admin routes

```bash
for path in /admin /admin/match-days /admin/broadcast/v2 /admin/broadcast/v2/design /admin/players /admin/squads /admin/disputes; do
  echo -n "$path → "
  curl -o /dev/null -s -w "%{http_code}\n" https://cade-league.vercel.app$path
done
```

Expected: 307 (redirect to /signin when unauthenticated).

### 4.3 Overlay routes (all 16 v2 keys)

```bash
for key in 01-brb 02-replay 03-animated-bg-v1 04-h2h-2 05-h2h-3 06-h2h-5 07-leaderboard 08-lower-third 09-secondary-score-bug 10-up-next-bug 11-match-scores-day 12-starting-soon 13-stream-ended 14-top-scorers 15-orgs 16-coaches; do
  echo -n "/overlay/v2/$key → "
  curl -o /dev/null -s -w "%{http_code}\n" "https://cade-league.vercel.app/overlay/v2/$key?demo=1"
done
```

Expected: 200 each.

### 4.4 Broadcast flow

- Login as admin → /admin/broadcast/v2
- Activate one session
- Trigger one overlay (e.g. 04-h2h-2)
- Confirm postMessage arrives + overlay renders in iframe preview

### 4.5 Email flow

- Trigger password reset
- Confirm email arrives + link uses `cade-league.vercel.app/...` (NOT temp subdomain)

### 4.6 Cron endpoint manual fire

```bash
curl -H "X-Cron-Secret: $CRON_SECRET" https://cade-league.vercel.app/api/cron/publish-announcements
curl -H "X-Cron-Secret: $CRON_SECRET" https://cade-league.vercel.app/api/cron/squad-deadline-check
```

Both return 200 + log entries in Vercel logs.

### 4.7 Realtime check

Open `/standings` in browser. Update a match result in admin. Confirm standings auto-refresh via Supabase Realtime.

---

## Rollback (if cutover breaks)

If Phase 2.3 → Phase 4 reveals a deal-breaker:

1. Old project ALREADY DELETED — cannot directly restore
2. New project keeps `cade-league.vercel.app` — fix forward
3. If completely stuck: redeploy from `main` on new project, debug in place
4. Supabase + DB untouched — no data loss

**There is no clean rollback once Phase 2.2 fires.** Make Phase 1.7 smoke test thorough.

---

## Open questions to confirm BEFORE running Phase 2

Answer these in chat or in this file before starting cutover:

1. Custom domain on old project — yes/no, name?
2. Cron schedules in old Vercel dashboard — list paths + schedules?
3. Marketplace integrations beyond Vercel KV — any?
4. Active broadcasts scheduled in next 24h?
