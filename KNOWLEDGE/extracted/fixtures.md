# Elite 2025-2026 — Round-Robin Fixtures

Single round-robin for the 13-player Elite roster. Generated deterministically
by `KNOWLEDGE/extracted/_fixture_gen.py` using the circle method over a roster
with a virtual BYE at position 14. 13 rounds × 6 matches = **78 fixtures**.
Each player plays the other 12 exactly once and rests exactly once.

All match days are Saturdays. Venue fixed to **CADE Studio, Lagos**. Arrival
cutoff **09:00 WAT**, match start **10:00 WAT**. All dates/times are
`Africa/Lagos`.

Seed SQL: `supabase/seed/plan18_fixtures.sql`. Unique-index backstop:
`supabase/migrations/20260506000000_matches_unique_fixture.sql`.

## Round 1 — 2025-11-01 (Sat) — Bye: ADEFOLA

| # | Home | Away |
|---|---|---|
| 1 | ANIFE | WOLEVATION |
| 2 | BAJI_JNR | TACTICAL |
| 3 | DADABOI | MR_OGA |
| 4 | FARUK | MITCH |
| 5 | GURU | KINGNONEX |
| 6 | KAYKAY | KILLER_FREAK |

## Round 2 — 2025-11-08 (Sat) — Bye: TACTICAL

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | WOLEVATION |
| 2 | ANIFE | MR_OGA |
| 3 | BAJI_JNR | MITCH |
| 4 | DADABOI | KINGNONEX |
| 5 | FARUK | KILLER_FREAK |
| 6 | GURU | KAYKAY |

## Round 3 — 2025-11-15 (Sat) — Bye: MITCH

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | TACTICAL |
| 2 | WOLEVATION | MR_OGA |
| 3 | ANIFE | KINGNONEX |
| 4 | BAJI_JNR | KILLER_FREAK |
| 5 | DADABOI | KAYKAY |
| 6 | FARUK | GURU |

## Round 4 — 2025-11-22 (Sat) — Bye: KILLER_FREAK

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | MR_OGA |
| 2 | TACTICAL | MITCH |
| 3 | WOLEVATION | KINGNONEX |
| 4 | ANIFE | KAYKAY |
| 5 | BAJI_JNR | GURU |
| 6 | DADABOI | FARUK |

## Round 5 — 2025-11-29 (Sat) — Bye: GURU

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | MITCH |
| 2 | MR_OGA | KINGNONEX |
| 3 | TACTICAL | KILLER_FREAK |
| 4 | WOLEVATION | KAYKAY |
| 5 | ANIFE | FARUK |
| 6 | BAJI_JNR | DADABOI |

## Round 6 — 2025-12-06 (Sat) — Bye: DADABOI

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | KINGNONEX |
| 2 | MITCH | KILLER_FREAK |
| 3 | MR_OGA | KAYKAY |
| 4 | TACTICAL | GURU |
| 5 | WOLEVATION | FARUK |
| 6 | ANIFE | BAJI_JNR |

## Round 7 — 2025-12-13 (Sat) — Bye: ANIFE

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | KILLER_FREAK |
| 2 | KINGNONEX | KAYKAY |
| 3 | MITCH | GURU |
| 4 | MR_OGA | FARUK |
| 5 | TACTICAL | DADABOI |
| 6 | WOLEVATION | BAJI_JNR |

## Round 8 — 2025-12-20 (Sat) — Bye: WOLEVATION

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | KAYKAY |
| 2 | KILLER_FREAK | GURU |
| 3 | KINGNONEX | FARUK |
| 4 | MITCH | DADABOI |
| 5 | MR_OGA | BAJI_JNR |
| 6 | TACTICAL | ANIFE |

## Round 9 — 2025-12-27 (Sat) — Bye: MR_OGA

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | GURU |
| 2 | KAYKAY | FARUK |
| 3 | KILLER_FREAK | DADABOI |
| 4 | KINGNONEX | BAJI_JNR |
| 5 | MITCH | ANIFE |
| 6 | TACTICAL | WOLEVATION |

## Round 10 — 2026-01-03 (Sat) — Bye: KINGNONEX

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | FARUK |
| 2 | GURU | DADABOI |
| 3 | KAYKAY | BAJI_JNR |
| 4 | KILLER_FREAK | ANIFE |
| 5 | MITCH | WOLEVATION |
| 6 | MR_OGA | TACTICAL |

## Round 11 — 2026-01-10 (Sat) — Bye: KAYKAY

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | DADABOI |
| 2 | FARUK | BAJI_JNR |
| 3 | GURU | ANIFE |
| 4 | KILLER_FREAK | WOLEVATION |
| 5 | KINGNONEX | TACTICAL |
| 6 | MITCH | MR_OGA |

## Round 12 — 2026-01-17 (Sat) — Bye: FARUK

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | BAJI_JNR |
| 2 | DADABOI | ANIFE |
| 3 | GURU | WOLEVATION |
| 4 | KAYKAY | TACTICAL |
| 5 | KILLER_FREAK | MR_OGA |
| 6 | KINGNONEX | MITCH |

## Round 13 — 2026-01-24 (Sat) — Bye: BAJI_JNR

| # | Home | Away |
|---|---|---|
| 1 | ADEFOLA | ANIFE |
| 2 | DADABOI | WOLEVATION |
| 3 | FARUK | TACTICAL |
| 4 | GURU | MR_OGA |
| 5 | KAYKAY | MITCH |
| 6 | KILLER_FREAK | KINGNONEX |

## Integrity checks

* **Total matches:** 13 rounds × 6 = 78 = C(13, 2). ✓
* **Matches per player:** 12 (each of the 12 opponents exactly once). ✓
* **Rests per player:** 1 (every player on the 13-slot bye rotation). ✓
* **Bye rotation:** ADEFOLA, TACTICAL, MITCH, KILLER_FREAK, GURU, DADABOI, ANIFE, WOLEVATION, MR_OGA, KINGNONEX, KAYKAY, FARUK, BAJI_JNR — all 13 players appear exactly once. ✓
