# Prod smoke walkthrough — 2026-04-25

URL: https://cade-league.vercel.app
Latest deploy: `htui0rpok` (commit `bef18f7d`)

## Tournament — what works
- ✓ All 8 tabs load (no 500s, no console errors)
- ✓ Standings shows 13 players
- ✓ Fixtures shows 79 fixtures across 9 match-days
- ✓ Results entry form: match-day + fixture + score selectors functional
- ✓ Walkovers: 79 fixture options + Trigger walkover button
- ✓ Tiebreaker config: 4 draggable + Add/Save/Reset buttons
- ✓ H2H lookup: 13 player chips + comparison cards render
- ✓ Win-prob preview: A/B selectors + formula breakdown
- ✓ Adjustments: 4 disciplinary records show
- ✓ XLSX download API returns valid xlsx (200, 19874 bytes)
- ✓ Leaderboard API returns 13 rows

## Broadcast v2 — what works
- ✓ Page renders 16 cards · 18 trigger buttons · 10 hide buttons · 16 preview iframes
- ✓ BRB toggle ON/OFF flips overlay route opacity correctly
- ✓ Timer: edit min:sec → re-trigger fires fresh expiresAt → countdown 04:53 from 5:00
- ✓ H2H-2: change player A to KAYKAY → re-trigger → photo/name/org all swap (LUMO LABS)
- ✓ Lower-third slot 1: edit name "PRODNAME" + role "PRODROLE" → trigger → DOM reflects
- ✓ Top-scorers toggle: ON → cade-visible, podium opacity 1
- ✓ Per-element observer (`cade-visible-gate-observer-v2`) flips opacity correctly with `!important`

## Bugs found

### Bug 1 — Anife form column shows "LLLLL" with played=0
- **Surface**: `/admin/tournament/standings` + `/api/tournament/leaderboard`
- **Symptom**: All other 12 players show form `—` (no games). Anife's row shows 5 `L`s.
- **Hypothesis**: Form derivation reads from `match_results` rows that include voided/walkover_pending or deleted_at-set rows where Anife "lost". The `form` query doesn't filter `deleted_at IS NULL` or `result_type != 'void'`.
- **Severity**: P2 cosmetic (display-only, doesn't affect points/GD).

### Bug 2 — Win-prob default hallucinates H2H "14W-0D-0L · 14 matches"
- **Surface**: `/admin/tournament/win-prob-preview` (default A=Adefola B=Anife)
- **Symptom**: Formula breakdown shows `H2H score A (14W-0D-0L · 14 matches) 1.000 × 0.4` even when 0 matches played between them.
- **Hypothesis**: H2H query in `win_probability.ts` reads ALL match_results across season instead of filtered to A vs B specifically. OR returns wrong default (perhaps falls through with stale matchCount = 14 = total fixtures involving Adefola).
- **Severity**: P1 — wildly skews win-prob result + visible on H2H broadcast overlays.

### Bug 3 — Adefola win-prob 80% with played=0
- **Surface**: same H2H lookup + win-prob preview
- **Symptom**: Adefola has -4 PTS / -3 GD (real disciplinary deductions). Win-prob shows Adefola WINS 80% vs Anife 4%.
- **Hypothesis**: When a player has DISCIPLINARY adjustments but no played matches, the strength formula divides by 0 OR treats negative pts as proxy for high strength (sign error). Combined w/ Bug 2's fake H2H score (1.000 favoring Adefola because `pointsAdj < pointsAdj_anife`?), produces extreme tilt.
- **Severity**: P1 — visible on h2h overlays + tournament page.

## Other observations (not bugs)
- 3 Vercel deploys errored before success (vitest typecheck, path-doubling, file-count limit).  All resolved.
- audit_events 506MB → 40kB after wipe + detach.
- 4 disciplinary records visible from before (Adefola: -1pts + -3pts + -3GD; Faruk: -3GD).

## Round 2 — additional surface tests + bugs

### What works ✓
- Orgs toggle: 12 cards render w/ opacity 1
- Coaches toggle: 11 cards w/ opacity 1
- Penalties toggle: 4 cards w/ opacity 1
- Starting-soon toggle: cade-visible, full canvas
- Stream-ended toggle: cade-visible
- Leaderboard toggle: 13 rows render w/ opacity 1
- Match-scores-day Part 1 trigger: cade-visible (rows render but partRange filter not verified)
- **Walkover full submit**: clicked "Trigger walkover" → confirm modal → confirm → standings recompute live (Adefola: played=1 GF=3 form=W; Guru: played=1 GA=3 form=L). Live Realtime publish works.
- **Tiebreaker drag-rank save**: ↑/↓/Save buttons functional. After save, leaderboard reorders.
- **Walkover form button** ("Trigger walkover") is type=`button` not type=`submit` — opens confirm modal first (intentional design). Submit happens after Confirm click.

### New Bug #4 — Lower-third 2 simultaneous slots only show ONE on overlay
- Triggered slot 1 (SLOT1A/TESTROLE1) AND slot 2 (SLOT2B/TESTROLE2)
- Overlay HTML has only 1 `.lt` element in DOM. Slot 2 trigger overwrites slot 1.
- Backend `overlay_active_instances` correctly tracks 3 slots, but HTML doesn't render them as separate positioned bars.
- **Fix needed**: lower-third HTML must render up to 3 `.lt` instances at different positions (e.g., bottom-left for slot 1, bottom-center for slot 2, bottom-right for slot 3) AND route messages by `slot` field to the correct instance.
- **Severity**: P2 (not blocking core flow but user explicitly asked for 3 simultaneous).

## Bugs FIXED (round 2)
- ✓ Bug 4 lower-third 3 simultaneous — `42c65d1e` rendered 3 `.lt` instances at distinct anchors (BL/BC/BR) routed by slot.

## Bugs FIXED (round 1)
- ✓ Bug 1 form LLLLL → `""` after `ed58541b` walkover_pending filter + soft-delete of 14 e2e leftover rows
- ✓ Bug 2 fake H2H "14W-0D-0L" → "no prior matches" after same fix
- ✓ Bug 3 Adefola 80% → 37.5% symmetric after zero-played guard in `computeWinProbability`

## Not yet tested (would benefit from extra round)
- Walkover trigger end-to-end (form submit → standings reflects)
- Tiebreaker drag-rank save → standings reorder
- Score bug player+score change + re-trigger
- Up-next match selector + re-trigger
- Match-scores-day part 1/2/3/All buttons
- Actual XLSX file content (just header check)
- Lower-third slots 2 + 3 simultaneous
- 9 simple-toggle overlays (only BRB + top-scorers verified, leaderboard/orgs/coaches/penalties/starting-soon/stream-ended/animated-bgs not tested)
- Score-entry submit → standings recompute → broadcast Realtime push to leaderboard overlay
