# Plan 23 — FCDB squad validation in the ref-review surface

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-22
**Status:** Active
**Depends on:** Plan 10 (squad submissions) shipped, Plan 21 (FC 26 player DB + lookup module) shipped.
**Feeds into:** future ref bulk-accept UX, public player-profile "verified items" badge (deferred).

---

## 1. Goal + Success Criteria

**Goal.** Wire the Plan 21 `server/fcdb` lookup into the existing
`/admin/squads/[id]` ref-review page so each hand-transcribed squad item is
cross-checked against the local `fc26_players` catalogue. The ref sees a
per-row badge (`✓ resolved`, `≈ fuzzy`, `⚠ pick` for ambiguous, `? unknown`)
and a header summary (`FCDB: 8 resolved · 2 fuzzy · 1 unknown`). For
`ambiguous` rows the ref can lock in one of the alternative candidates from
a dropdown; the choice is persisted on the item via a new
`resolved_fc_player_id` FK and audit-logged.

Plan 23 is **purely an enrichment layer.** Approve / reject authority stays
exactly where Plan 10 left it — the ref. FCDB never auto-rejects, never
blocks the existing approve / reject buttons, never overrides
`evaluateRules`.

**Success criteria (each demonstrable end-to-end before plan complete):**

1. With FCDB empty, `/admin/squads/[id]` renders the existing review page
   plus a single info banner: "FCDB empty — populate via
   `npm run fcdb:import` to enable per-item validation. Submission can
   still be reviewed manually." No badges, no errors, no perf regression.
2. With FCDB populated (or stubbed in tests), each item row shows a
   `<FcdbBadge>` matching the lookup status. The header shows the totals.
3. Clicking a `⚠ pick` badge opens a list of `alternatives`. Selecting one
   posts to a server action that updates
   `squad_player_items.resolved_fc_player_id` and audit-fires.
4. The page server-renders inside the existing 5s budget — i.e. the FCDB
   review pass is a single batched call sequence (no N+1 over network from
   the page).
5. Ref `approve` / `reject` actions still work end-to-end exactly as Plan
   10 ships them — FCDB enrichment is non-blocking.

---

## 2. Architecture

### 2.1 Where the validation runs

**Server component on render.** When the admin opens `/admin/squads/[id]`,
the page server component already calls `getSubmissionWithItems`. We add a
sibling call to a new `reviewSquadAgainstFCDB(sb, submissionId)` helper
that re-uses Plan 21's `validateSubmittedSquadAgainstFCDB`. Results are
passed as props into the items table render.

We deliberately **do not cache** in Plan 23 — FCDB is a static catalogue
between Kaggle imports and Postgres' own buffer cache absorbs the per-row
cost. If the per-page latency becomes a problem we add a per-submission
memo via React's built-in `cache()` in a follow-up. Caching is out of
scope here so behaviour stays trivially debuggable.

**Why not on-demand button click?** A click would force a full route
transition (server actions in Next 15 re-render the page), giving us the
same cost as render-time + the worse UX of "click, wait, look".

### 2.2 Data flow

```
admin opens /admin/squads/[id]
  └─ page server component
       ├─ getSubmissionWithItems(sb, id)         — Plan 10
       ├─ getRuleForSeason(sb, season)            — Plan 10
       ├─ evaluateRules(items, rule)              — Plan 10
       └─ reviewSquadAgainstFCDB(sb, id)          — Plan 23 (new)
            ├─ load squad_player_items
            └─ for each row: findPlayer(sb, ...)  — Plan 21
                  → SquadItemReview { itemId, status, candidate?, alternatives? }
       page renders items table; each <tr> shows <FcdbBadge>
                                                  + summary chip in header

ref clicks "lock in" on an ambiguous candidate
  └─ <FcdbBadge> client component opens dropdown
       └─ on select → POST to acceptFcdbCandidateAction(itemId, fcPlayerId)
            ├─ resolveActor + requirePermAsync(squads.validate)
            ├─ verify itemId belongs to a live submission
            ├─ verify fcPlayerId exists in fc26_players (deleted_at IS NULL)
            ├─ UPDATE squad_player_items
                 SET resolved_fc_player_id = $1
            └─ audit trigger fires (table already attach_audit'd)
       redirect back to /admin/squads/[id]
```

### 2.3 Status semantics

| Status      | Source                                                                 | Auto-action              | Ref UI                              |
|-------------|------------------------------------------------------------------------|--------------------------|-------------------------------------|
| `resolved`  | Plan 21 returns single hit, name ≥ 4, rating matches if provided       | none — informational     | green pill, click reveals candidate |
| `ambiguous` | Plan 21 returns ≥ 2 exact-slug hits (Plan 23 splits this from `fuzzy`) | none — ref must pick     | amber pill + dropdown of alternatives |
| `fuzzy`     | Plan 21 trigram path (single candidate carries `sim`)                  | none — ref must confirm  | blue pill, click reveals top match + sim |
| `unknown`   | Plan 21 returns empty                                                  | none — ref decides typo or unreleased item | grey pill |

Plan 21's `validateSubmittedSquadAgainstFCDB` collapses ambiguous + fuzzy
into a single `fuzzy` status. Plan 23's `reviewSquadAgainstFCDB` re-splits
them so the UI can render distinct affordances (pick-from-list vs.
inspect-fuzzy-match).

---

## 3. Module surface

### 3.1 `apps/web/src/server/squads/fcdb_review.ts` (new)

```ts
export type SquadItemReviewStatus =
  | "resolved" | "fuzzy" | "ambiguous" | "unknown";

export type SquadItemReview = {
  itemId: string;
  slotIndex: number;
  status: SquadItemReviewStatus;
  candidate?: FCPlayer;
  alternatives?: FCPlayer[];
  reason?: string;             // e.g. "FCDB empty — drop Kaggle CSV"
  similarity?: number;         // populated on fuzzy path
};

export type SquadFcdbReviewSummary = {
  total: number;
  resolved: number;
  fuzzy: number;
  ambiguous: number;
  unknown: number;
  fcdbEmpty: boolean;          // true when fc26_players has 0 live rows
};

export async function reviewSquadAgainstFCDB(
  sb: SupabaseClient,
  submissionId: string,
): Promise<{ items: SquadItemReview[]; summary: SquadFcdbReviewSummary }>;

export async function acceptFcdbCandidate(
  sb: SupabaseClient,
  actor: Actor,
  itemId: string,
  fcPlayerId: string,
): Promise<void>;
```

- `reviewSquadAgainstFCDB`: load `squad_player_items` for the submission
  (live rows only). Probe `fc26_players` for any live row; if 0 → set
  `fcdbEmpty = true` and return all items as `unknown` with reason
  `"FCDB not yet populated — drop Kaggle CSV"`. Otherwise call
  `findPlayer` per row, map to `SquadItemReview`, then re-classify
  multi-candidate exact-slug hits as `ambiguous` (vs. Plan 21's `fuzzy`).
- `acceptFcdbCandidate`: server-side perm check (`squads.validate`),
  validate FK targets exist, UPDATE.

### 3.2 `apps/web/src/components/squads/FcdbBadge.tsx` (new)

Client component (`"use client"`) — needs onClick state for the dropdown.

Props:
```ts
{ review: SquadItemReview; onPickAction: (fcPlayerId: string) => void }
```

States:
- `resolved` → green chip "✓ FCDB" — `<details>` reveals candidate metadata.
- `ambiguous` → amber chip "⚠ pick" — `<details>` reveals a `<form>` with
  `<select>` of `alternatives`, server-action submit calls
  `onPickAction`.
- `fuzzy` → blue chip "≈ fuzzy" — `<details>` reveals top candidate +
  `similarity %`.
- `unknown` → grey chip "?" — `<details>` reveals "no FCDB match —
  possible typo or unreleased item".

Bundle target: ≤ 5 KB JS gzipped (no external deps; pure Tailwind
classes; `<details>` element handles open/close natively).

### 3.3 `apps/web/src/app/admin/squads/[id]/page.tsx` (edit)

- Import `reviewSquadAgainstFCDB`.
- After `evaluateRules`, await the FCDB review.
- Render summary chip in `SectionHeader` action area (or a sub-header in
  the items section).
- Render `<FcdbBadge>` in a new column in the items table.
- Wrap each `<FcdbBadge>` `onPickAction` in a server action that calls
  `acceptFcdbCandidateAction(itemId, fcPlayerId)` from
  `./actions.ts`.
- If `summary.fcdbEmpty` → render the empty banner above the items table,
  skip the per-row badges (render a faint placeholder dash).

### 3.4 `apps/web/src/app/admin/squads/[id]/actions.ts` (edit)

Add:
```ts
export async function acceptFcdbCandidateAction(
  itemId: string,
  fcPlayerId: string,
): Promise<void>;
```
Resolves actor via existing `loadActor`, calls
`acceptFcdbCandidate(sb, actor, itemId, fcPlayerId)`, revalidates the
detail page.

---

## 4. Migration

`supabase/migrations/20260507000001_squad_items_fcdb_link.sql`:

```sql
-- Plan 23 — link a transcribed squad item to its FCDB resolution.
-- Nullable; ref sets via /admin/squads/[id] when locking in a pick.
-- ON DELETE SET NULL so a future FCDB re-import that drops a row doesn't
-- cascade-delete the squad item; squad data wins.
alter table public.squad_player_items
  add column resolved_fc_player_id uuid
    references public.fc26_players(id) on delete set null;

create index squad_player_items_resolved_fc_idx
  on public.squad_player_items (resolved_fc_player_id)
  where deleted_at is null and resolved_fc_player_id is not null;
```

Audit attachment: `squad_player_items` is already audit-triggered by
`20260428000103_squad_player_items.sql` (`select public.attach_audit(...)`).
The trigger fires on UPDATE without any extra wiring — Plan 0 audit
infrastructure spec §3.

---

## 5. Permissions

No new perms. `acceptFcdbCandidate` checks `squads.validate` (already
seeded for `loc`, `referee`, `admin`). FCDB read is unauthenticated /
service-side; no PII on `fc26_players` so no RLS.

---

## 6. Tests

### 6.1 Unit — `server/squads/fcdb_review.test.ts` (≥10 tests)

`reviewSquadAgainstFCDB`:
1. Empty FCDB (probe returns 0 rows) → all items `unknown` with reason.
2. Single resolved item — exact slug + matching rating → `resolved`,
   single `candidate`, no `alternatives`.
3. Ambiguous — multiple exact-slug hits → status `ambiguous`,
   `alternatives.length === N - 1`.
4. Fuzzy — single hit with `sim` defined → status `fuzzy`,
   `similarity === sim`.
5. Unknown — empty findPlayer result → `unknown`, no candidate.
6. Mixed squad of 4 items spanning all four statuses; preserves
   `slot_index` ordering.
7. Summary counts add up to `items.length`.
8. Item rows are loaded via `submission_id` filter + live filter.
9. Rejects on submission not found (FK) — bubbles error.

`acceptFcdbCandidate`:
10. Permission denied (no `squads.validate`) → throws.
11. Item not found → throws.
12. FCDB candidate not found → throws.
13. Happy path → UPDATE called with `{ resolved_fc_player_id }`.

### 6.2 E2E — `tests/e2e/squad-fcdb-review.spec.ts`

Self-cleaning, FCDB-population-tolerant (skips the lock-in assertion when
FCDB is empty):

1. Seed throwaway submission with 3 items: 1 obvious-typo name, 1 short
   name, 1 plausible.
2. Visit `/admin/squads/<id>`.
3. Assert either the empty-FCDB banner (when `fc26_players` has 0 live
   rows) **or** the summary chip (when populated).
4. When populated, find any `data-testid="fcdb-badge-*"` and assert at
   least one rendered. If any badge is `ambiguous`, click → select first
   alternative → submit → reload → assert
   `squad_player_items.resolved_fc_player_id` is set in DB.
5. Hard-cleanup throwaway rows.

E2E is one spec (parent's "1 E2E" requirement met).

### 6.3 Verification matrix (CLAUDE.md §11)

- `npm run lint` clean.
- `npm run test` — all unit suites green; ≥ 10 new tests in
  `fcdb_review.test.ts`.
- Skip `npm run build` while dev server live — bundle size verified by
  static inspection of the new `FcdbBadge.tsx` (≤ 5 KB gzipped target;
  pure Tailwind + `<details>` keeps it ~1-2 KB).
- `npm --workspace apps/web run e2e -- squad-fcdb-review.spec.ts` —
  passes against cloud (empty or populated FCDB).
- `npm run db:push` — migration applied; verify column exists via
  `supabase db query`.
- Manual: visit `/admin/squads/<a-real-pending-submission>` after dev
  server reload, screenshot in plan review.

---

## 7. Numbered tasks

1. Spec + `tasks/todo.md` (this file).
2. Migration `20260507000001_squad_items_fcdb_link.sql`. `npm run db:push`.
   Verify column + index via `supabase db query`.
3. Server module: `server/squads/fcdb_review.ts` + `fcdb_review.test.ts`
   TDD-style. ≥10 unit tests green.
4. Re-export `reviewSquadAgainstFCDB`, `acceptFcdbCandidate`, types from
   `server/squads/index.ts`.
5. Client component: `components/squads/FcdbBadge.tsx`.
6. Wire `app/admin/squads/[id]/page.tsx` — call review, render summary +
   per-row badges.
7. Add `acceptFcdbCandidateAction` to `app/admin/squads/[id]/actions.ts`.
8. E2E `tests/e2e/squad-fcdb-review.spec.ts`.
9. Verification gate: lint + test (focused on changed paths) + targeted
   E2E + dev-server smoke (`curl /admin/squads/<id>` after login,
   inspect HTML for badge markers + dev log scan for runtime errors).
10. Commit per slice (migration → server → UI → e2e), push via PAT URL.

---

## 8. Verification gate

Before marking Plan 23 done:
1. `npm run lint` clean.
2. `npm run test` — full suite green; new unit tests in
   `fcdb_review.test.ts` ≥ 10.
3. `npm --workspace apps/web run e2e -- tests/e2e/squad-fcdb-review.spec.ts`
   green (skips lock-in assertion when FCDB empty).
4. `npm run db:push` — migration applied.
5. Dev-server smoke: hit `/admin/squads/<a-real-pending-submission-id>`
   via curl/browser, confirm 200 + page contains the FCDB banner or
   summary chip + at least one `data-testid="fcdb-badge-…"` element when
   FCDB is non-empty.
6. Dev log scan: `tail` the live dev log over the smoke window; zero
   `Error:` / `TypeError` entries from squad routes.

If any gate fails, plan stays open. No "complete with caveats."

---

## 9. Risks

- **FCDB empty in cloud.** Until the user drops the Kaggle CSV at
  `KNOWLEDGE/extracted/fc26_players_kaggle.csv` and runs
  `npm run fcdb:import`, every badge is `unknown`. Mitigation: dedicated
  banner copy + tests cover both empty and populated paths.
- **Per-page latency.** Up to 23 sequential `findPlayer` calls. Each is a
  slug-eq read on an indexed column — < 5 ms in Postgres. Total budget
  ~150 ms; acceptable. If we exceed budget in production, add a
  per-submission memo via React `cache()` in follow-up.
- **Ambiguous false positives.** Two FCDB rows with the same slug are
  rare but happen for icons + base versions of the same player. UI shows
  both with rating + item_type so the ref can disambiguate.
- **Nation-flag normalization.** Submitters type `NG`, `NGA`, or 🇳🇬.
  `findPlayer` ignores `nationality_flag`; only `name` + `rating` +
  `position` + `club` feed into the lookup. Out of scope here; future
  enhancement.
- **FCDB drift between snapshots.** `findPlayer` already tolerates ±1
  rating drift (Plan 21 §5). No additional Plan 23 mitigation needed.
- **Dev-server churn.** Per CLAUDE.md, never `next build` while dev
  server is alive (lesson 7). Verification uses `npm run test` +
  targeted E2E only.

---

## 10. Out of scope

- Auto-reject submissions when all items `unknown` (refs always decide).
- Bulk-accept "accept all resolved" button (future enhancement).
- Public "verified items" badge on `/players/[id]` (deferred — Plan 23
  only writes to `resolved_fc_player_id`; downstream consumers later).
- Editing the FCDB candidate from the ref UI (refs can only pick from
  `alternatives` returned by `findPlayer`; full search is a future
  feature).
- Touching `/overlay/player-card` or `/players/[id]` (Plan 22 territory).
- Caching layer (kept simple; revisit only on measured regression).
- Real-time updates (page is server-rendered; ref reloads to see new
  picks).
