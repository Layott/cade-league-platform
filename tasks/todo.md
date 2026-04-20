# Tasks — Active Work

Active plan: Plan 6 — Announcements + Notifications (in progress)

Update this file as work progresses per parent CLAUDE.md workflow.

## In Progress — Plan 6

- [ ] 1. Migration: announcements table
- [ ] 2. Migration: notifications table
- [ ] 3. Install marked + isomorphic-dompurify
- [ ] 4. Markdown render helper (TDD)
- [ ] 5. Audience expansion helper (TDD)
- [ ] 6. Server module skeleton (create/schedulePublish/publishNow/listForUser/markRead)
- [ ] 7. publishNow TDD tests
- [ ] 8. listForUser + markRead tests
- [ ] 9. Cron route handler (X-Cron-Secret gated)
- [ ] 10. Admin list page
- [ ] 11. Admin compose page + actions
- [ ] 12. Admin detail page
- [ ] 13. Public /announcements (ISR 60s)
- [ ] 14. Bell unread count in admin layout
- [ ] 15. POST /api/notifications/[id]/read
- [ ] 16. E2E spec
- [ ] 17. .env.example CRON_SECRET
- [ ] 18. Final verification

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
