# Tasks — Active Work

Active plan: `docs/superpowers/plans/2026-04-20-plan-0-foundations.md`

Update this file as work progresses per parent CLAUDE.md workflow.

## In Progress
(none)

## Done
- Spec: `docs/superpowers/specs/2026-04-20-phase-1a-design.md`
- Product doc updated to v0.2 with decisions log
- Plan 0 — Foundations complete (adapted to Supabase cloud; local Docker path deferred)

## Review

### Plan 0 complete — 2026-04-20

All 15 plan tasks executed. Docker path replaced by Supabase cloud link:
- Project: `vqzhczyugpaooegmolgk` (free tier)
- Link via `supabase link --project-ref <ref>` + Personal Access Token
- Migrations applied via `supabase db push`
- Smoke test runs via `supabase db query --file supabase/tests/audit_smoke.sql --linked`

Verification:

| Command | Result |
|---------|--------|
| `npm run test` | 8 passed (time: 3, perms: 5) |
| `npm run lint` | clean |
| `npm run build` | production build ok |
| `npm --workspace apps/web run e2e` | 1 Playwright test passed |
| `npm run db:push` | 4 migrations applied to cloud |
| `npm run audit:smoke` | audit trigger captured insert/update/delete correctly |

Cloud audit_events row count after smoke: 3 rows, tagged with `request_id = req-smoke-*`.

Commits (git log --oneline):
- chore: initial repo scaffold
- chore: add root workspace package.json
- chore: scaffold Next.js 15 app at apps/web with deps
- feat(web): supabase server + browser clients + test scripts
- feat(web): WAT timezone helpers + vitest setup
- feat(web): Phase 1A hard-coded permission map + hasPerm helper
- test(web): landing page + Playwright smoke E2E
- chore(web): Prettier config
- docs: seed tasks/todo.md and tasks/lessons.md
- ci: add lint/test/build workflow
- docs(tasks): record Plan 0 partial verification results
- feat(db): audit trigger infra + smoke test + Supabase CLI wiring

### Secrets management note

`.env.local` (root + `apps/web/.env.local`) hold:
- `SUPABASE_ACCESS_TOKEN` (PAT, rotatable)
- `SUPABASE_DB_PASSWORD` (rotatable; pasted in chat transcript — should rotate after session)
- `SUPABASE_SERVICE_ROLE_KEY` (rotatable from dashboard)

Both `.env.local` files are gitignored. CI will need separate secrets set in GitHub Actions when deploy time comes.

### Next steps

- Plan 1 — Auth + Roles + Sessions (email+password auth, `users`/`user_roles`/`sessions`/`auth_events` tables, `hasPerm` bound to real sessions, middleware-gated admin routes, new-device email alert).
- Prereqs: confirm 13-player roster list for future seed, decide Resend API key sourcing (optional for Plan 1 email test).
