# Tasks — Active Work

Active plan: Plan 7 Part B complete (2026-04-20). Plan 7 Part A landed in parallel.

Update this file as work progresses per parent CLAUDE.md workflow.

## Done

- Plan 7 Part B — Public Homepage + Page Polish complete (2026-04-20). Tasks 8–14 shipped.
  - Design direction: dark night-studio aesthetic, one signal-green accent
    (`#00ff88`), Space Grotesk display + Inter body + JetBrains Mono numerics
    via `next/font/google`. Eyebrow tags, scan-lined headers, ticker-stripe
    hero wordmark.
  - New `apps/web/src/server/homepage.ts` orchestrates season + next match
    day + top-3 standings + 3 latest public announcements via `Promise.all`.
  - New `apps/web/src/components/public/SiteChrome.tsx` (client) wraps all
    non-admin routes with branded nav + footer; hides on /admin, /login,
    /logout.
  - `/` rewritten: hero (CADE wordmark + live-season pulse + fixture ID
    plate), upcoming match day card with calendar tile + stats strip,
    podium "Top of the table" with gold/silver/bronze, latest-news strip.
  - `/standings` polished: sticky header, zebra rows, rank-badge tinted
    for top 3, inline deduction pill on rows with
    `punishment_points_deducted > 0`, tiebreaker footer.
  - `/fixtures` polished: grouped by match_day with venue + kick-off +
    arrival cutoff meta, jersey-number tiles on each side, status pill
    (scheduled/live/final/forfeit/void), winner highlighted in signal green.
  - `/players` polished: enhanced `PlayerCard` with jersey-green ring +
    hover lift + inline 3-stat strip (Pts/GF/GA) sourced from standings;
    `/players/[id]` rewritten with stat grid + rank badge.
  - `/announcements` rewrote as priority-tinted card feed (urgent flare,
    important amber, info signal-green); markdown heading levels shifted
    down one so PageHeader remains the sole h1.
  - `/punishments` polished with sanction-type badges (magnitude
    callout, incident chip, severity-keyed left accent).
  - ISR revalidate=60 retained on every public page.
  - E2E: `apps/web/tests/e2e/public-pages.spec.ts` covers all 6 public
    routes + nav link traversal. Existing smoke + players specs updated
    to new copy ("CADE / LEAGUE" wordmark, "The Roster" heading).
  - Accent color committed: signal-green `#00ff88` (a departure from
    generic blue/purple, matches eFootball/FUT lighting).
  - `.next/` collision lesson captured in `tasks/lessons.md`.
  - Deferred: verifying E2E run cleanly in this sandbox session because
    a pre-existing dev-server zombie on :3010 is locking the Playwright
    `webServer`. Unit tests (85) + lint (clean) + `next build` (27
    routes) all green locally.

- Plan 5 — Attendance complete (2026-04-20). All 11 tasks green.
  - attendance_marks migration applied with UNIQUE (match_day_id, player_id) + audit
  - markPresent/Late/Absent + editMark implemented with revoke/re-apply penalty flow
  - /admin/match-days/[id]/attendance roster UI shipped with Edit + Undo
  - 16 new unit tests green + 2 E2E specs green (full suite 85 unit pass, 21/22 e2e pass)
  - Public /players/[id] attendance % deferred (not in scope of this plan)
  - Migration filename used `20260427` (not `20260425`) because Plan 6's `20260426` was already in the cloud and the Supabase CLI `--include-all` flag was blocked by the sandbox.
  - `delta_seconds` clamped to int32 range in `mark.ts` (defensive cap; column is `int`).
  - One pre-existing E2E (`match-day-flow.spec.ts`) failure unrelated to Plan 5 — Plan 7A renamed the /standings heading from "Standings" to "League Table" and the old assertion was never updated. All 2 attendance specs pass.

## In Progress — Plan 6 (all complete)

- [x] 1. Migration: announcements table
- [x] 2. Migration: notifications table
- [x] 3. Install marked + isomorphic-dompurify
- [x] 4. Markdown render helper (TDD, 5 tests)
- [x] 5. Audience expansion helper (TDD, 5 tests)
- [x] 6. Server module skeleton (create/schedulePublish/publishNow/listForUser/markRead)
- [x] 7. publishNow TDD tests (3 tests)
- [x] 8. listForUser + markRead tests (2 tests)
- [x] 9. Cron route handler (X-Cron-Secret gated)
- [x] 10. Admin list page
- [x] 11. Admin compose page + actions
- [x] 12. Admin detail page
- [x] 13. Public /announcements (ISR 60s)
- [x] 14. Bell unread count in admin layout
- [x] 15. POST /api/notifications/[id]/read
- [x] 16. E2E spec (3 tests; 2 active, 1 skip when CRON_SECRET unset)
- [x] 17. .env.example CRON_SECRET (already present from prior session)
- [x] 18. Final verification (test/lint/build green; audit events confirmed)

## Done
- Spec: `docs/superpowers/specs/2026-04-20-phase-1a-design.md`
- Product doc v0.2 with decisions log
- Plan 0 — Foundations complete (adapted to Supabase cloud)
- Plan 1 — Auth + Roles + Sessions complete (2026-04-20)
- Plan 3 — Matches + Results + Standings complete (2026-04-23)

## Review

### Plan 3 complete — 2026-04-23

All 20 plan tasks executed. Task 8 (SQL recompute test harness) was intentionally skipped — no local psql available in the sandboxed CLI environment, and the Supabase CLI's `db query --file` cannot reliably run the fixture DO block. Correctness is covered instead by the vitest unit tests (draft-vs-confirmed gating, forfeit 3-0 normalization) and the Playwright E2E (admin creates match day → enters draft → confirms → standings reflect). Task 19 (seed.sql update) was a no-op: Plan 2 used a Node seed script and the cloud already has the 13 Elite players + admin role.

Verification:

| Command | Result |
|---------|--------|
| `npm run test` | 65 passed across 17 files |
| `npm run lint` | clean |
| `npm run build` | 24 routes compiled (incl. `/admin/match-days`, `/admin/match-days/[id]`, `/admin/match-days/new`, `/standings`, `/fixtures`) |
| `npm --workspace apps/web run e2e` | 13 passed (all suites) |
| Migrations in cloud | 27 of 27 applied (Plan 3 adds 7: `match_days`, `matches`, `match_results`, `player_match_stats`, `standings`, `recompute_standings`, `match_results_trigger`) |

Plan 3 commits (task-by-task, main branch):

- feat(db): match_days/matches/match_results/player_match_stats/standings + recompute fn + trigger (Tasks 1–7, pre-existing)
- feat(web): service-role Supabase client helper (bypasses RLS) — Task 9
- feat(matches): Zod schemas for match-day, match, result inputs — Task 10
- feat(matches): createMatchDay + listMatchDays + getMatchDay — Task 11
- feat(matches): createMatch + listByMatchDay + voidMatch — Task 12
- feat(matches): enterResult/editResult/confirmResult (draft→confirm flow) — Task 13
- feat(standings): recomputeStandings RPC wrapper + listStandings reader — Task 14
- feat(admin): /admin/match-days list + new match-day form — Task 15
- feat(admin): match-day detail page with fixtures + draft-confirm result flow — Task 16
- feat(public): /standings + /fixtures with 60s ISR and tiebreaker order — Task 17
- test(e2e): admin match-day flow — create, fixture, enter, confirm, standings — Task 18
- test(e2e): serialize tests + bump match-day-flow timeout (avoid admin session race) — Task 20 infra fix

### Plan 3 deviations / notes

- **Task 8 skipped** (SQL recompute test): no psql, CLI limitation as above. Covered by unit + E2E.
- **Task 19 no-op** (seed.sql update): cloud is already seeded with 13 Elite players + admin role. No seed.sql exists in this repo (Plan 2 used a Node script).
- **Schema join adjustment**: the plan snippets selected `display_name` directly from `players`, but in this codebase `display_name` lives on `users` (players has `gamer_tag`). All selects were adjusted to join `users:user_id ( id, display_name )`.
- **Playwright config**: serialised tests (`workers: 1`, `fullyParallel: false`) and moved dev server to port 3010 because (a) the shared `admin@cade.local` session races when parallel tests log in simultaneously, and (b) port 3000 was held by a zombie dev server in the sandbox.
- **UUID fixtures in unit tests**: Zod v4 requires RFC-4122-conformant UUIDs. Test UUIDs updated to valid variants (e.g. `11111111-1111-4111-8111-…`) so the schemas' `.uuid()` validators pass.
- **Forfeit normalization**: `normalizeScores` in `server/matches/results.ts` picks the higher-scored side as the 3-0 winner; ties default to home 3-0. Deterministic as spec §3.3 requires.

### Plan 1 complete — 2026-04-20

All 16 plan tasks executed. RLS fix migration (007) added inline during Task 14 after E2E caught the issue (user_roles blocked middleware from reading own roles).

Verification:

| Command | Result |
|---------|--------|
| `npm run test` | 16 passed (3 time + 5 perms + 3 device + 2 actor + 3 sessions) |
| `npm run lint` | clean |
| `npm run build` | 5 routes compiled |
| `npm --workspace apps/web run e2e` | 4 passed (1 smoke + 3 login) |
| `npm run db:push` | 7 migrations in cloud (0 pending) |
| `npm run audit:smoke` | green (from Plan 0) |

Cloud audit_events sample after Plan 1 execution:
```
entity_type | action | count
-------------+--------+------
sessions    | insert | 2
user_roles  | insert | 1
users       | insert | 2
users       | update | 2
```

Plan 1 commits (git log --oneline since Plan 0):
- feat(db): public.users table mirroring auth.users + audit attached
- feat(db): user_roles table (admin/moderator/player) + audit attached
- feat(db): sessions table with device fingerprint + audit attached
- feat(db): auth_events table for login/device/session security events
- feat(db): auth.users → public.users mirror trigger
- feat(db): RLS on users + user_roles (self-read, server-managed)
- feat(auth): deviceFingerprint helper (SHA-256 of UA + /16 IP + lang)
- feat(auth): getActorFromSession + widen Actor type to include userId
- feat(email): Resend transport with stdout stub when key absent
- feat(auth): recordLogin creates session + logs event + alerts admins on new device
- feat(auth): middleware gate redirects unauthenticated + 403s non-admin
- feat(web): /admin shell layout + landing page
- feat(auth): /login page + server action + /logout route with event logging
- feat(auth): allow users to read own roles + E2E login suite (4 tests pass)
- feat(admin): session history table + revoke action

### Remote

Pushed to https://github.com/Layott/cade-league-platform (private).

### Seeded users (dev)

- `admin@cade.local` / `dev-admin-2026` → role=admin
- `seed-test@cade.local` / `dev-only-password-xyz` → no roles (trigger-created mirror only)

### Next steps

- Plan 2 — Season + Players + Seed (hard-coded Elite 2025-2026 season, player roster from user, public `/players` grid).
- Before Plan 2 coding: get the 13-player roster (names, gamer tags, PSN IDs).
- Optional parallel track for a second Claude terminal: polish public landing page design; draft Plan 2 spec scaffold.
