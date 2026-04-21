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
- [ ] `npm run lint` clean.
- [ ] `npm run test` — ≥10 new tests green.
- [ ] `npm run build` clean.
- [ ] Commit per logical slice; push.
