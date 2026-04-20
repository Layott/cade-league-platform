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

The following are **deferred** to later phases (do not build in Phase 1A): vMix overlays, multi-season abstraction, Paystack, Futbin scraper, social/weekly graphics, full 12-role matrix, squad submission + Friday change window.

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

Per parent `CLAUDE.md`, non-trivial work uses this cadence:

1. **Plan first.** Write plan to `tasks/todo.md` with checkable items. Validate scope with the user before coding.
2. **Track progress.** Mark items complete as you go; summarize each step at a high level.
3. **Document results.** Add a review section to `tasks/todo.md` when done.
4. **Capture lessons.** Append to `tasks/lessons.md` after any user correction.
5. **Verify before claiming done.** Run tests, demonstrate the success-criteria scenarios in §1 of the Phase 1A spec.

For implementation plans derived from an approved spec, invoke the `superpowers:writing-plans` skill. For new features outside the current spec, invoke `superpowers:brainstorming` first.

## Seed Data

`supabase/seed.sql` (to be created) will contain the 13-player roster + one season + sample match days. The user will supply the player list. Seed is dev-only — guard with `NODE_ENV`.

## Backup Strategy

- Local dev: daily `supabase db dump` into gitignored `backups/` (rotate 14 days).
- Production: GitHub Actions cron → `pg_dump` → Backblaze B2 (30 daily + 12 monthly retention).
- Quarterly restore drill to staging.
