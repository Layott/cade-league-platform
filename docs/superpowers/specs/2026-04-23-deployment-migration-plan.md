# CADE League Platform — Production Deployment Migration Plan

**Status:** Draft / research. 2026-04-23.
**Author:** Deployment planning investigation.
**Scope:** Move CADE League monolith from local Windows dev box to a globally accessible production environment. Supabase (Postgres / Auth / Storage / Realtime) is already cloud-hosted at project ref `vqzhczyugpaooegmolgk`. Everything else needs planning.

This document is a draft for the user to review and execute from. No code changes proposed here.

---

## 1. Executive Summary

**Recommended stack:**

- **Application host:** Vercel (Hobby → Pro). Next.js 15 App Router, React 19, native support for Server Actions, `runtime = "nodejs"`, Vercel Cron, edge-agnostic routing. The repo already ships a `vercel.json` with one cron wired up.
- **DNS + domain:** purchase apex domain (recommendation: `cadeesports.com` — already present in the codebase as the default Resend sender: `apps/web/src/lib/email/resend.ts:17`). Serve app on `app.cadeesports.com`; reserve apex for marketing later.
- **Database / Auth / Storage / Realtime:** Supabase cloud (existing project ref `vqzhczyugpaooegmolgk`, 30+ migrations applied) — unchanged.
- **Transactional email:** Resend (already integrated via `resend@^6.12.2`).
- **Logs / monitoring:** Vercel Observability tier + Supabase Logs + optional Sentry layer on top.
- **Scheduled jobs:** Vercel Cron for `/api/cron/*` routes (existing design, see `apps/web/src/app/api/cron/`). Futbin scraper stays off-Vercel (see §9).
- **Futbin scraper (long-running Chromium with CF cookies):** migrate out of Windows Task Scheduler to either an always-on cheap VPS (Hetzner CX11 / DigitalOcean $6/mo Droplet) or a Fly.io Machine that auto-starts on a schedule. This is the hardest deployment problem.

**Reasons Vercel wins:**

1. Zero-config for Next.js 15 + Server Actions + `serverExternalPackages` already declared in `apps/web/next.config.ts`.
2. Edge/CDN + image optimization baked in (the repo uses `sharp@^0.34.5` which Vercel packages natively).
3. The existing `vercel.json` + `export const maxDuration = 300` pattern in `apps/web/src/app/api/cron/fcdb-refresh/route.ts` assumes Vercel-style deployment already.
4. Preview deployments on every PR — parallel to CI lint+test+build.
5. Pay-as-you-go — Hobby tier likely sufficient for Elite Division (13 players + staff + one broadcast at a time). Pro tier ($20/mo) if the cron durations get close to the 60s Hobby cap or traffic requires.

**Alternatives considered (and why not):**

| Platform | Verdict | Reason |
|---|---|---|
| Fly.io Machines | Viable but heavier | Great for the Futbin worker, overkill for the web app. Would require a custom Dockerfile + manual Next.js production server + manual cron wiring. |
| Railway | Viable | Similar DX to Vercel but smaller ecosystem; Next.js 15 + Server Actions support lags 2-4 weeks behind Vercel. |
| Self-hosted VPS (Hetzner, DO, Linode) | Not recommended for the main app | Requires you to run `pm2` / `systemd` + reverse proxy + SSL renewal + CDN + image optimization yourself. Adds 2-3 weeks of ops burden before you have anything Vercel gives you free. Reasonable ONLY for the Futbin worker. |
| AWS Amplify / ECS Fargate | Not recommended | Cost + ops complexity dwarf the app's traffic profile. |

---

## 2. Repository Inventory

### 2.1 Structure

Monorepo (npm workspaces, no pnpm). Single deployable app at `apps/web`.

```
ESOCCER/
├── apps/web/                    # Next.js 15.5.15 app (deployable)
├── supabase/                    # 109 migrations, config.toml, seed.sql, tests
├── KNOWLEDGE/                   # 2.4 GB — NOT committed as-is (see §5.3)
│   ├── brand-assets/            # 2.1 GB — source RAWs, fonts, videos, processed images
│   │   ├── players/             # 1.9 GB (source ARW/CR3 RAW + processed PNGs)
│   │   ├── elements/            # 51 MB (HTML reference motion)
│   │   ├── videos/              # 58 MB (reference mp4s)
│   │   ├── fonts/               # 11 MB (Agharti, Quedora zips + extracted)
│   │   ├── logos/               # 2.1 MB
│   │   └── sounds/              # 20 KB
│   └── extracted/               # Futbin scrapers, rulebooks markdown, dumps
├── scripts/                     # bash / mjs / py seeding + smoke scripts
├── docs/                        # superpowers specs + ops runbooks
├── tasks/                       # todo.md + lessons.md (workflow state)
├── .github/workflows/ci.yml     # lint + test + build on push
├── vercel.json                  # one cron pre-configured
└── package.json                 # root scripts
```

- Root `package.json` proxies to `apps/web` via workspaces. `engines.node >=20`.
- `apps/web/next.config.ts` declares `serverExternalPackages: ["isomorphic-dompurify", "jsdom"]` — **this must carry to prod** (already in the file). Removing it re-introduces the CSS resolution bug that blocked Phase 1A.
- `.nvmrc` pins Node 20.

### 2.2 Runtime Stack

- Next.js 15.5.15 (App Router, React Server Components, Server Actions)
- React 19.1.0
- Supabase SDK: `@supabase/ssr@^0.10.2` + `@supabase/supabase-js@^2.104.0`
- Anthropic SDK: `@anthropic-ai/sdk@^0.90.0` (OCR — currently kill-switched via `OCR_DISABLED=1`)
- Email: `resend@^6.12.2`
- Validation: `zod@^4.3.6`
- Dates: `date-fns@^4.1.0` + `date-fns-tz@^3.2.0` (Africa/Lagos WAT, no DST)
- Animation: `framer-motion@^12.38.0`
- Image pipeline: `sharp@^0.34.5`
- Markdown / sanitize: `marked@^14.1.4` + `isomorphic-dompurify@^2.36.0`

### 2.3 Route Groups

Discovered under `apps/web/src/app/`:

| Group | Purpose | Middleware gate |
|---|---|---|
| `(public)` (implicit root) | `/welcome`, `/fixtures`, `/standings`, `/players`, `/punishments`, `/announcements` | None |
| `(auth)` | `/login`, `/profile` | None (handles its own auth) |
| `/admin/**` | Staff admin (20+ subroutes) | `src/middleware.ts` — admin/loc/idc/referee/production/moderator roles |
| `/player/**` | Player self-service (profile/squad/disputes/appeals) | Middleware — player + staff roles |
| `/referee/**` | Simplified attendance for refs (Plan 46) | Middleware — admin/moderator/referee |
| `(overlay)/overlay/*` | 36+ transparent browser-source pages for OBS/vMix | **Intentionally unauthenticated** — gated by per-session `view_token` on the data APIs |
| `/api/**` | Server route handlers (broadcast, cron, youtube, fcdb, notifications, admin) | Per-route perm checks |

### 2.4 Overlay URL Pattern (critical for producers)

Per `apps/web/README.md:37-43` + `apps/web/src/app/(overlay)/overlay/`:

```
https://<host>/overlay/<template-key>?session=<sessionId>&t=<view_token>
           (optional: &slot=primary|secondary    &debug=1)
```

- **37 overlay pages live** (from `ls apps/web/src/app/(overlay)/overlay/`): scorebar, lower-third, standings-widget, player-card, player-penalties, punishment-ticker, intro, outro, stinger-{intro,normal,replay,goal,miss,winner}, h2h-{2,3,5}, layout-{2pip,4pip,brb-basic,brb-full,casters-chat,animated-bg,timer}, leaderboard-animated, match-scores-day, starting-soon-{basic,timer}, stream-ended, top-scorers, orgs-roster, coach-intros, up-next-bug, featured-comment, design-preview, style-guide, storybook.
- `view_token` is minted per-session server-side and required via `?t=<token>` or `Authorization: Bearer <token>`. See `apps/web/src/server/broadcast/view_token_gate.ts`. Historical sessions with `view_token IS NULL` remain public for backward compat.
- `Cache-Control: no-store` set on `/api/broadcast/sessions/:id/active|instances|clock` so OBS/vMix/browser sources don't pin stale state after a redeploy. Verified at `apps/web/src/app/api/broadcast/sessions/[id]/active/route.ts:66-68`.

### 2.5 Test Infrastructure

- **Unit tests (Vitest):** colocated `foo.test.ts`. 432+ tests per CLAUDE.md.
- **E2E (Playwright):** `apps/web/tests/e2e/` — 30+ specs. Hits the **real cloud Supabase** via dev server on `http://127.0.0.1:3030`.
- **CI:** `.github/workflows/ci.yml` runs `npm ci && npm run lint && npm run test && npm run build` on push to main + all PRs. Does **NOT** run E2E (by design — E2E needs DB creds).

---

## 3. Environment Variables

Source: `apps/web/.env.example`, `apps/web/.env.local`, `docs/ops/*.md`, plus `grep -r "process.env"` across `apps/web/src/`.

### 3.1 Core runtime vars (required for ANY deployment to boot)

| Var | Classification | Consumed by | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | `lib/supabase/{server,browser,service}.ts`, `middleware.ts` | Already set — `https://vqzhczyugpaooegmolgk.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Same as above | JWT with `role=anon`, 10-year expiry. Rotate if exposed. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret (server-only)** | `lib/supabase/service.ts`, all cron routes, server actions | **DO NOT expose to client.** Rotates via Supabase dashboard → Project Settings → API. |

### 3.2 Feature vars

| Var | Classification | Consumed by | Required for prod? |
|---|---|---|---|
| `CRON_SECRET` | Secret | `api/cron/{fcdb-refresh,publish-announcements,squad-deadline-check}/route.ts` | **Yes.** 32+ byte random string. Shared between Vercel Cron + any external pokers. |
| `ANTHROPIC_API_KEY` | Secret | `server/stats_ocr/parse.ts`, `parse.claude.ts` | Only if flipping OCR on (`OCR_DISABLED=0`). |
| `OCR_DISABLED` | Config | `server/stats_ocr/parse.ts:65`, `app/admin/match-days/[id]/stats-upload/page.tsx:104` | Set to `0` when enabling OCR. `1` = kill switch (default). |
| `OCR_DAILY_CAP_USD_CENTS` | Config | `server/stats_ocr/parse.ts:55` | Default `100` ($1/day). Bump for broadcast days. |
| `YOUTUBE_API_KEY` | Secret | `server/youtube/{live,chat,channel}.ts` | Required for `/admin/broadcast/<id>` YouTube chat picker. Current key is in `.env.local` — rotate before going public. |
| `RESEND_API_KEY` | Secret | `lib/email/resend.ts` | If unset, emails print to stdout (`[email:stub]`). Required for real delivery. |
| `RESEND_FROM` | Config | `lib/email/resend.ts:17` | Default `CADE League <noreply@cadeesports.com>`. Domain must be DKIM/SPF/DMARC verified in Resend. |
| `APP_TIMEZONE` | Config | Several (advisory — most code hard-codes `Africa/Lagos`) | `Africa/Lagos`. |
| `NEXT_PUBLIC_OVERLAY_DEBUG` | Public | `(overlay)/OverlayFrame.tsx:140`, `lib/overlay-preview.ts` | Set `1` only on staging/preview; leaks debug HUD when `&debug=1` added to URL. |
| `FUTDB_API_KEY` | Secret | `server/fcdb/sources/futdb.ts:233` | For the `/api/cron/fcdb-refresh` futdb source. Free tier at https://futdb.co/settings/tokens (100 req/day). |
| `KAGGLE_API_TOKEN` / `KAGGLE_KEY` / `KAGGLE_USERNAME` | Secret | `server/fcdb/sources/kaggle.ts` | **Dev/self-hosted only.** Ignored on Vercel (no CLI available). |

### 3.3 Not needed in production

- `SUPABASE_PROJECT_REF` — only for the Supabase CLI (local `db:push`). Vercel doesn't need it.
- `SUPABASE_DB_URL` — only for the Python `_fc26_import.py` script, which you run locally.

### 3.4 Missing / recommended-new for prod

| Var | Why |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Currently absent (`grep` confirmed). Add `https://app.cadeesports.com` so server code and metadata have a canonical base URL for OG images, email links, etc. Most of the code is path-relative so this is a recommended future addition, not a blocker. |
| `SENTRY_DSN` (optional) | If adding Sentry — see §11. |

### 3.5 Where to set them

- **Vercel UI** (Project → Settings → Environment Variables) for most things. Toggle Production / Preview / Development scopes per-var.
- **Vercel CLI** (`vercel env add X production`) for bulk scripted setup. Do NOT check `.env.local` into git — it's already gitignored.
- **`NEXT_PUBLIC_OVERLAY_DEBUG`**: set to `1` on Preview only, NEVER on Production.

### 3.6 Rotation plan

On first production deploy, rotate these **once**: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `YOUTUBE_API_KEY`, `ANTHROPIC_API_KEY` (when enabling), `RESEND_API_KEY`. Then schedule quarterly rotation in a calendar reminder. Runbook for YouTube key already exists: `docs/ops/youtube-api-key.md`.

---

## 4. Hosting Choice — Detailed Trade-off

### 4.1 Vercel Pro ($20/mo) — recommended

**Pros:**
- Next.js 15 + React 19 first-class; Vercel ships feature parity within days.
- Server Actions, streaming, dynamic routing, `serverExternalPackages`, image optimization all zero-config.
- Vercel Cron already referenced in `vercel.json` + `apps/web/src/app/api/cron/fcdb-refresh/route.ts:9` (with `maxDuration = 300`).
- Branch-preview deployments give you free staging; every PR gets a URL.
- SSL + HTTP/2 + HTTP/3 automatic on custom domains.
- Built-in log drain + analytics; easy Sentry integration.
- Fluid Compute ("active CPU" pricing) means bursty broadcast days don't murder the bill.

**Cons:**
- Serverless function 60s hard cap on Hobby (300s on Pro). `fcdb-refresh` already asks for 300s — you effectively need Pro.
- No persistent disk. Any scraper needing Chromium cookies + profile state is a non-starter on Vercel. (See §9 for Futbin plan.)
- `export const runtime = "nodejs"` is used on every API route we audited — no Edge Runtime bundling savings to harvest.
- Vendor lock (limited, but the crons + cookie/session behavior are Vercel-shaped).

**Config specifics:**
- Framework preset: "Next.js" (autodetected).
- Root directory: `.` (monorepo root). Vercel will detect `apps/web` from the workspace config.
- Build command: **override to** `npm run build` (the root script already forwards to `apps/web`).
- Output directory: `apps/web/.next` (Vercel will find this automatically).
- Install command: `npm install`.
- Node.js version: 20 (matches `.nvmrc`).

### 4.2 Fly.io — for the Futbin worker only

- Great fit for the Futbin scraper's persistent Chromium profile + optional Sharp-VPN sidecar.
- Fly Machines can auto-stop between runs (`auto_stop_machines = true`) to save money.
- Not worth managing the web app here.

### 4.3 Self-hosted VPS — if budget is truly zero

- Hetzner CX11 ~€4/mo, Nginx + `pm2` + certbot.
- You inherit: SSL renewal, reverse-proxy config, image-optimization CDN, HTTP/2, log aggregation, process restart, OS patching.
- Only do this if you've already run production Next.js and have zero budget. Every hour you spend on this is an hour not building product.

---

## 5. Assets & Storage

### 5.1 What's in `apps/web/public/` (deployed with app bundle)

```
20 MB total
├── brand/logos/{primary,partners}/*.png     # 5.5 MB — core brand
├── overlay/sounds/{brand,stingers,ui}/*.wav # 3.6 MB — 10 sound files for overlays
└── players/{player_slug}/headshot_01..03.png  # 11 MB — 13 players × 3 headshots
```

**Decision: keep committed and served from `apps/web/public/`.** Under 30 MB total; Vercel caches at CDN; zero config. Confirmed via `apps/web/src/lib/brand.ts` that logos are referenced as `/brand/logos/primary/cade.png` — these are the shipped copies, not the 2.1 GB `KNOWLEDGE/brand-assets/` source tree.

### 5.2 What's in `KNOWLEDGE/brand-assets/` (2.1 GB — source archive)

| Subdir | Size | Status | Disposition |
|---|---|---|---|
| `players/` RAW ARWs/CR3s | 1.9 GB | Git-LFS tracked per `docs/ops/git-lfs.md` | Do NOT ship to Vercel. Deployed artifacts come from `apps/web/public/players/` (already processed 1.x-series PNGs from `_process.py`). |
| `players/processed/` | 206 MB | Source for `public/players/` regeneration | Keep in repo but NOT deployed; used by `scripts/sync-player-photos.mjs`. |
| `videos/` reference mp4s | 58 MB | Reference for overlay motion only | Already soft-excluded — not referenced at runtime by app code. |
| `elements/` HTML reference | 51 MB | Designer-HTML source of each overlay | Reference only; not deployed. Every overlay page in `apps/web/src/app/(overlay)/overlay/` has a comment like `Motion port from KNOWLEDGE/brand-assets/elements/NN_*.html`. |
| `fonts/` | 11 MB (mostly zip duplicates) | Source zips; extracted `.woff2` already in `apps/web/src/app/fonts/` | `apps/web/src/app/fonts/Agharti-*.woff2` + `Quedora-*.woff2` are what actually ship. These are loaded via `next/font/local` in `app/layout.tsx:9-27`. |
| `logos/` | 2.1 MB | Source | Already mirrored to `apps/web/public/brand/logos/` per `lib/brand.ts` docstring. |
| `sounds/` | 20 KB | Source | Already mirrored to `apps/web/public/overlay/sounds/`. |

**Decision:**

- **Do not ship `KNOWLEDGE/` to Vercel.** Add it to `.vercelignore` during deployment setup (create at repo root).
- The `.gitignore` already excludes `fonts/*.zip` and scraper cache dirs. Main concern is that git-LFS RAWs still flow through git clone on Vercel's build step. Either:
  - (a) Keep the LFS data; Vercel will download the LFS pointers lazily and `.vercelignore` will prevent them from being included in the function bundle. **Simpler, recommended.**
  - (b) Create a shallow mirror branch (`vercel-deploy`) that excludes `KNOWLEDGE/brand-assets/players/*.{ARW,CR3}` at a git level — overkill.

### 5.3 Supabase Storage buckets (already provisioned via migrations)

Listed via `ls supabase/migrations/ | grep bucket`:

| Bucket | Migration | Purpose | Public? |
|---|---|---|---|
| `squad-screenshots` | `20260428000105_storage_squad_bucket.sql` | Player squad screenshots | Private (signed URL reads) |
| `match-stat-screenshots` | `20260504000003_storage_match_stat_screenshots_bucket.sql` | OCR upload targets | Private |
| `plan13b` buckets | `20260505000002_plan13b_storage_buckets.sql` | Disputes + appeals attachments | Private |
| `org-logos` | `20260507000301_org_logos_bucket.sql` | Organization logo uploads | Public-read |
| `overlay-assets` | `20260512000100_plan48_overlay_assets_bucket.sql` | Admin-uploaded overlay images + videos | **Public-read** + service-role writes |

All already applied to the cloud project. Before go-live, confirm `npx supabase db query --linked "select id, public from storage.buckets;"` lists all five.

### 5.4 Git LFS impact on Vercel build

`docs/ops/git-lfs.md` notes the repo weighs ~1.7 GB with 41 RAW files in history. Vercel's default build does a shallow git-LFS fetch. Watch for:
- Free-tier LFS bandwidth cap (1 GB/mo) — Vercel's build counts against the repo's LFS bandwidth. If you trigger a lot of redeploys or tests, you may hit the cap.
- **Mitigation:** add `KNOWLEDGE/brand-assets/**` to `.vercelignore` so even if LFS objects exist, they're not uploaded into function bundles. The repo already committed processed PNGs into `apps/web/public/`, so the app doesn't need LFS RAWs at runtime.

---

## 6. Supabase Cloud Readiness

### 6.1 Project status

- Ref: `vqzhczyugpaooegmolgk` (per `apps/web/.env.local` + `MEMORY.md`).
- 109 migrations in `supabase/migrations/`. Per CLAUDE.md + tasks/todo.md review sections these are all applied to cloud via `npm run db:push`.
- Current seed: `supabase/seed.sql` (dev bootstrap only; production seeds via `npm run seed:*` scripts if needed).

### 6.2 Pre-launch DB checklist

Run before flipping DNS to prod:

```bash
# 1. Confirm every migration applied.
npx supabase db query --linked "select name from supabase_migrations.schema_migrations order by name desc limit 10;"
# Should show 20260513000100_plan48_1_per_instance_match_clock as the latest.

# 2. Confirm RLS enabled on the 6 PII/financial tables.
npx supabase db query --linked \
  "select tablename, rowsecurity from pg_tables \
   where schemaname='public' and tablename in ('users','players','organization_contracts','caution_ledger_entries','disputes','appeals');"
# All should show rowsecurity = true.

# 3. Confirm all 5 storage buckets exist.
npx supabase db query --linked \
  "select id, public from storage.buckets order by id;"
# Expect: match-stat-screenshots, org-logos, overlay-assets (public), plan13b-*, squad-screenshots.

# 4. Count of fixtures + players + match_days.
npx supabase db query --linked \
  "select (select count(*) from players where deleted_at is null) as players,
          (select count(*) from matches where deleted_at is null) as matches,
          (select count(*) from match_days where deleted_at is null) as match_days,
          (select count(*) from seasons where status='active') as active_seasons;"
# Expect: 13 players, 78 matches (round-robin), N match_days, 1 active season.

# 5. Confirm append-only triggers attached to audit_events + caution_ledger_entries + ocr_usage_log.
npx supabase db query --linked \
  "select tgname, tgrelid::regclass from pg_trigger \
   where tgname like '%_append_only%' or tgname like '%_immutable%';"
```

### 6.3 Supabase config changes for prod

In Supabase Dashboard:

1. **Auth → URL Configuration:**
   - **Site URL** = `https://app.cadeesports.com`
   - **Redirect URLs** (additional) = `https://app.cadeesports.com/**`, `https://*.vercel.app/**` (for preview deploys).
2. **Auth → Providers → Email:** confirm email signup enabled. For a closed league, you may want to disable self-signup and pre-seed users via admin UI.
3. **Auth → Rate Limits:** tighten based on expected traffic. Defaults are OK.
4. **Project Settings → API → Realtime:** confirm enabled (required for overlay bridge — see `README.md:28-31`).
5. **Project Settings → Database → Connection pooling:** confirm session + transaction pools are live. Not used by the web app but needed for cron/workers.
6. **Project Settings → Database → Network Restrictions:** OPTIONAL — restrict direct psql connections to specific CIDRs (your home IP, Fly.io exit IPs if using a worker). Recommended once stable.
7. **Project Settings → Database → SSL enforcement:** enable once comfortable.
8. **Storage → Policies:** confirm the `overlay-assets` bucket is public per `20260512000100_plan48_overlay_assets_bucket.sql`.

### 6.4 Password reset for dev admin

Before launch, rotate the `admin@cade.local` password (currently `dev-admin-2026` per `MEMORY.md`) to a proper 12+ char secret and update it in whatever password manager the team uses.

---

## 7. Domain, DNS, and SSL

### 7.1 Domain recommendation

Purchase / verify control of **`cadeesports.com`** (or variant — the Resend default in code is `noreply@cadeesports.com`, so this matches). Registrars to consider: Porkbun (cheapest, good DNS), Cloudflare Registrar (at-cost, fastest DNS propagation), Namecheap.

Recommended hostname plan:

| Hostname | Use | Vercel/DNS |
|---|---|---|
| `cadeesports.com` (apex) | Marketing/landing (future) or redirect to app | Optional — keep parked for now |
| `app.cadeesports.com` | The platform | **CNAME to `cname.vercel-dns.com.`** |
| `www.cadeesports.com` | Redirect → `app.cadeesports.com` | Vercel handles redirect |

Why `app.` subdomain? Lets you use apex for marketing/blog later without colliding with the SaaS. Also simplifies cookie scoping (see §7.3).

### 7.2 Vercel DNS setup

1. In Vercel project: Settings → Domains → Add `app.cadeesports.com`.
2. Vercel shows either a CNAME or A record to add. CNAME is canonical.
3. In your DNS registrar's zone: `app CNAME cname.vercel-dns.com.` (TTL 300).
4. Vercel auto-issues Let's Encrypt SSL cert. Verify cert chain resolves globally via `https://www.ssllabs.com/ssltest/`.
5. Add `*.vercel.app` to Supabase Auth redirect URLs (for preview deploy logins).

### 7.3 Cookie scoping

The Supabase SSR cookies (`sb-*`) default to the request host. Since auth happens at `app.cadeesports.com`, cookies will be scoped there automatically. **Do NOT** try to share cookies with `cadeesports.com` apex unless you also serve a real endpoint there.

### 7.4 Email DNS (Resend)

In your DNS zone, add records Resend generates when you add `cadeesports.com` as a sending domain:

| Record | Type | Purpose |
|---|---|---|
| `resend._domainkey.cadeesports.com` | TXT | DKIM signing — Resend generates the value |
| `cadeesports.com` | TXT (`v=spf1 include:resend.net ~all`) | SPF |
| `_dmarc.cadeesports.com` | TXT (`v=DMARC1; p=quarantine; rua=mailto:postmaster@cadeesports.com`) | DMARC — start at `p=none` for 2 weeks, then tighten |
| `send.cadeesports.com` | MX (priority 10, `feedback-smtp.us-east-1.amazonses.com`) | Bounce return path (Resend uses SES) |

Then in Resend Dashboard → Domains → Verify `cadeesports.com`. Once green, Resend prefers the verified domain over the default shared sender. After verification, `RESEND_FROM` in Vercel env stays as `CADE League <noreply@cadeesports.com>`.

### 7.5 Optional: Cloudflare proxy

If you want DDoS shielding + bot challenge in front of Vercel:

- Move DNS to Cloudflare.
- CNAME `app` to `cname.vercel-dns.com` with **orange cloud off** (Cloudflare proxy) — Vercel's own CDN is fine and they don't love being proxied.
- Alternative: orange cloud on, set SSL mode to Full (strict), and add Vercel to Cloudflare's "Authenticated Origin Pulls" allowlist.

Recommended: skip Cloudflare proxy for Phase 1. Vercel's edge is sufficient. Add it if you ever get DDoS'd during a broadcast.

---

## 8. Streaming / Overlay URL Production Readiness

### 8.1 What producers need (documentation handoff)

Once deployed, producers should bookmark:

```
https://app.cadeesports.com/overlay/<key>?session=<sessionId>&t=<viewToken>
```

Where `<key>` is one of: `scorebar`, `lower-third`, `standings-widget`, `player-card`, `punishment-ticker`, `intro`, `outro`, `stinger-goal`, `stinger-miss`, `stinger-winner`, `h2h-2`, `h2h-3`, `h2h-5`, `layout-2pip`, `layout-4pip`, `layout-brb-basic`, `layout-brb-full`, `layout-casters-chat`, `layout-animated-bg`, `layout-timer`, `leaderboard-animated`, `match-scores-day`, `starting-soon-basic`, `starting-soon-timer`, `stream-ended`, `top-scorers`, `orgs-roster`, `coach-intros`, `up-next-bug`, `featured-comment`, `player-penalties`, `design-preview`, `style-guide`.

The admin broadcast control page (`/admin/broadcast/<sessionId>`) surfaces a "Copy URL" action per overlay with the right token baked in — you don't need to hand-compose URLs. Confirm this is shown to producers via README walkthrough.

### 8.2 Realtime reliability

The overlay hydration flow (see `apps/web/src/app/(overlay)/useOverlayChannel.ts:1-60`) does:

1. Initial fetch of `/api/broadcast/sessions/:id/active?template_key=<k>` — primes the UI.
2. Subscribes to Supabase Realtime channel `overlay:<sessionId>` — listens for `overlay.triggered`, `overlay.cleared`, `session.ended` broadcasts.
3. No WebSocket → no animation changes. (Supabase Realtime fallback is long-polling but latency jumps from <100ms to 1-2s.)

**Prod requirements:**
- Realtime must be enabled in Supabase dashboard (Project Settings → API → Realtime). Verify.
- No CDN sits in front of the WebSocket. Supabase serves Realtime from its own edge.
- Vercel does NOT proxy WebSockets — the browser connects directly to Supabase over `wss://vqzhczyugpaooegmolgk.supabase.co/realtime/v1/*`. Confirm browser source tools (OBS, vMix) allow outbound 443 (they do by default).
- `Cache-Control: no-store` already on all the broadcast REST endpoints. ✅

### 8.3 Session affinity

Not a concern — every request is stateless (cookies + service-role DB access). No sticky sessions needed.

### 8.4 Debug mode

`NEXT_PUBLIC_OVERLAY_DEBUG=1` enables a HUD when you add `&debug=1` to the URL. **Set to `1` on Preview only, NEVER Production.** Adding the env var at Production exposes the HUD to anyone guessing `&debug=1`.

---

## 9. Background Jobs / Scheduled Work

### 9.1 Inventory

Three cron routes in the codebase — all guarded by `CRON_SECRET`:

| Route | Cadence (recommended) | Purpose |
|---|---|---|
| `/api/cron/fcdb-refresh` | `0 2 * * *` (02:00 UTC = 03:00 WAT) — **already set in `vercel.json`** | Nightly FC 26 catalogue refresh (Kaggle → futdb → sofifa fallback). 300s maxDuration. |
| `/api/cron/publish-announcements` | `*/5 * * * *` (every 5 min) | Publishes scheduled announcement rows past `scheduled_publish_at`. |
| `/api/cron/squad-deadline-check` | `0 */1 * * *` (hourly) | Issues auto-warnings for players who missed Thursday 23:59 WAT deadline. |

Plus the Windows-Task-Scheduler-driven **Futbin scraper** (`KNOWLEDGE/extracted/_scrape_futbin_auto.js`) which runs Wed/Thu/Fri at 20:00 WAT.

### 9.2 Production cron strategy

Amend `vercel.json` to:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/fcdb-refresh",        "schedule": "0 2 * * *" },
    { "path": "/api/cron/publish-announcements","schedule": "*/5 * * * *" },
    { "path": "/api/cron/squad-deadline-check", "schedule": "0 * * * *" }
  ]
}
```

**Notes:**
- Vercel Cron sends `GET` requests. All three routes support GET. ✅
- Vercel Cron does NOT send custom headers — each of our routes checks `x-cron-secret`. **This is broken on Vercel as-is.** Two remediation options:
  - **(Recommended)** Amend the cron routes to ALSO accept Vercel's `Authorization: Bearer $CRON_SECRET` convention. Vercel Cron injects this automatically when `CRON_SECRET` is set as an env var — see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs. **This is a small code change needed before launch.**
  - Or fall back to GitHub Actions cron (free) that sends the `X-Cron-Secret` header explicitly.
- Hobby plan allows up to 2 cron jobs. **Pro is required** to run all three. Pro is likely needed anyway for the 300s `fcdb-refresh` maxDuration.
- Each Vercel Cron run counts against monthly function invocations.

### 9.3 Futbin scraper — HARD PROBLEM

The scraper has three requirements that **cannot be met on Vercel or any standard serverless host:**

1. **Persistent Chromium profile** (`.futbin_chromium_profile/`) so Cloudflare doesn't re-challenge every run. File-based state, needs a real disk.
2. **Long runtime** — walks N pages of results, can take 20-60 min.
3. **UK VPN** — Sharp VPN mandatory per `FUTBIN_AUTO_SETUP.md:10`.

**Option A (recommended): Keep it on the user's PC.** Cheapest, already works. Risk: user reinstalls Windows or PC dies. Acceptable for Phase 1 — the scraper only feeds a catalogue table, not realtime broadcast state.

**Option B: Fly.io Machine with VPN sidecar.** ~$2-5/mo (always-on or schedule-triggered).
- Dockerfile layers: Node 20 → Playwright Chromium deps → OpenVPN client → copy scraper. Machine has a persistent volume for `.futbin_chromium_profile/`.
- Cron trigger: Fly Machine API from a Vercel cron, OR `fly machine start` via GitHub Action at 20:00 WAT.
- VPN: either subscribe to a server-friendly VPN (Mullvad works with OpenVPN), or use Fly's Anycast IP (not UK-geolocated, may not satisfy CF).
- **Risk:** Cloudflare can still flag a VPS-originating Chromium. You may end up needing to rotate the CF profile monthly via the `_scrape_futbin_headful.js` manual warmup, from a real browser on a real home network. At which point Option A is fine.

**Option C: DigitalOcean droplet, $6/mo, systemd timer + OpenVPN.** Similar pros/cons to Fly, less elegant.

**Verdict:** ship on Option A. Document it in a new `docs/ops/futbin-scraper-prod.md` with instructions: "scraper lives on the user's laptop; if it stops running for 7+ days, fall back to manual kaggle CSV import per `docs/ops/fc26-data-refresh.md`."

### 9.4 Backup cron (documentation only — action item)

Per `CLAUDE.md` backup strategy: GitHub Actions cron → `pg_dump` → Backblaze B2 (30 daily + 12 monthly retention). **Not yet built.** Build as part of deployment:

1. GitHub Actions workflow `.github/workflows/backup.yml`, cron `0 1 * * *` (01:00 UTC).
2. Secrets: `SUPABASE_DB_URL` (pooler URL), `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`.
3. Steps: install postgresql-client → `pg_dump -Fc` → `b2 upload-file`.
4. Manifest rotation via B2 lifecycle policy (not the workflow).
5. Quarterly restore drill to staging — document + calendar-schedule.

---

## 10. CI / CD

### 10.1 Current state

`.github/workflows/ci.yml` already exists: runs lint + test + build on every push/PR. Does NOT deploy (Vercel does that via its own GitHub App integration).

### 10.2 Deployment wiring

1. **Vercel Git Integration:** Connect the GitHub repo in Vercel Dashboard → Add New Project → Import `Layott/cade-league-platform`. Vercel installs its GitHub App automatically.
2. **Production branch:** set to `main`.
3. **Preview deployments:** every PR + every non-`main` branch gets a URL.
4. **Protected deploys:** turn on "Only deploy when CI passes" (Vercel → Project → Settings → Git → Deployment Protection) so a failing CI blocks Vercel from deploying.
5. **Production domain lock:** pin `app.cadeesports.com` to the Production deployment only.

### 10.3 Extension to CI (optional — do before launch)

Extend `.github/workflows/ci.yml` to:

- **Upload Playwright report on failure** (artifact). Current config runs on a clean CI box but E2E isn't wired in CI — if you add it, provide `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` as repo secrets AND a dedicated test Supabase project or a `test_` schema so E2E doesn't pollute production.
- **Migration drift check:** add a step that `npx supabase db diff --linked` and fails if local migrations aren't up-to-date with cloud. Prevents merging to `main` without running `npm run db:push`.

### 10.4 Rollback

- **App-level:** Vercel Dashboard → Deployments → click any prior successful deploy → "Promote to Production". ~10 seconds to revert.
- **DB-level:** migrations are forward-only. For a bad migration:
  1. Write a follow-up migration that reverses the damage.
  2. `npm run db:push` — applies the reverse migration.
  3. Promote older Vercel deploy if the app code needs to match.

Never run `supabase db reset` against cloud. **Never.**

---

## 11. Logs, Monitoring, Alerting

### 11.1 Minimum viable stack

| Layer | Tool | Cost |
|---|---|---|
| Function logs | Vercel Runtime Logs (last 4 hours free, 1 day on Pro, longer via log drain) | free–$20/mo |
| Analytics (RUM, web vitals) | Vercel Web Analytics (basic free; Pro $10/mo extras) | free–$10 |
| DB logs | Supabase Logs Explorer (7 days retention on Pro) | included |
| Error tracking (recommended) | Sentry (Hobby tier free: 5k errors/mo, 1 user, 1 project) | free |
| Uptime | Better Uptime (free tier: 10 monitors, 3-min checks) or UptimeRobot | free |

### 11.2 Sentry integration (~1 hour setup)

1. `npm i -w apps/web @sentry/nextjs`
2. `npx @sentry/wizard@latest -i nextjs -s` inside `apps/web/`.
3. Set `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` in Vercel env. Source maps upload on each prod deploy automatically.
4. Wire session replay only on `/admin/*` (privacy — don't record public fans).
5. Alert rules: notify on any unhandled exception in `api/broadcast/**` during a live session (Saturday broadcasts).

### 11.3 Uptime monitors

- `https://app.cadeesports.com/welcome` — 200 + "CADE ELITE" text
- `https://app.cadeesports.com/api/broadcast/sessions/00000000-0000-0000-0000-000000000000/active` — expect 401 (tests view_token gate is enforced)
- `https://app.cadeesports.com/fixtures` — 200

### 11.4 Slack/email alerts (pick one)

- Vercel → Settings → Notifications → Slack webhook → "Deployment failed" + "Cron job failed".
- Supabase → Project Settings → Integrations → webhook on usage threshold (DB > 500 MB or egress > 2 GB/day).

---

## 12. Rollback Plan

### 12.1 App code

- Redeploy prior Vercel build (§10.4). ~10s.
- Verify `/welcome` + `/admin` load + `npm run e2e` locally against the rolled-back URL.

### 12.2 Database

- Each migration is forward-only. Do NOT delete migrations from the `supabase/migrations/` folder — write a new reversing migration instead (`20260514_revert_X.sql`).
- Use Supabase's Point-in-Time Recovery (Pro feature) if a prod migration corrupts data. PITR window is 7 days on Supabase Pro, 28 days on Team plan.

### 12.3 Storage buckets

- Soft-delete is implemented at the app layer via `deleted_at`. There is no blanket bucket rollback — once you upload, it's there until you explicitly remove. Backblaze B2 backup (§9.4) is your rollback path for full DB restore.

### 12.4 Emergency "kill switch"

If you need to take the app offline:

- Vercel Dashboard → Deployments → Pause Deployment → production goes to Vercel maintenance page.
- Or scale down to 0: set `TRAFFIC_ROUTING=0%` in Vercel's Edge Config if you've pre-wired it. (Not currently wired — consider adding.)

---

## 13. Pre-Launch Checklist

Tick each item before flipping DNS:

### A. Code / CI

- [ ] All unit tests pass: `npm run test`.
- [ ] Lint clean: `npm run lint`.
- [ ] Production build clean locally: `npm run build` — fix any `isomorphic-dompurify` / `jsdom` surprises.
- [ ] All E2E green against cloud Supabase: `npm --workspace apps/web run e2e`.
- [ ] `apps/web/next.config.ts` retains `serverExternalPackages: ["isomorphic-dompurify", "jsdom"]`.
- [ ] Amend cron routes to accept `Authorization: Bearer $CRON_SECRET` (for Vercel Cron) OR decide on GitHub Actions cron — see §9.2.
- [ ] Remove any `localhost:3030` / `127.0.0.1:3030` references outside of `playwright.config.ts` and `apps/web/README.md:17`. `grep` confirms those are the only two.

### B. Vercel

- [ ] Repo connected at Vercel → Project created.
- [ ] Root directory = `.`, build command = `npm run build`, install = `npm install`.
- [ ] Node.js version = 20.
- [ ] All env vars from §3 added (Production + Preview).
- [ ] `NEXT_PUBLIC_OVERLAY_DEBUG` set ONLY on Preview, not Production.
- [ ] `.vercelignore` created with `KNOWLEDGE/`, `scripts/`, `supabase/`, `docs/`, `tasks/`, `backups/`, `test-results/`, `playwright-report/`, `.github/`.
- [ ] Cron schedule updated in `vercel.json` per §9.2.
- [ ] Deployment Protection → "Only deploy when CI passes" enabled.

### C. Supabase

- [ ] Auth → Site URL = `https://app.cadeesports.com`.
- [ ] Auth → Redirect URLs includes `https://app.cadeesports.com/**` + `https://*.vercel.app/**`.
- [ ] Realtime enabled (Project Settings → API).
- [ ] All five storage buckets confirmed (§5.3).
- [ ] All migrations applied (check latest via `npx supabase db query --linked ...`).
- [ ] `admin@cade.local` password rotated away from `dev-admin-2026`.
- [ ] Dev-only seed users (`player01..player13@cade.local`) either removed or kept intentionally. Decide.
- [ ] Point-in-Time Recovery enabled (requires Pro tier).

### D. Domain / DNS

- [ ] `cadeesports.com` purchased.
- [ ] DNS: `app CNAME cname.vercel-dns.com.` (TTL 300).
- [ ] SSL cert issued by Vercel, grade A+ on SSL Labs.
- [ ] Resend domain verified: DKIM + SPF + DMARC records live.
- [ ] `RESEND_FROM` set, test email via `/admin/announcements → Send Test` (or an internal test action).

### E. Producer handoff

- [ ] Producers have URLs for every overlay they use + matching Session ID.
- [ ] Each producer has tested at least one overlay in their browser source tool (OBS / vMix / etc.) against the production domain.
- [ ] `view_token` rotation procedure documented.

### F. Observability

- [ ] Sentry wired (optional) OR Vercel Runtime Logs drain enabled.
- [ ] Uptime monitor set (Better Uptime / UptimeRobot).
- [ ] Slack / email alerts for Vercel deploy failures.

### G. Backup

- [ ] GitHub Actions daily `pg_dump` → B2 workflow live.
- [ ] First restore drill completed to a staging Supabase project.

### H. Documentation

- [ ] This doc updated with execution notes.
- [ ] Producer runbook updated with prod URLs.
- [ ] Rotate + document all keys in a password manager.

---

## 14. Execution Plan (Numbered Steps)

Run top-to-bottom. Rough estimates in parens.

1. **(15 min) Purchase domain `cadeesports.com`.** Registrar of choice.
2. **(30 min) Create Resend account + add sending domain.** Get DKIM + SPF values. Don't add DNS yet.
3. **(1 hour) Add cron secret auth compatibility.** Amend `apps/web/src/app/api/cron/*/route.ts` to accept `Authorization: Bearer <CRON_SECRET>` in addition to `X-Cron-Secret`. Add unit tests. Ship via PR.
4. **(30 min) Create `.vercelignore`** at repo root excluding `KNOWLEDGE/`, `scripts/`, `supabase/`, `docs/`, `tasks/`, `backups/`, `test-results/`, `playwright-report/`, `.github/`, `.claude/`. Commit.
5. **(30 min) Update `vercel.json`** with three crons per §9.2. Commit.
6. **(1 hour) Create Vercel project.** Connect repo. Configure build command, Node 20. Do NOT add domain yet.
7. **(1 hour) Populate Vercel env vars** (Production scope). Rotate every secret at creation time. Copy non-secrets from `.env.local`; generate fresh values for `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (rotate), etc.
8. **(15 min) Trigger first Production deploy** (auto-triggered by git push if project is new; else `vercel --prod`). Watch build log.
9. **(30 min) Smoke test on Vercel's `*.vercel.app` URL**: `/welcome`, `/fixtures`, `/standings`, `/admin` (login with rotated admin creds), `/overlay/scorebar?session=<real-session-id>&t=<token>`. Check Realtime works via `/admin/broadcast/<id>` trigger flow.
10. **(15 min) Add `app.cadeesports.com`** to Vercel project Domains.
11. **(5 min) Add DNS record** in registrar. Wait for SSL (2-5 min typically).
12. **(15 min) Update Supabase Auth** with `https://app.cadeesports.com` as Site URL + add to Redirect URLs.
13. **(15 min) Add Resend DNS records**. Wait for verification (sometimes minutes, sometimes an hour).
14. **(1 hour) Producer walk-through.** Pick one overlay (say scorebar), one producer, have them point OBS browser source at the prod URL, verify triggers land.
15. **(30 min) Wire uptime monitor + Sentry + Slack alerts.**
16. **(1 hour) Build + test `backup.yml` GitHub Action.** Store dumps in B2, verify first two dumps land.
17. **(15 min) Flip Vercel's Deployment Protection** to "Only deploy when CI passes".
18. **(15 min) Update producer + staff runbooks** with the production URL.
19. **(30 min) Schedule a restore drill** for ~2 weeks post-launch to test backups end-to-end.

Total: ~9 hours of active work, plus DNS + Resend propagation idle time.

---

## 15. Cost Estimate (Monthly, USD)

| Item | Tier | Cost/mo | Notes |
|---|---|---|---|
| Vercel Pro | Pro | $20 | Required for 300s `fcdb-refresh` maxDuration + 3 cron jobs. |
| Supabase | Pro | $25 | Required for PITR + 100 GB egress; current is likely Free tier but prod needs Pro. |
| Resend | Free | $0 | 100 emails/day free; Pro $20/mo for 50k emails. Start free. |
| Sentry | Hobby | $0 | 5k errors/mo, 1 user. |
| Better Uptime | Free | $0 | 10 monitors. |
| Cloudflare/DNS | Free | $0 | Domain cost below. |
| Domain `cadeesports.com` | Yearly | ~$1/mo ($12/yr at Porkbun) | |
| Backblaze B2 (backups) | Pay-as-you-go | ~$1/mo | 30 × 500 MB dumps + 12 monthly = ~18 GB × $0.005 = $0.09/mo storage; bandwidth cheap. |
| YouTube Data API | Free | $0 | 10,000 units/day — may need quota increase. |
| Anthropic (OCR, when enabled) | PAYG | ~$5-20/mo | Gated by `OCR_DAILY_CAP_USD_CENTS` ($1/day by default = max $30/mo). |
| Optional: Fly.io Futbin worker | Shared-1x | ~$3-5/mo | Only if moving scraper off user's PC. |
| **Baseline total** | | **~$47/mo** | Vercel Pro + Supabase Pro + domain + backup. |
| **With OCR + worker** | | **~$75/mo** | |

---

## 16. Known Risks & Unknowns

### 16.1 Vercel Cron signature mismatch

All three cron routes currently require `X-Cron-Secret` header. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. **Without a code change, all crons fail 403 on Vercel.** This is the #1 blocker.

### 16.2 Futbin scraper = operator-on-call forever

The CF-warmed Chromium profile is fragile. If CF rotates trust, the scraper silently returns 0 rows and the admin sees stale catalogue data. Supabase alert on `fc26_refresh_log` rows with `source='none'` for >48h is recommended.

### 16.3 Git-LFS bandwidth

Vercel builds pull LFS pointers. Free GitHub LFS bandwidth is 1 GB/mo. If the repo triggers many redeploys (PR previews), you can hit the cap and future builds fail to download RAW files. **Mitigation:** ensure `.vercelignore` excludes LFS-tracked dirs, or pay for a GitHub LFS data pack ($5/mo).

### 16.4 Overlay session token leak

Producers may copy-paste overlay URLs including `?t=<viewToken>` into Slack / email. A leaked token gives anyone read access to the session's broadcast state (not PII — just scorebar / ticker payloads — but still a polish issue). Rotating the token via `/admin/broadcast/<id>` is implemented; remind producers to rotate at session start.

### 16.5 Supabase free-tier pause

If the project is still on Free tier, Supabase pauses inactive projects after a week of no traffic. **Upgrade to Pro before launch** to prevent accidental pause.

### 16.6 YouTube API quota

A 2-hour broadcast with one admin panel polling can consume ~12,000 of 10,000 daily units (per `docs/ops/youtube-api-key.md:55`). Multiple broadcasts in a day could burn the quota. Request a quota increase BEFORE the first broadcast under production load.

### 16.7 Timezone correctness in Vercel

Vercel serverless containers run UTC. All app code uses `date-fns-tz` `formatInTimeZone` with hardcoded `Africa/Lagos`, so this is fine. But any raw `new Date()` without TZ conversion could drift. Smoke-test Thursday squad deadline behavior by triggering a past-deadline week and confirming auto-warnings fire.

### 16.8 E2E tests not in CI

Current CI skips E2E. If you enable E2E in CI, you need either a test Supabase project or careful test isolation. A full E2E run against prod would pollute data.

### 16.9 Anonymous sign-in not enabled

`supabase/config.toml:171` has `enable_anonymous_sign_ins = false`. This is correct for prod. Some app code paths may still assume an anon user can read; confirm `PUBLIC_PERMS` (per CLAUDE.md roles section) serves unauthenticated traffic without hitting Auth.

### 16.10 Overlay URL memorability

Producers will fat-finger session IDs. `/admin/broadcast/<id>` should (confirm) show a "Copy URL" button per template with the token baked in — if this is already present per CLAUDE.md §11 verify-before-show rule, good; if not, add before launch.

---

## 17. Top-3 Most Important Risks

Copied for the executive summary:

1. **Vercel Cron auth mismatch** — all three cron endpoints reject Vercel's native `Authorization: Bearer` header. Must ship a code change before the first cron fires. Blocks Plan 10 squad-deadline auto-warnings + Plan 6 announcements + Plan 24 FC DB refresh.
2. **Futbin scraper has no serverless-friendly deployment path.** Persistent Chromium + CF cookies + UK VPN = user's PC stays the operator. Acceptable for Phase 1 but creates single-point-of-failure.
3. **Git-LFS bandwidth + 2.4 GB `KNOWLEDGE/` folder** will bloat Vercel build context + LFS quota. A single missing `.vercelignore` here doubles or triples function cold-start times and can exhaust the free LFS bandwidth, at which point builds fail.

---

## 18. Out-of-Scope for This Plan

- Actual deploy execution — this is planning only.
- Changing any code — not even the `Authorization: Bearer` fix. That belongs in its own Plan spec before launch.
- Marketing / public launch comms.
- Stripe / payment integration (explicitly dropped per `CLAUDE.md` scope discipline).
- Mobile app (explicitly dropped).
- Multi-region / multi-tenant (Phase 3+).
