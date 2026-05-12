# Vercel Account Migration Runbook — cade-league

**Goal:** move `cade-league` project from current Vercel Hobby account to another Vercel Hobby account. **Exact duplicate of current setup.** Same subdomain (`cade-league.vercel.app`), same env vars, same crons, same KV-backed rate limiting.

**Confirmed scope:**
- Same domain `cade-league.vercel.app` (no custom domain)
- Crons kept (`publish-announcements` every 5min, `squad-deadline-check` hourly — now driven by GitHub Actions `.github/workflows/cron.yml`, NOT Vercel cron, since Hobby tier rejects sub-daily schedules)
- One marketplace integration to replicate (Vercel KV / Upstash Redis for rate-limiting)
- No live broadcast timing constraint

**Estimated downtime:** ~30–60 seconds (window between deleting old project and renaming new to claim subdomain).

---

## Pre-Migration Status

| Item | Status |
|---|---|
| Hardcoded `cade-league.vercel.app` in runtime | None. Only docstrings + 2 dev scripts |
| Vercel KV | Used only by `apps/web/src/lib/rate-limit.ts`. Re-provision = reset rate-limit windows. No business state lost |
| Supabase DB | External (ref `vqzhczyugpaooegmolgk`). Unaffected |
| Custom domain | None. Pure `.vercel.app` |
| Crons | Driven by GitHub Actions (`.github/workflows/cron.yml`, commit `7adb71f6`). Hobby tier rejects sub-daily Vercel cron. Requires `CRON_SECRET` GitHub repo secret to match Vercel env var |

---

## Phase 0 — Pre-flight (5 min)

### 0.1 Confirm `.env.local` is complete

Open `apps/web/.env.local`. Verify these keys are present with values:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_PROJECT_REF
ANTHROPIC_API_KEY
RESEND_API_KEY
CRON_SECRET
APP_TIMEZONE
NG_FUTBIN_NATION_ID
OCR_DISABLED
OCR_DAILY_CAP_USD_CENTS
YOUTUBE_API_KEY
```

KV keys (`KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `REDIS_URL`) will be replaced on new account — ignore current values.

`BROADCAST_AMBIENT_SECRET` — check if set in old prod (Vercel dashboard → Settings → Environment Variables). If yes, copy value. If no, skip.

If any key above is missing from `.env.local`, copy it from old Vercel dashboard before Phase 2.2.

### 0.2 Confirm git clean

```bash
git status
git push origin main
```

Working tree clean + everything pushed. New account will import latest `main`.

### 0.3 Confirm no broadcast running

Check OBS / vMix isn't actively streaming. Cutover takes ~60s.

---

## Phase 1 — New account setup (no impact on prod, ~20 min)

### 1.1 Create new Vercel account

- Sign up at vercel.com with new email
- Choose Hobby tier
- Personal scope (no team)

### 1.2 Import repo

- Dashboard → Add New → Project → Import GitHub `Layott/cade-league-platform`
- New Vercel account authorizes GitHub access (you'll re-grant on Layott org)
- Framework: Next.js (auto-detected from `vercel.json`)
- Root Directory: keep default (`vercel.json` at repo root handles build via `cd apps/web && npm run build`)
- **Project name:** `cade-league-migration` (temporary — rename in Phase 2.3 after deleting old)
- **DO NOT click Deploy yet** — env vars first

### 1.3 Paste environment variables

Open `apps/web/.env.local` in editor. Vercel UI → Settings → Environment Variables → "Paste .env" → paste entire file contents (excluding `KV_*` and `REDIS_URL` lines — those come from new KV in §1.4).

Verify count matches `.env.local` minus KV keys. Set environment scope = Production + Preview + Development for each.

### 1.4 Provision Vercel KV

- Storage tab → Create Database → Marketplace → Upstash Redis (or "KV by Upstash")
- Region: pick closest to Supabase region (or `iad1` default)
- Connect to project — Vercel auto-injects `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`
- No data migration (rate-limit only — windows reset on cutover, harmless)

### 1.5 First deploy

- Vercel auto-triggers deploy after env + storage configured. If not, click Deploy
- Wait for green build (~3-5 min)
- Vercel assigns temp URL like `cade-league-migration-<hash>.vercel.app`

### 1.6 Smoke test temp URL

Replace `<TEMP>` with actual temp subdomain:

```bash
curl -I https://<TEMP>.vercel.app/
curl -I https://<TEMP>.vercel.app/overlay/v2/01-brb
curl -I https://<TEMP>.vercel.app/standings
curl -I https://<TEMP>.vercel.app/admin
```

Expected: 200/307. If 500 → check Vercel build logs + verify env vars all set.

Login as admin in browser, walk one flow (e.g. open `/admin/match-days`). Confirms Supabase auth round-trip works from new project.

### 1.7 Confirm GitHub Actions cron workflow runs

Cron schedules are NOT in Vercel (Hobby blocks sub-daily). Workflow lives at `.github/workflows/cron.yml`, fires `*/5 * * * *` + `0 * * * *` against the production URL using `X-Cron-Secret` header.

Required: GitHub repo Settings → Secrets and variables → Actions → New repository secret → `CRON_SECRET` = same value as the Vercel env var.

Verify on GitHub: repo → Actions tab → workflow `cron` → last run is green. If still empty (just-added secret), trigger manually via "Run workflow" button.

Vercel dashboard → new project → Settings → Cron Jobs should be EMPTY. Confirms no stale Vercel cron entries competing with GitHub Actions.

---

## Phase 2 — Cutover (~60 seconds downtime)

### 2.1 Pre-cutover checklist

- [ ] §1.6 smoke green on temp URL
- [ ] §1.7 crons visible
- [ ] No OBS scene currently live
- [ ] You're at a keyboard, can move fast

### 2.2 Delete old project

Old Vercel account → `cade-league` → Settings → General → bottom → Delete Project → confirm name `cade-league`.

**Effect:** `cade-league.vercel.app` subdomain freed within ~5 seconds. **Site goes dark.**

### 2.3 Rename new project (DO IMMEDIATELY — site is down until this completes)

New Vercel account → `cade-league-migration` → Settings → General → Project Name → change to `cade-league` → Save.

**Effect:** Vercel auto-assigns `cade-league.vercel.app` to new project. Site back up within ~30 seconds.

### 2.4 Verify subdomain claim

```bash
curl -I https://cade-league.vercel.app/
```

Expect 200/307 served by new deployment. If 404 → wait 60s + retry (Vercel DNS propagation).

---

## Phase 3 — Local re-link (5 min)

### 3.1 Re-link Vercel CLI

```bash
# Disconnect old project
rm -rf .vercel

# Re-link to new account
vercel login           # use new account credentials
vercel link            # scope = new account, project = cade-league
```

`.vercel/project.json` updates to new `projectId` + `orgId`.

### 3.2 No Supabase changes needed

Same domain → Supabase Auth → URL Configuration unchanged. Skip.

### 3.3 No external webhook changes needed

Same domain → any registered webhooks already point at correct URL. Skip.

---

## Phase 4 — Verification (per CLAUDE.md §12, ~10 min)

### 4.1 Public routes

```bash
for path in / /login /standings /fixtures /tournaments /players /orgs; do
  echo -n "$path → "
  curl -o /dev/null -s -w "%{http_code}\n" https://cade-league.vercel.app$path
done
```

Expected: 200 each.

### 4.2 Admin routes (unauth = 307 redirect)

```bash
for path in /admin /admin/match-days /admin/broadcast/v2 /admin/broadcast/v2/design /admin/players /admin/squads /admin/disputes; do
  echo -n "$path → "
  curl -o /dev/null -s -w "%{http_code}\n" https://cade-league.vercel.app$path
done
```

Expected: 307 each.

### 4.3 Overlay routes (all 16 v2 keys)

```bash
for key in 01-brb 02-replay 03-animated-bg-v1 04-h2h-2 05-h2h-3 06-h2h-5 07-leaderboard 08-lower-third 09-secondary-score-bug 10-up-next-bug 11-match-scores-day 12-starting-soon 13-stream-ended 14-top-scorers 15-orgs 16-coaches; do
  echo -n "/overlay/v2/$key → "
  curl -o /dev/null -s -w "%{http_code}\n" "https://cade-league.vercel.app/overlay/v2/$key?demo=1"
done
```

Expected: 200 each.

### 4.4 Broadcast flow (manual)

1. Login admin → `/admin/broadcast/v2`
2. Activate one session
3. Trigger overlay 04-h2h-2
4. Confirm iframe preview renders + postMessage payload arrives

### 4.5 Cron endpoints manual fire

Confirms endpoints reachable + accept header even if next scheduled GitHub Actions run is hours away.

```bash
# Use CRON_SECRET from .env.local (same value used by GitHub Actions repo secret)
SECRET=$(grep CRON_SECRET apps/web/.env.local | cut -d= -f2)
curl -H "X-Cron-Secret: $SECRET" https://cade-league.vercel.app/api/cron/publish-announcements
curl -H "X-Cron-Secret: $SECRET" https://cade-league.vercel.app/api/cron/squad-deadline-check
```

Both return 200 + log entries visible in new Vercel dashboard → Logs. Then verify last green GitHub Actions `cron` workflow run on the repo's Actions tab.

### 4.6 OBS browser-source check

Open one OBS scene that uses `cade-league.vercel.app/overlay/v2/<key>`. Reload browser source. Should render unchanged.

### 4.7 Email flow

Trigger password reset on signin page. Confirm email arrives + link domain is `cade-league.vercel.app` (not temp subdomain). If email link uses temp subdomain → check `apps/web/src/server/email/*` for hardcoded base URL.

---

## Rollback note

Once Phase 2.2 fires (old project deleted), no rollback. Subdomain frees + new project must take it. Make §1.6 smoke test thorough. Supabase DB untouched throughout → zero data loss risk.

---

## What changes vs current setup

| Item | Old account | New account |
|---|---|---|
| `cade-league.vercel.app` URL | Same | Same |
| Supabase DB connection | Same | Same |
| Env var VALUES | Same | Same |
| Vercel KV connection strings | Old instance | NEW instance (auto-injected) |
| Cron driver | Vercel Cron (Hobby allowed) | GitHub Actions (`.github/workflows/cron.yml`) — Hobby on new account rejects sub-daily |
| Vercel CLI `.vercel/project.json` | Old projectId | New projectId |
| 4hr Fluid Active CPU cap | Resets monthly | **Same cap, same limit** |

**Compute cap unchanged.** Migration achieves no compute relief. If that's the actual problem → Pro upgrade ($20/mo, 1000hr CPU) on either account.
