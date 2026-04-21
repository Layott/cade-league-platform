# Plan 18 — Real fixture extraction from xlsx

## Input

- File: `KNOWLEDGE/EVENT FLOW DIVISION 2 CADE ESPORTS ESOCCER.xlsx` (despite the name, this workbook carries both divisions' per-match-day event flows).
- Sheets walked: `WK 1 DAY 1` through `WK 7 DAY 1` plus `LAST DAY OF THE LEAGUE` — 14 sheets.
- Per-row H2H cells dual-column (Div 1 | Div 2). Extractor pulls both and filters to the 13-player Elite roster.

## Extraction result

- **13 match days** produced H2H pairings (`LAST DAY` had no extractable rows).
- **34 Division 1 matches** found, covering featured/staged H2H — see `real_fixtures.txt` for per-day listing.
- **Not a full round-robin** (13 × 12 / 2 = 78). Only ~44% of the fixture list. The xlsx documents the **on-stream featured H2H schedule**, not every league match. Remaining ~44 matches likely happen on side stations or off-stream.

## Names encountered outside our roster

Roster: ADEFOLA, ANIFE, BAJI_JNR, DADABOI, FARUK, GURU, KAYKAY, KILLER_FREAK, KINGNONEX, MITCH, MR_OGA, TACTICAL, WOLEVATION.

Extra names found in xlsx (Division 2 pairings bleeding into same cells, or a larger Elite cohort):

```
Balo K, Blaise99, Bright, Dracarys, Flick, GameWithJosh (Gamewithjoshh),
KhaledOY (Khaleedoy), Rhymez, SON OF GOD (Son of God), Simplyy Uzo, Yemi
```

Ambiguity: `Baji SNR` vs our photo folder `BAJI JNR`. Extractor maps SNR → BAJI_JNR on assumption these are the same competitor; if they're actually different people (senior/junior naming), revisit.

## Decision

The **authoritative fixture seed remains `supabase/seed/plan18_fixtures.sql`** (synthetic 78-match round-robin via circle method) because:

1. The xlsx is a partial stream schedule, not the full league fixture list.
2. Player name mismatches (BAJI_JNR vs BAJI SNR, unknown Elite cohort members) require LOC confirmation before overwriting DB fixtures.
3. The public `/fixtures` page still needs ALL 78 pairings; using only 34 would leave most players stuck at 6 scheduled matches instead of 12.

## What's shipped in Plan 18

- `_real_fixtures.py` — re-runnable extractor.
- `real_fixtures.txt` — raw per-day dump for visual inspection.
- `real_fixtures.md` — this document.

## Follow-up (when LOC hands authoritative full schedule)

Option A — LOC provides a complete 78-row xlsx (e.g. a new "All Fixtures" sheet):
1. Extend `_real_fixtures.py` to read that sheet.
2. Regenerate `supabase/seed/plan18_fixtures.sql` with real dates + real pairings.
3. Migrate the cloud DB: delete existing `match_days` + `matches` seeded rows, re-seed. Or simpler: UPDATE existing rows to the new pairings.

Option B — stream schedule stays partial:
1. Keep synthetic 78-match RR as is.
2. Add an `is_featured_on_stream boolean` column to `matches` via migration.
3. Flip `is_featured_on_stream = true` for the 34 xlsx-matched pairings via a targeted UPDATE script.
4. Public `/fixtures` page shows a "★ Stream" badge on those 34.

Either path takes one implementation session once LOC confirms source-of-truth.
