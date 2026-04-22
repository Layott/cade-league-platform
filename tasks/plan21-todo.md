# Plan 21 — FC 26 Kaggle Ingest + Lookup

## Goal
Local DB of FC 26 FUT items (from periodic Kaggle dumps) so the ref review UI (Plan 23) can resolve OCR-transcribed squad items to known players.

## Tasks

### A. Spec
- [ ] Write `docs/superpowers/specs/2026-04-22-plan-21-fcdb-kaggle-ingest.md`

### B. Migration
- [ ] `supabase/migrations/20260506000004_fc26_players.sql` — table + indexes + trigram + audit.
- [ ] `npm run db:push` (apply to cloud).
- [ ] Verify table + trigger via db:query.

### C. Importer
- [ ] `KNOWLEDGE/extracted/_fc26_import.py` — reads CSV → upserts via psql/HTTP. If CSV absent, prints instructions + exits 0.
- [ ] `scripts/fc26-import.sh` wrapper (optional) invoking python.

### D. Server module `apps/web/src/server/fcdb/`
- [ ] `types.ts` — `FCPlayer` type.
- [ ] `lookup.ts` — `findPlayer(sb, query)` ranked top-5.
- [ ] `lookup.test.ts` — exact slug, rating filter, fuzzy fallback, no-match, ambiguity.
- [ ] `validate.ts` — `validateSubmittedSquadAgainstFCDB(items, sb)`.
- [ ] `validate.test.ts` — per-item status.
- [ ] `index.ts` re-export.

### E. Runbook
- [ ] `docs/ops/fc26-data-refresh.md`.

### F. Gates
- [x] `npm run lint` — 0 errors (5 pre-existing warnings in tracked files; 0 new from fcdb).
- [x] `npm run test` — 533 pass across 86 files. Pre-existing broken untracked file `CadePlayerCard.test.tsx` is unrelated to Plan 21.
- [x] fcdb module tests: 30 green (slug 10 + lookup 12 + validate 8).
- [ ] `npm run build` — fails on pre-existing uncommitted `(overlay)/overlay/layout-animated-bg/page` work; does not reference any Plan 21 file.
- [x] Migrations applied via `supabase db push`; table + audit trigger + RPC verified via `supabase db query`.
- [x] Commit per logical slice: migration+spec, importer, server module+RPC, runbook.

## Review

Delivered table `public.fc26_players` + fuzzy RPC + Python Kaggle importer +
TS server module (`@/server/fcdb`) with ranked lookup and per-squad validation.
Importer is deliberately no-op on missing CSV. Slug normalization is shared
contract between Python + TS (tested both sides).

**Out of scope per spec:** live coin prices (Plan 24), auto-refresh cron
(Plan 21B), ref-review UI (Plan 23).

**Unresolved externals (not caused by Plan 21):**
1. `npm run build` fails on pre-existing untracked overlay-preview/player-card
   work in flight. My code type-checks clean under `tsc --noEmit`.
2. `CadePlayerCard.test.tsx` has a rolldown parse error — untracked file,
   predates Plan 21.

**Blocker for end-to-end:** user must drop the Kaggle CSV at
`KNOWLEDGE/extracted/fc26_players_kaggle.csv` (see runbook §3). Until then,
lookup against the empty table returns `unknown` for every row, which is the
correct degraded behaviour.
