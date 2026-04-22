# Plan 30 — Squad Picker UI (card typeahead + pitch + live totals)

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-22
**Status:** Approved
**Depends on:** Plan 10 (squad submissions + Friday change window), Plan 21 (fc26_players schema + fuzzy RPC), Plan 23 (fcdb link on squad_items)
**Feeds:** Plan 40 profile squad widget, Plan 41 /player/squad page

---

## 1. Goal

Replace the current manual-text squad submission UI with a Futbin-style squad builder:

1. Search card by name → typeahead returns top-10 candidates (name + rating + position + club badge if available)
2. Drop the picked card onto one of 11 pitch slots (+ 7 sub slots — optional)
3. Live panel shows: total coins, coin budget remaining, Nigerian-item count, chemistry total, banned-types warning
4. Submit → existing `squad_submissions` + `squad_items` tables — `squad_items.fcdb_link_id` references the picked `fc26_players` row (schema already exists per migration `20260507000001_squad_items_fcdb_link.sql`)
5. Friday change window + deadline logic (Plan 10) unchanged

---

## 2. Success criteria

1. Player navigates to `/player/squad` → sees pitch layout with 11 starting slots in a 4-3-3 default formation (formation switcher: 4-3-3 / 4-4-2 / 4-2-3-1 / 3-5-2).
2. Each empty slot shows an "Add" button; clicking opens a typeahead search modal filtered by the slot's position (RB → defender/full-back cards).
3. Typing 2+ chars triggers `POST /api/fcdb/search` → fuzzy match via Plan 21 RPC → 10 results with rating/position/nation/club.
4. Selecting a card populates the slot with the FC-style card tile (rating colour-coded, photo, name, position, price).
5. "Live totals" bar always visible: `Coins: 6.3M / 10M · Nigerian: 2 · Chem: 97 · Banned: 0`.
6. "Clear slot" / "Swap" / "Change formation" don't discard other slots.
7. Submit button disabled until all 11 starting slots filled OR a skip-validation admin override flag is set (not for players).
8. On submit, server validates (Plan 10's `evaluateRules`) + inserts `squad_submissions` + 11 `squad_items` rows each carrying `fcdb_link_id`.

---

## 3. Architecture

### 3.1 Route
`apps/web/src/app/player/squad/page.tsx` — rewrite. Today it's a text-input form; new version mounts `<SquadPickerBuilder />`.

### 3.2 Server

- `apps/web/src/server/fcdb/search.ts` — already exists from Plan 21 (fuzzy match). Wrap in Zod schema + export `searchCards({ q, position?, limit })`.
- New route `apps/web/src/app/api/fcdb/search/route.ts` — POST handler, perm-gated to any authenticated user with role `player | admin | loc | referee`. Body `{ q: string, position?: string }` → 10 matches.
- `apps/web/src/server/squads/submit_picker.ts` — new helper. Accepts `{ slots: Array<{ slotId, fcdbPlayerId, positionInLineup }> }` + wraps existing `submit.ts` write.

### 3.3 Client components

- `apps/web/src/components/squads/SquadPickerBuilder.tsx` (client)
  - State: `formation: "433"|"442"|...`, `slots: Record<slotId, { fcdbPlayerId, cached card }>`, `subs: [...]`
  - Renders `<PitchLayout formation>`, `<SubsBench>`, `<LiveTotalsBar>`, `<SubmitSquadButton>`
- `apps/web/src/components/squads/CardSearchDialog.tsx` — modal w/ typeahead input + debounced fetch
- `apps/web/src/components/squads/FutCard.tsx` — canonical FC-style card tile (rating, photo, name, nation, club, position badge)
- `apps/web/src/components/squads/LiveTotalsBar.tsx` — reads from parent state; computes coins+Nigerian+chem+banned
- `apps/web/src/components/squads/PitchLayout.tsx` — SVG pitch + absolute-positioned slots per formation

### 3.4 Chemistry (simplified — Plan 30 scope)

FC26 chemistry rules are complex. Plan 30 uses a **simplified** version sufficient for validation:
- Each slot earns 1 point for each of { club, league, nation } that matches ≥ 2 other slots
- Total squad chemistry = sum across slots, capped at 100

This is not a perfect FC26 replica — it's "close enough to see if a squad is cohesive". Real FC26 chemistry depends on formation + position + loyalty + links. Plan 31 (future) can refine.

### 3.5 Prices

Read `fc26_players.price_coins` snapshot. Plan 24 (separate spec) keeps that column fresh via nightly scrape. If null, show "—" and skip the slot's cost in the total; warn in live totals.

---

## 4. Data model

No schema change beyond what Plan 21 + Plan 23 already shipped:
- `fc26_players` — card catalogue
- `squad_items.fcdb_link_id` — already the FK

Plan 30 only uses existing tables.

---

## 5. Tests

### Unit
- `fcdb/search.test.ts` — fuzzy RPC mock + position filter + limit
- `SquadPickerBuilder.test.tsx` (RTL) — slot fill, swap, clear, formation switch
- `live-totals.test.ts` — coins+Nigerian+chem+banned calc across several fixtures

### E2E
- `squad-picker.spec.ts` — player logs in → adds 11 cards → sees live totals → submits → submission row appears for ref review

---

## 6. Rollout + risks

- `fc26_players` may be empty in dev (Kaggle CSV placeholder). Picker degrades gracefully: typeahead shows "No matches — ask admin to import catalogue" when search returns 0 rows.
- Price snapshots are stale until Plan 24 ships. Admins can manually patch via SQL.
- Submitting with missing prices is allowed (validation flags it separately).
- Chemistry calc is a heuristic, not spec-perfect. Banner: "Chemistry is indicative; final verdict is the ref's."

## 7. Acceptance gate

- Unit tests green.
- E2E picker spec passes.
- Manual: player opens /player/squad, adds 11 cards from typeahead, submits, ref sees in /admin/squads.
