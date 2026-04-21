# Plan 21 — FC 26 Kaggle Player DB ingest + lookup module

**Status:** drafted 2026-04-22.
**Depends on:** Plan 10 (squad submissions), Plan 14 (stats OCR — same review-UI patterns).
**Feeds into:** Plan 23 (ref review UI for transcribed squad items).

---

## 1. Goal

When a CADE player submits a weekly squad screenshot (Plan 10), the screenshot
is OCR'd into per-row `{ name, rating, position, value, item_type }` rows. The
ref then needs to confirm each row before the squad is approved or rejected.

Today the ref does this from memory + by spot-checking on Futbin. That's slow,
typo-prone, and not auditable.

**Plan 21** ships a local Postgres table — `fc26_players` — populated from a
periodic Kaggle dump of the FC 26 player database. Plan 21 also ships a server
module (`apps/web/src/server/fcdb/`) the Plan 23 review UI will call to mark
each transcribed item one of:

- `resolved`  — exact slug match with a single high-confidence candidate.
- `fuzzy`     — best trigram match available; ref must confirm.
- `unknown`   — no match within similarity threshold; possible typo.

We deliberately do **not** scrape live coin prices or live ratings. Plan 24
(deferred) will tackle that. Plan 21 only needs the metadata catalogue.

---

## 2. Data source

- **Kaggle dataset:** `flynn28/eafc26-player-database`
  (https://www.kaggle.com/datasets/flynn28/eafc26-player-database).
  Picked because it is the largest of the four community FC 26 dumps surveyed,
  has the cleanest column naming, and is updated within days of each major FC 26
  patch.
- **License posture:** community-curated metadata. Kaggle file metadata is CC0 /
  CC-BY (varies per uploader); the underlying attribute values are EA Sports'
  product attributes, used here for personal/research league use under the same
  norms applied to Futbin / FUTWIZ scrapes. Not redistributed publicly.
- **Refresh cadence:** monthly, manual trigger (Plan 21B may automate via GitHub
  Action).
- **Columns we consume** (Kaggle column → table column):
  - `id` → `source_row_id`
  - `name` → `name` (also derives `slug`)
  - `short_name` → `short_name`
  - `overall` → `rating`
  - `position` (primary) → `position`
  - `alt_positions` (comma-separated string) → `alt_positions text[]`
  - `club_name` → `club`
  - `league_name` → `league`
  - `nationality_name` → `nation`
  - `nationality_iso` → `nation_iso`
  - `age` → `age`
  - `height_cm`, `weight_kg` → as named
  - `preferred_foot` → `preferred_foot`
  - `weak_foot`, `skill_moves` → as named
  - `body_type` → `body_type`
  - `attacking_work_rate`, `defensive_work_rate` → `work_rate_atk`, `work_rate_def`
  - `pace, shooting, passing, dribbling, defending, physical` and all
    sub-attributes → packed into `attributes jsonb`.
  - `item_type` (`gold`, `totw`, `icon`, `hero`, `evolution`, `special`,
    `other`) → `item_type` (default `'normal'`).
  - `value_eur` (placeholder; many dumps don't carry coin price) →
    `value_coins_estimate bigint nullable`.

If the user has not dropped a CSV at
`KNOWLEDGE/extracted/fc26_players_kaggle.csv`, the importer prints the runbook
location and exits 0 — no error. This keeps CI / fresh clones green.

---

## 3. Migration

`supabase/migrations/20260506000004_fc26_players.sql`. Schema in §B of the
parent task spec. Key invariants:

- `slug` (lowercased, diacritic-stripped, spaces→`_`) is the lookup key.
  Indexed (partial, `where deleted_at is null`).
- `rating` is `int CHECK (rating BETWEEN 1 AND 99)`.
- `attributes` is `jsonb NOT NULL` — packs all FUT face stats.
- `item_type` defaults to `'normal'` so any null/missing source value still
  satisfies NOT NULL.
- `pg_trgm` extension is created (idempotently); `name` gets a GIN trigram
  index to support fuzzy fallback in lookup.
- `attach_audit('public.fc26_players')` — every insert/update/delete writes to
  `audit_events` via the standard trigger. CLAUDE.md non-negotiable §3.
- Soft-delete: `deleted_at timestamptz`. CLAUDE.md non-negotiable §6.
- Idempotent re-import: partial unique index on
  `(source_dataset, source_row_id) where deleted_at is null`. The importer
  upserts via this constraint.
- No RLS — this is a public catalogue, not PII. CLAUDE.md non-negotiable §4.

---

## 4. Importer (`KNOWLEDGE/extracted/_fc26_import.py`)

Python over Node because:
1. The Kaggle CLI is Python-native (consistent toolchain for ops).
2. Pandas handles the CSV column normalization in 5× less code than Papa.
3. `unicodedata.normalize` for diacritic stripping is stdlib.

Flow:

1. Load `KNOWLEDGE/extracted/fc26_players_kaggle.csv`.
   - **Missing → print install instructions + exit 0.**
2. For each row:
   - Build `slug = re.sub(r"\s+", "_", strip_diacritics(name).lower().strip())`.
   - Pack face stats into `attributes` dict.
   - Default `item_type` to `'normal'` if column missing/empty.
   - Derive `nation_iso` from `nationality_name` if dump lacks ISO column
     (best-effort; falls back to `null`).
3. Upsert into Postgres via `psycopg2` (connection string from `SUPABASE_DB_URL`
   env var) using:
   ```sql
   INSERT INTO public.fc26_players (...) VALUES (...)
   ON CONFLICT (source_dataset, source_row_id)
   WHERE deleted_at IS NULL
   DO UPDATE SET
     name = excluded.name, rating = excluded.rating,
     ... , updated_at = now();
   ```
4. Print: rows processed, rows inserted, rows updated, duration. Exit 0.

If `SUPABASE_DB_URL` is unset, print clear setup instructions + exit 1.

The script lives next to the CSV it consumes so it's discoverable with the data
it processes — the rest of `KNOWLEDGE/extracted/` follows the same pattern
(`_fixture_gen.py`, `_real_fixtures.py`).

---

## 5. Server module (`apps/web/src/server/fcdb/`)

### `types.ts`
Mirrors the table 1:1. Brand attribute keys with a `FCAttributes` interface so
TS surfaces typos at call sites.

### `lookup.ts` — `findPlayer(sb, query)`
Returns top 5 ranked candidates. Algorithm (short-circuit on first hit):

1. Compute `slug` from `query.name` using the same normalization as the
   importer (kept in `slug.ts` to share with the importer's spec — Python
   importer reimplements; TS owns the runtime contract).
2. **Exact slug match.** Fetch all rows where `slug = $slug` and `deleted_at
   is null`. If `query.rating` provided, filter to `rating BETWEEN q.rating-1
   AND q.rating+1` (FC dumps drift by ±1 between snapshots).
3. If exact slug returned ≥1 row, apply secondary boosts (position match +1,
   club match +1) and return top 5 sorted by score then rating desc.
4. **Fuzzy fallback** (no exact slug hits): trigram similarity:
   ```sql
   select *, similarity(name, $1) as sim
   from fc26_players
   where deleted_at is null and similarity(name, $1) > 0.3
   order by sim desc
   limit 10;
   ```
   Apply rating filter (±1) post-fetch if provided. Apply position/club boosts
   to score. Return top 5.
5. If still 0 → return empty array. Caller surfaces as `unknown`.

### `validate.ts` — `validateSubmittedSquadAgainstFCDB(items, sb)`
For each item in a Plan 10 submission, call `findPlayer` and emit:

```ts
type FCDBValidationResult = {
  slotIndex: number;
  status: 'resolved' | 'fuzzy' | 'unknown';
  candidate?: FCPlayer;          // present when resolved/fuzzy
  alternatives?: FCPlayer[];     // up to 4 runners-up
};
```

Rules:
- 1 exact-slug hit AND name length ≥ 4 AND (rating not provided OR rating
  matches within ±1) → `resolved`.
- ≥2 exact-slug hits OR exact-slug hit with rating mismatch → `fuzzy`
  (caller picks).
- 0 exact-slug hits but ≥1 trigram hit → `fuzzy`.
- 0 hits anywhere → `unknown`.

### `index.ts`
Re-export `findPlayer`, `validateSubmittedSquadAgainstFCDB`, and the `FCPlayer`
type. Keep the public surface narrow.

---

## 6. Tests

Unit (Vitest, mock SupabaseClient):

1. `lookup.test.ts`
   - Exact slug match returns the single candidate.
   - Exact slug + rating filter narrows from 3 candidates to 1.
   - Multiple slug hits (e.g. two "Lionel Messi" items at different ratings)
     return all 5 sorted by rating desc.
   - 0 exact hits → fuzzy fallback path is invoked.
   - 0 fuzzy hits → returns empty array.
   - Position boost reorders ties.
   - Slug normalization: `"Pépé"` and `"pepe"` resolve to the same slug.
2. `validate.test.ts`
   - Single submission with 1 resolved, 1 fuzzy, 1 unknown.
   - Resolved item exposes the candidate, no alternatives.
   - Unknown item exposes empty alternatives, no candidate.
3. `slug.test.ts` (pure, no DB)
   - Diacritic stripping (Pépé → pepe).
   - Punctuation handling (O'Connor → o_connor).
   - Multi-space collapse.

Target ≥10 unit tests across the three files.

E2E: out of scope — Plan 23 will add the ref-review E2E that exercises this
module against real cloud data.

---

## 7. Numbered tasks

1. Migration `20260506000004_fc26_players.sql`. `npm run db:push`. Verify
   trigger + indexes via `supabase db query`.
2. Importer `KNOWLEDGE/extracted/_fc26_import.py` + missing-CSV fast-exit
   path. Smoke-run.
3. Server module: `slug.ts` + `slug.test.ts`.
4. Server module: `types.ts`.
5. Server module: `lookup.ts` + `lookup.test.ts`.
6. Server module: `validate.ts` + `validate.test.ts`.
7. Server module: `index.ts` re-export.
8. Runbook `docs/ops/fc26-data-refresh.md`.
9. Verification gate: lint + test + build.
10. Commit per slice + push.

---

## 8. Verification gate

Before marking Plan 21 done:
1. `npm run lint` clean.
2. `npm run test` — ≥10 new tests green; total still green.
3. `npm run build` clean.
4. `npm run db:push` — migration applied; `select count(*) from fc26_players`
   returns a number (0 when CSV not loaded).
5. Importer smoke: `python KNOWLEDGE/extracted/_fc26_import.py` with no CSV →
   prints instructions, exits 0.

---

## 9. Risks

- **Dataset staleness.** Kaggle dumps lag EA's live patches by 1–7 days. A
  squad submitted hours after a TOTW drop may not resolve. Mitigation:
  `fuzzy` status surfaces the closest match the ref can manually confirm.
- **Name normalization across diacritics + alphabets.** Players from MENA,
  Korean, Japanese leagues may appear with multiple romanizations. Mitigation:
  trigram fallback + ref override.
- **Ambiguous matches.** Two items at the same rating + position (e.g. base
  gold + TOTW versions of the same player). Mitigation: `findPlayer` returns
  top 5; ref picks via Plan 23 UI.
- **Importer corruption.** A bad CSV column rename upstream silently maps to
  null. Mitigation: importer prints column-mapping summary at start; runbook
  spot-check step.

---

## 10. Out of scope (this plan)

- Live coin prices (Plan 24, deferred).
- Auto-refresh / GitHub Action cron (Plan 21B).
- UI changes (Plan 23 owns the ref-review surface).
- Resolving non-FUT items (managers, stadiums, balls) — only player items.
- Multi-game support (FC 27, etc.) — table is FC 26 specific.
