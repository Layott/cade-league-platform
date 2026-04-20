# Tasks — Active Work

Active plan: `docs/superpowers/plans/2026-04-20-plan-0-foundations.md`

Update this file as work progresses per parent CLAUDE.md workflow.

## In Progress
- Plan 0 — Foundations (non-Docker tasks complete; Docker-dependent tasks 4, 5, 6, 7, 15 partial pending Docker install)

## Done
- Spec: `docs/superpowers/specs/2026-04-20-phase-1a-design.md`
- Product doc updated to v0.2 with decisions log
- Plan 0 Tasks 1, 2, 3, 8, 9, 10, 11, 12 complete (repo init, workspace, Next.js scaffold, Supabase clients, WAT time helper, perms stub, landing page + E2E, Prettier)

## Blocked
- Plan 0 Tasks 4, 5, 6, 7 (Supabase local + audit trigger) — blocked on Docker Desktop install
- Plan 0 Task 15 verification — audit-smoke step blocked; other verification steps pass

## Review

### Plan 0 partial verification — 2026-04-20

Non-Docker tasks executed cleanly. Verification commands run from repo root:

| Command | Result |
|---------|--------|
| `npm run test` | 8 passed (time: 3, perms: 5) |
| `npm run lint` | clean (no errors) |
| `npm run build` | Next.js 15 production build ok — 2 static pages |
| `npm --workspace apps/web run e2e` | 1 Playwright test passed |
| `npm run audit:smoke` | **skipped** (Docker not installed) |
| `npx supabase db reset` | **skipped** (Docker not installed) |

Commits in this run (git log --oneline):
- chore: initial repo scaffold (gitignore, nvmrc, README, existing docs)
- chore: add root workspace package.json
- chore: scaffold Next.js 15 app at apps/web with deps
- feat(web): supabase server + browser clients + test scripts
- feat(web): WAT timezone helpers + vitest setup
- feat(web): Phase 1A hard-coded permission map + hasPerm helper
- test(web): landing page + Playwright smoke E2E
- chore(web): Prettier config
- docs: seed tasks/todo.md and tasks/lessons.md
- ci: add lint/test/build workflow

### Next steps

- Install Docker Desktop.
- Resume Plan 0 Tasks 4–7 (Supabase init, migrations, audit trigger, audit smoke test) and Task 15 full verification.
- Then Plan 1 — Auth + Roles + Sessions.
