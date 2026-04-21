# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository State

**Stage:** pre-scaffold. No application code exists yet. This repo currently holds product documentation and a locked Phase 1A design spec. Implementation begins after the implementation plan (see §Workflow) is approved.

Once scaffolded, the stack is **Next.js 15 (App Router) + Supabase (Postgres/Auth/Storage) monolith**. Build/lint/test commands will be added here when `package.json` is created.

## Primary Documents

Read these before proposing changes — they contain decisions already made:

- `ESOCCER LEAGUE/PRODUCT_STRUCTURE.md` — product vision, phase plan, full data model, role matrix, §2.5 Decisions Log with dropped/deferred features. Authoritative for what is and isn't being built.
- `docs/superpowers/specs/2026-04-20-phase-1a-design.md` — detailed Phase 1A spec: schema, module boundaries, audit trigger design, standings recompute algorithm, attendance flow, permission map. Authoritative for Phase 1A implementation.
- `../CLAUDE.md` (parent directory) — user's global workflow instructions: plan-first, subagent strategy, `tasks/todo.md` + `tasks/lessons.md` cadence, verification-before-done.
- `KNOWLEDGE/` — source rulebooks, player agreement, integrity policy, fixtures spreadsheet. Use as source of truth for league rules (late-arrival ladder, squad budget, Nigerian-item requirement, etc.).

## Scope Discipline

Phase 1A is **deliberately minimal**. The following are **dropped entirely** (do not implement, do not propose unless user reopens): GPS geofence, QR check-in, prize disbursement automation, under-18 parental consent, auto promotion/relegation, mobile app, anonymous whistleblower flow.

The following are **deferred** to later phases (do not build in Phase 1A): vMix overlays, multi-season abstraction, Futbin scraper, social/weekly graphics, full 12-role matrix, squad submission + Friday change window.

**Dropped entirely as of 2026-04-21:** Paystack payment gateway + caution-fee ledger automation. Payment tracking will be manual bank-transfer + ledger rows only; no gateway integration at any phase.

When in doubt about a feature, check §2.5 of `PRODUCT_STRUCTURE.md` and §16 of the Phase 1A spec before writing code.

## Architectural Non-Negotiables (Phase 1A)

These decisions are locked. Do not deviate without user approval:

1. **Monolith.** Single Next.js repo, route groups `(public)` and `(admin)`. Not two codebases.
2. **Hard-coded permissions.** Phase 1A ships a TypeScript constant map in `src/perms.ts`, not a `RolePermission` DB table. Migrate to DB in Phase 1B.
3. **Audit via Postgres trigger.** Generic `audit_row_change()` trigger attached to every mutable table, reading `current_setting('app.current_user_id')` set by API middleware. No hand-coded audit calls in route handlers.
4. **RLS only on PII tables** (`users`, `players` with bank/ID data, `payments`). Business permissions enforced in the API layer via single `hasPerm()` helper. Do not scatter RLS across business tables.
5. **Idempotent standings recompute.** Any change to `match_results` or `disciplinary_actions` triggers a full recompute of affected season's standings from scratch. Never patch incrementally.
6. **Soft delete + Restore from Day 1.** Every table has `deleted_at`. Queries filter it out. Admin `/trash` UI lists soft-deleted rows with Restore action. No hard-delete UI in Phase 1A.
7. **Timezone hard-coded to `Africa/Lagos` (WAT).** All date/time arithmetic uses this zone.
8. **Hard-coded Elite 2025-2026 season.** Do not build multi-season or multi-division configuration layers yet.

## Roles (Phase 1A)

Four values in `user_roles.role`: `admin`, `moderator`, `player`. Unauthenticated public is implicit (no row). One user may hold multiple rows.

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

## Seed Data

`supabase/seed.sql` (to be created) will contain the 13-player roster + one season + sample match days. The user will supply the player list. Seed is dev-only — guard with `NODE_ENV`.

## Backup Strategy

- Local dev: daily `supabase db dump` into gitignored `backups/` (rotate 14 days).
- Production: GitHub Actions cron → `pg_dump` → Backblaze B2 (30 daily + 12 monthly retention).
- Quarterly restore drill to staging.
