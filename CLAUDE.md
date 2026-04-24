# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository State (updated 2026-04-23)

**Stage:** Phase 1A SHIPPED + Phase 1B SHIPPED + Phase 2 prep SHIPPED. 14+ plans landed on `main`. Next.js 15 + Supabase monolith live, 432+ unit tests, 30+ E2E specs, 30+ migrations applied to cloud.

**FCDB (`fc26_players`) state as of 2026-04-23:** 24,522 total rows. 20,372 rows on `source_dataset='futbin.com'` are 100% priced (99.7% PS / 95.9% PC), 100% card images, 100% 6-main-stats + weak foot + skill moves + variant, 89.7% Futbin meta rating. Dormant: 2,745 Kaggle rows + 1,405 fut.gg rows (no Futbin enrichment — kept for provenance, not deleted). Item_type distribution (futbin.com only): normal 18,729 · special 969 · icon 306 · hero 216 · tots 66 · rttf 47 · toty 40. Fcdb lookups should filter `source_dataset='futbin.com' AND deleted_at IS NULL` for real data. See Futbin cleanup review in `tasks/todo.md` (commits `518be6b` item_type regex fix + `983cb2a` audit scope fix).

Stack: **Next.js 15 (App Router) + Supabase (Postgres/Auth/Storage/Realtime) + Vercel + Resend + Anthropic SDK (@anthropic-ai/sdk) + framer-motion + rembg/OpenCV Python pipeline for asset processing**.

**Commands live in `apps/web`:**
- `npm run test` — vitest.
- `npm run lint` — eslint.
- `npm run build` — next build.
- `npm --workspace apps/web run e2e` — playwright.
- `npm run db:push` — supabase migrations → cloud.
- `npm run audit:smoke` — SQL audit trigger smoke test.
- `npm run void:smoke` — SQL void-propagation smoke test (Plan 11).

## Primary Documents

Read these before proposing changes:

- `ESOCCER LEAGUE/PRODUCT_STRUCTURE.md` v0.3 — product vision, phase plan, data model, role matrix, §2.5 Decisions Log.
- `docs/superpowers/specs/` — per-plan specs:
  - `2026-04-20-phase-1a-design.md` — Phase 1A foundation (shipped).
  - `2026-04-21-plan-9-roles-and-db-perms.md` — 12-role matrix + DB-backed perms (shipped).
  - `2026-04-21-plan-10-squad-submissions.md` — Thursday deadline + Friday change window (shipped).
  - `2026-04-21-plan-11-void-propagation-and-warnings.md` — Rule 5.4 ladder + Rule 3.4.4.2 voids (shipped; ladder values in §2).
  - `2026-04-21-plan-12-vmix-overlay-bridge.md` — generic browser-source overlay bridge, works in OBS+vMix+Streamlabs+Ecamm+XSplit+Restream (shipped).
  - `2026-04-21-plan-13-orgs-disputes-content.md` — parent Plan 13 (server modules shipped as 13A).
  - `2026-04-21-plan-13b-orgs-disputes-ui.md` — admin + player UI (in flight).
  - `2026-04-21-plan-14-stats-screenshot-ocr.md` — Claude vision OCR for match stats screenshots (shipped with OCR_DISABLED=1 default).
  - `2026-04-21-plan-16-broadcast-visual-polish.md` — motion design + review harness (awaiting brand assets + execution). **Note: overlay count expanded from 7 → 27 per user brief; spec needs re-amendment before execution.**
- `../CLAUDE.md` (parent) — plan-first workflow, subagent strategy, `tasks/todo.md` + `tasks/lessons.md` cadence.
- `KNOWLEDGE/` — rulebooks + extracted markdown + brand assets.
  - `extracted/CADE_Elite_League_Rulebook_v1_7.md` — primary rulebook.
  - `extracted/PLAN11-LADDER-GAPS.md` — authoritative Rule 5.4 + Rule 3.4.4.2 text.
  - `brand-assets/` — logos, fonts, videos, processed player images.
- `tasks/todo.md` — live task board per plan.
- `tasks/lessons.md` — session learnings; read before executing.

## Scope Discipline

**Dropped entirely (do NOT build at any phase):** GPS geofence, QR check-in, prize disbursement automation, under-18 parental consent, auto promotion/relegation, mobile app, anonymous whistleblower flow, **Paystack + any payment gateway** (dropped 2026-04-21 — manual ledger only, caution-fee balances tracked by admin hand-entry), **content obligations** (dropped 2026-04-22 — no platform-side collection of social-media post links; tables soft-archived per migration `20260507000020`), **preseason shoots** (dropped 2026-04-22 — no platform-side scheduling/attendance for pre-season photo/video sessions; tables soft-archived; `incident_type='preseason_miss'` enum value retained for historical disciplinary rows only).

**Deferred (not yet built):** multi-season abstraction, social/weekly auto-generated graphics, IG/TikTok API auto-verification, MFA + advanced device fingerprinting, full holiday-aware business-day math.

**Dormant datasets (kept, not mutated):** `fc26_players` rows with `source_dataset IN ('kaggle','fut.gg')` — 2,745 Kaggle + 1,405 fut.gg rows carry no Futbin pricing/images/stats. Left in place for provenance; all fcdb runtime lookups MUST filter `source_dataset='futbin.com' AND deleted_at IS NULL`.

**Removed 2026-04-23 (was Plan 24):** automated nightly `fcdb-refresh` Vercel cron + `@/server/fcdb/refresh.ts` orchestrator + `@/server/fcdb/sources/{kaggle,futdb,sofifa}.ts` wrappers. The Futbin scrape scripts under `KNOWLEDGE/extracted/_scrape_futbin_*.js` are run locally on the admin's PC on a manual cadence — no server-side catalog refresh. Orphan table `fcdb_refresh_log` (migration `20260510000001`) left in place; no code reads it.

**Now shipped (was "deferred" in Phase 1A):** vMix/OBS/Streamlabs overlay bridge (Plan 12), 12-role matrix + DB perms (Plan 9), squad submission + Friday change window (Plan 10), void-match propagation (Plan 11), orgs + disputes + appeals server modules (Plan 13A — content + preseason subsystems dropped 2026-04-22 per Plan 33), **Futbin scraper + FCDB enrichment** (Phase 3 attempt: 20,372 rows live as of 2026-04-23; shared classifier at `KNOWLEDGE/extracted/_classify_variant.js`).

When in doubt, check `PRODUCT_STRUCTURE.md` §2.5 + `tasks/todo.md` review sections.

## Architectural Non-Negotiables

Locked across all phases — do not deviate without user approval:

1. **Monolith.** Single Next.js repo. Route groups `(public)`, admin at `/admin/*` (flat naming), `(auth)`, `(player)`, `(overlay)`.
2. **DB-backed permissions** (post-Plan 9). `role_permissions` table seeded from `src/perms.ts`. Runtime reads via `hasPermAsync` / `requirePermAsync` in `apps/web/src/lib/perms-db.ts` with 30s process-local cache. `src/perms.ts` is now the SEED doc, not runtime source.
3. **Audit via Postgres trigger.** Generic `audit_row_change()` + `public.attach_audit('<table>')` on every mutable table. Reads `current_setting('app.current_user_id')` set by API middleware. No hand-coded audit calls.
4. **RLS on PII + financial tables only.** Covered tables: `users`, `players` (bank/ID columns), `organization_contracts`, `caution_ledger_entries`, `disputes`, `appeals`. (`content_posts` previously listed; soft-archived 2026-04-22 per Plan 33 — RLS policies remain attached to the dormant table.) Business permissions enforced in API layer via `hasPermAsync()`.
5. **Append-only tables.** `audit_events` + `caution_ledger_entries` + `ocr_usage_log` block UPDATE + DELETE via dedicated triggers. Never mutate after insert.
6. **Idempotent recompute.** Any change to `match_results` or `disciplinary_actions` triggers a full recompute of affected season's standings from scratch. Void rows (`result_type='void'`) excluded. Never patch incrementally.
7. **Soft delete + Restore.** Every mutable table has `deleted_at`. Reads filter `WHERE deleted_at IS NULL`. Admin `/trash` UI restores. No hard-delete UI.
8. **Timezone `Africa/Lagos` (WAT).** All date/time arithmetic via `date-fns-tz` `formatInTimeZone` / `apps/web/src/lib/time.ts` / `lib/businessDays.ts`. No DST.
9. **Hard-coded Elite 2025-2026 season.** No multi-season/multi-division abstraction. 13 players, round-robin once = 78 matches.
10. **Server Actions in `.ts` files carrying `"use server"` export ONLY async functions.** Sync schemas/types/parsers live in sibling `schemas.ts`. Next.js rejects sync exports under `"use server"`.
11. **Verify-before-show is mandatory.** Never surface a UI surface to the user (overlays, admin pages, review harnesses) without first driving it end-to-end myself — trigger every button, visit every route, confirm no runtime errors in the server log or browser console, check that entry + exit animations render. Either via `npx next dev -p 3030` + Playwright smoke OR Claude-in-Chrome browser automation. If I cannot test a surface, say so explicitly and do NOT claim it is ready for review. This rule is load-bearing — user corrected me on this 2026-04-21 after Plan 16 harness shipped with crashing triggers + missing animations + decentered stingers.
12. **Post-push platform-wide verification is mandatory.** After EVERY push to `origin/main`, run a comprehensive route-by-route verification pass: curl every public route, every admin route (expecting 200 or 307), every overlay route, scan dev-server log for runtime errors, confirm `npm run test` + `npm run lint` clean, sample DB state via `supabase db query` for critical tables (match_days count, fixtures count, players count). Report findings as an explicit route-by-route table. Do NOT lump "all good" — one row per route. User added this rule 2026-04-22 after multiple post-push regressions slipped past surface-only checks.
13. **Background agents must be tracked periodically.** When agents are running in the background (any `Agent` call with `run_in_background: true`), surface a status check to the user every 3-5 minutes per active agent: which agentId, how long running, last apparent activity (size of its output file changing), and whether it's likely stalled. If an agent has been silent for >10 min without producing a task notification, send the agent a `SendMessage` ping asking for a one-line status. If still silent for another 10 min, kill the run + relaunch with a tightened brief. Do NOT assume "agent is still running" indefinitely — a stalled agent burns context budget without producing work. User added this rule 2026-04-22 after a Plan 37 spec drafter agent silently rate-limited and the user noticed it wasn't progressing before I did.

## Roles (post-Plan 9)

12 values in `user_roles.role`: `admin`, `loc`, `idc`, `referee`, `technical`, `production`, `design`, `moderator`, `coach`, `team_manager`, `player`, `viewer`. Unauthenticated public inherits `viewer`-level perms via `PUBLIC_PERMS` const (served in-process, no DB hit).

## Brand (post-2026-04-21)

Primary palette (locked, supersedes Phase 1A `#00ff88` signal-green):
- **Primary green** `#6bcd06`
- **Secondary pink** `#fe036d`
- Black + white supporting only

Fonts (loaded via `next/font/local` in Plan 16):
- **Agharti** — primary display (sporty condensed family)
- **Quedora** — secondary (futuristic boxy)
- JetBrains Mono + Inter retained for web numerics + body

Logos at `KNOWLEDGE/brand-assets/logos/` (primary: CADE esports + GameEvo + Pro League; partners: ESPORTS AFRICA NEWS, Gamepride, eSports Federation of Nigeria).

**Overlay scope (Plan 16 executes against this list, not the original 7-template draft):** 27 total — 5 stingers (intro-long, normal, replay, goal, winner) + 7 persistent layouts (4-PIP, 2-PIP, BRB+ad, BRB-basic, timer-badge, animated-bg, casters-chat) + 3 matchup cards (h2h-2, h2h-3, h2h-5) + 5 data displays (leaderboard-anim, lower-third, score-bug, up-next-bug, match-scores-day) + 3 full-screen (starting-soon-basic, starting-soon-with-ad, stream-ended) + 4 stats (top-scorers / Golden Pad, orgs-roster, coach-intros, player-penalties). All 1920×1080 @ 60fps, sound-enabled, team-logo + player-headshot slots where applicable.

Player image pipeline at `KNOWLEDGE/brand-assets/players/_process.py` — decodes ARW/CR3/PNG, face-detects, produces 6 variants per pose (headshot_NN + card_NN + fullbody_NN, each with `_nobg` transparent counterpart). Re-run with `py _process.py` when new photos drop. Manifest at `processed/manifest.json`.

## Workflow

The parent `CLAUDE.md` at `C:\Users\Sweez\Desktop\LAYO\CLAUDE\CLAUDE.md` is **load-bearing and non-negotiable**. Read it at session start.

Non-trivial work uses this cadence (from parent):

1. **Plan first.** Write plan to `tasks/todo.md` with checkable items. Validate scope with the user before coding.
2. **Track progress.** Mark items complete as you go; summarize each step at a high level.
3. **Document results.** Add a review section to `tasks/todo.md` when done.
4. **Capture lessons.** Append to `tasks/lessons.md` after any user correction.
5. **Verify before claiming done.** Run tests, demonstrate the success-criteria scenarios in §1 of the Phase 1A spec.

For implementation plans derived from an approved spec, invoke the `superpowers:writing-plans` skill. For new features outside the current spec, invoke `superpowers:brainstorming` first.

## Verification discipline (mandatory before claiming a plan complete)

Parent CLAUDE.md §4 says "Never mark a task complete without proving it works." In practice that means before saying "Plan N is done":

1. `npm run test` — all unit tests pass.
2. `npm run lint` — clean.
3. `npm run build` — clean production build.
4. `npm --workspace apps/web run e2e` — every E2E spec passes.
5. At least one success-criteria scenario from the plan's own "Acceptance Criteria" section demonstrated end-to-end (manual or scripted).

If verification fails, the plan is NOT complete. Fix or raise it with the user. Do not publish a "complete" status with caveats.

**When parallel agents are churning files:** their in-flight commits may break local builds. Don't declare a plan complete during the churn. Checkpoint (commit my own work), pause verification, wait for agents to finish, then do a single clean verification pass before claiming the wave complete.

## Testing strategy

- **Unit tests (Vitest)** live next to the code they test: `foo.ts` + `foo.test.ts` in the same folder. Mock the Supabase client when a function takes one as a parameter — never hit the real DB from unit tests.
- **E2E (Playwright)** lives in `apps/web/tests/e2e/`. E2E hits the real cloud DB via the dev server. Tests must be self-cleaning (or self-tolerating — they rely on existing seed users, create named-throwaway rows, etc).
- **Migrations** are verified with `npx supabase db query` against the linked project after `db:push`. Verify the schema matches expectations (column list, check constraints, trigger attachment).
- **Audit trigger** has a dedicated smoke test at `supabase/tests/audit_smoke.sql`, runnable via `npm run audit:smoke`.
- **Do NOT skip unit tests** for server modules just because E2E covers the flow. Unit tests catch regressions 10× faster than E2E.

## Error log rule (user-mandated 2026-04-24)

Every error + fix lands in `tasks/lessons.md` **as it happens**, not retrospectively. Format:
- `**Date:** YYYY-MM-DD`
- `**Context:**` what the user reported + what the system was doing
- `**Mistake:**` the specific wrong assumption / missing check / bad abstraction
- `**Correction:**` the fix applied (with commit ref if pushed)
- `**Rule for future:**` the durable guard — selector, test, check, pre-flight — that would have caught this before it shipped

If the same error recurs with a different symptom, **UPDATE** the existing entry's "Correction" + append the new symptom to "Context" — don't create a duplicate. Cross-reference commit SHAs so the before/after is always reproducible.

Before starting ANY new work, grep `tasks/lessons.md` for keywords matching the problem space. A lesson that applies is not optional — it's a pre-flight check.

## Seed Data

`supabase/seed.sql` exists. Contains Elite 2025-2026 season + placeholder 13-player roster (`player01@cade.local..player13@cade.local`) + one `squad_validation_rules` row (10M coin budget, min 1 Nigerian item, banned EVO/SeasonPass/Objective). Real roster names are pending swap — 13 players with photos live at `KNOWLEDGE/brand-assets/players/`: ADEFOLA, ANIFE, BAJI JNR, DADABOI, FARUK, GURU, KAYKAY, KILLER FREAK, KINGNONEX, MITCH, MR OGA, TACTICAL, WOLEVATION.

Seed guarded by `NODE_ENV` checks. Also Plan 13A seeds via `npm run seed:plan13` (orgs + contracts + caution deposit demo).

## Parallel agent etiquette

When multiple agents land on `main` concurrently:

- **Migration numbers:** monotonic timestamp-prefixed. Claim blocks per plan (Plan 9 = `20260428000001..000003`, Plan 10 = `20260428000101..`, Plan 11 = `20260502000001..`, Plan 12 = `20260503000001..`, Plan 13A = `20260428000201..`, Plan 14 = `20260504000001..`, Plan 13B = `20260505000002..`).
- **Shared files** (`src/perms.ts`, `tasks/todo.md`, `middleware.ts`, `AdminSubnav.tsx`, admin subnav): one agent at a time edits; others rebase + merge.
- **Cloud DB push:** agents that write migrations may `npm run db:push`. Supabase CLI handles already-applied migrations idempotently.
- **Push to remote:** only after verification gate green on the agent's own slice.
- **FK disambiguation lesson:** after Plan 13A added `players.coach_id` + `players.team_manager_id` FKs to `users`, every Supabase embed `users:user_id(...)` had to become `users:users!players_user_id_fkey(...)`. Unit tests don't catch this (mocked Supabase). Future schema changes adding ambiguous FKs should ship with a single-slice FK-rename migration across all call sites.

## Backup Strategy

- Local dev: daily `supabase db dump` into gitignored `backups/` (rotate 14 days).
- Production: GitHub Actions cron → `pg_dump` → Backblaze B2 (30 daily + 12 monthly retention).
- Quarterly restore drill to staging.
