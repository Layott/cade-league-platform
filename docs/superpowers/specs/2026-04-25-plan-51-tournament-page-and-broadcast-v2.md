# Plan 51 — Tournament Management page + Broadcast v2 page

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-25
**Supersedes:** ad-hoc admin score-entry surfaces; existing `/admin/broadcast/[sessionId]` to be retained alongside until swap-cutover.
**Phase:** Plan 51 — top-priority "must work no matter what" surfaces (per user mandate 2026-04-25).
**Migration claim block:** `20260525000001..` (this plan owns `20260525000001`, `..02`, `..03`).

---

## 1. Goals + Non-goals

### 1.1 Goals

1. Ship `/admin/tournament` — the single canonical league control surface for the Elite season. Eight tabbed sections (Standings, Fixtures, Results Entry, Walkovers, Adjustments, Tiebreaker Config, H2H Lookup, Win-Prob Preview). Admin-only.
2. Ship `/admin/broadcast/v2/[sessionId]` — fresh broadcast control panel built on the corrected v2 mockups (17 overlays). Lives ALONGSIDE the legacy `/admin/broadcast/[sessionId]` until user-driven swap. No data migration; both surfaces hit the same `broadcast_sessions` rows.
3. Ship 17 overlay routes at `/overlay/v2/<key>` (animated-bg variants are meta-overlays, NOT in the 17). Each route ports the corresponding `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html` into a Next.js client component, wired to live data via Realtime channels reused from prior slices.
4. Mirror the xlsx Strength formula in `computeWinProbability` so H2H, Season form, and Last-5 are blended (weights 0.4 / 0.4 / 0.2). Surface this on the Tournament page (Win-Prob Preview tab) and on the H2H broadcast overlays.
5. Add per-match-day `leaderboard_snapshots` so the animated-leaderboard overlay can replay "delta from last match-day" with arrow indicators.
6. Wire walkovers fully: admin can trigger directly (3:0 default to a chosen winner) or confirm a ref's pending absent-mark walkover. GF from a walkover counts toward Top-Scorers (per Q6 lock).
7. Drag-rank tiebreaker config persists on `seasons.tiebreaker_order` JSONB; default = `["totalPts","gd","gf","name"]`. UI lets admin reorder + reset.
8. Downloadable leaderboard + metrics as XLSX + DOCX via `/api/tournament/export?type=&format=`.
9. Realtime updates use the EXISTING `public:standings:<seasonId>` channel; new event names (`score.changed`, `match.ended`, `walkover.confirmed`, `snapshot.captured`) ride on it. No new channels.
10. All seven new perms seeded into `role_permissions` (admin gets all; loc/idc/technical read+export; referee mark-pending only; production+design broadcast.v2 read+trigger).

### 1.2 Non-goals

- No multi-season tournament UI. Elite 2025-2026 only.
- No automated walkover trigger (no cron job). Pending walkovers always require an admin click to confirm.
- No prize disbursement, no payment flows.
- No coach-intros data wiring beyond placeholder render (Coaches overlay remains a static placeholder fed from `players.coach_id`).
- No mobile broadcast control panel — desktop only.
- No removal of legacy `/admin/broadcast/[sessionId]` in this plan. Cutover decision deferred.
- No new Realtime channels. Reuse `public:standings:<seasonId>` exclusively.
- No multi-stream support — single broadcast session at a time as before.
- No goal_events score-entry hookup (Slice 1 audit deferred this; top-scorers reader still falls back to `player_match_stats.goals`).
- No screenshot OCR per-goal attribution (Plan 14 already shipped match-level OCR; per-goal ladder is out of scope here).

---

## 2. Locked decisions (60+ items from 2026-04-25 Q&A)

Authoritative answers. Anything contradicting these requires user approval to change.

| # | Topic | Lock |
|---|---|---|
| 1 | Tournament scope | Elite League ONLY (13 players, single round-robin, 78 matches, 8 match-days) |
| 2 | Walkover trigger | Ref-absent → pending; admin confirms on tournament page. Admin can also pick directly. |
| 3 | Walkover default score | **3:0** to declared winner |
| 4 | Walkover home/away | NONE — UI shows player names only ("FARUK", "ANIFE"); DB columns stay `home_player_id` / `away_player_id` for back-compat |
| 5 | Walkover GF in Top-Scorers | YES — counts toward winner's GF (per Q6 lock) |
| 6 | Adjustments | Same as existing `/admin/punishments` (canonical) — Tournament page LINKS, doesn't duplicate |
| 7 | Tiebreaker order default | `["totalPts","gd","gf","name"]` (drag-rank custom in UI) |
| 8 | Tiebreaker storage | `seasons.tiebreaker_order` JSONB |
| 9 | Win-prob formula | Mirror xlsx Strength: `Strength = 0.4·H2H + 0.4·Season + 0.2·Last5` |
| 10 | Win-prob surfaces | Tournament page (Win-Prob Preview tab) + H2H overlays (2/3/5) |
| 11 | Score canonical entry | Admin Tournament page primary; ref attendance auto-syncs both ways |
| 12 | Per-player stats granularity | Match-level totals only (e.g., "FARUK 5-3 ANIFE" → Faruk 5 GF) |
| 13 | Match-day batch | One-at-a-time as games end |
| 14 | Form / Last-5 visibility | NOT visible on standings page; used internally for win-prob math only |
| 15 | Preview tile | Bug-free best implementation; lazy-mount via IntersectionObserver |
| 16 | Existing overlays NOT in 17 | scorebar / stingers / PIPs / casters-chat / featured-comment — DROPPED from v2 control panel |
| 17 | Universal motion contract | Each overlay dictates own enter/exit; AnimatePresence at route-group level |
| 18 | Audio | All 17 silent by default |
| 19 | Brand fidelity | v2 mockups = starting inspiration, code is canonical |
| 20 | BRB upcoming-matches strip | Continuous loop + partner strip |
| 21 | Timer input | min:sec + end-clock both, no sound, lower-third strip |
| 22 | Animated BG variant | **v3** spotlights (locked per user 2026-04-25) |
| 23 | H2H 2 stats subset | Position, P, W-D-L, GF, GA, GD, Pts, Win Prob % |
| 24 | H2H 3 stats subset | Same as H2H 2 |
| 25 | H2H 5 stats subset | Same as H2H 2 with smaller images |
| 26 | Animated leaderboard snapshot scope | Per match-day |
| 27 | Animated leaderboard motion | 10s anim total, 500ms stagger, "↑N/↓N" arrows w/ numbers |
| 28 | Lower-third broadcast control | Library presets + 3 simultaneous slots, presets-saveable via localStorage `cade-lt-presets` |
| 29 | Secondary score bug | One game at a time, stay until OFF |
| 30 | Up-next bug | Admin manual trigger (fixture dropdown picker), stay until OFF |
| 31 | Match-scores-day | Vertical list, finished + TBD; 12-match 2-col grid; TBD pulse-breathe |
| 32 | Starting-soon | Brand + partner strip + continuous animation, NO countdown |
| 33 | Stream-ended | Brand + partner strip |
| 34 | Top-10 goal scorers | Use match GF totals (OCR scaffold for later but not wired here) |
| 35 | Orgs | 8-13 cards, big org logo + player headshots underneath; Mr Oga = placeholder card |
| 36 | Coach intros | Grid all-at-once, no player stats, just org logo + player face |
| 37 | Player penalties overlay | Current `disciplinary_actions` rows only, only ones with penalties |
| 38 | Cutover order | Broadcast v2 ship same time as Tournament page |
| 39 | Old vs new broadcast | New at `/admin/broadcast/v2/[sessionId]` while old stays. Swap when approved. |
| 40 | Component reuse strategy | Extract hardened logic (lazy-mount, OFF-routing, clear-action) + fresh visual shells |
| 41 | Home/away naming | DB unchanged; UI player-name labels only |
| 42 | Per-player goals | Match GF = player's goals scored |
| 43 | Partner strip order | GameEvo · Gamepride · ESPORTS AFRICA NEWS · TRACE |
| 44 | CADE Esports + Pro League placement | Top of every overlay, special placement (NOT in partner strip) |
| 45 | Tournament page access | Admin + LOC/IDC/Technical (read + export) — no player view |
| 46 | Score-bug team logos | NO — players-only, no team/org logos in score-bug |
| 47 | Up-next trigger | Admin picks from fixture dropdown |
| 48 | TRACE logo file | `TRACE_2010_logo.svg.png` |
| 49 | GameEvo + ESPORTS AFRICA NEWS variant | White (on dark BG) |
| 50 | Top logo placement | Mostly top-center, prominent |
| 51 | Halftone BG style | v3 (spotlights) |
| 52 | Card frame style | Angled-corner-cut rectangles, bright green outline, dark inner |
| 53 | Position-change stagger | 500ms |
| 54 | Position-change arrows | With numbers (e.g., "↑2") |
| 55 | Sanctions column content | Abbreviation like "-3pts" |
| 56 | H2H 2-player layout | Bust photos far edges, stats centered column, names huge labels behind, org logos small |
| 57 | H2H 3 + 5 layout | Agent's choice, balance density |
| 58 | Top scorers theme | Green w/ gold elements on #1 only. Podium shape OK |
| 59 | Orgs structure | Card per org: big logo + player headshots underneath |
| 60 | Coach intros theme | Halftone BG + framed cards + top logos + partner strip |
| 61 | Match-scores-day TBD anim | Pulsing breathe |
| 62 | Rebuild cadence | Pilot first → parallel rollout |
| 63 | Player photo variants | Headshot for small, fullbody for hero |
| 64 | Halftone BG asset | Animated version of `KNOWLEDGE/brand-assets/designsample/ELITE S2 BG.png` mandatory background |
| 65 | Anife photo | Use `_02..._05` variants ONLY (no `_01` exists) |
| 66 | Mr Oga org card | Placeholder until real org submitted |
| 67 | Snapshot uniqueness | One snapshot per match_day_id (UNIQUE constraint) |
| 68 | Walkover idempotent | Re-trigger same winner = no-op; switching winner replaces |
| 69 | Win-prob preview view | Calculator-style: pick A + B from 13-player dropdown, render % triple (pA / pDraw / pB) |
| 70 | Exports admin-only? | NO — LOC/IDC/Technical also get `tournament.export` |

---

## 3. Migrations (claim block `20260525000001..`)

### 3.1 `20260525000001_plan51_tournament_columns.sql`

```sql
-- seasons: drag-rank tiebreaker order
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS tiebreaker_order JSONB
    NOT NULL DEFAULT '["totalPts","gd","gf","name"]'::jsonb;

-- match_results: walkover columns
ALTER TABLE match_results
  ADD COLUMN IF NOT EXISTS is_walkover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS walkover_initiated_by TEXT
    CHECK (walkover_initiated_by IN ('admin','ref')),
  ADD COLUMN IF NOT EXISTS walkover_pending BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS walkover_confirmed_at TIMESTAMPTZ;

-- guard: pending only valid when is_walkover is true
ALTER TABLE match_results
  ADD CONSTRAINT match_results_walkover_pending_chk
  CHECK (NOT walkover_pending OR is_walkover);

-- audit attaches if not already
SELECT public.attach_audit('match_results');
SELECT public.attach_audit('seasons');
```

### 3.2 `20260525000002_plan51_leaderboard_snapshots.sql`

```sql
CREATE TABLE leaderboard_snapshots (
  id BIGSERIAL PRIMARY KEY,
  match_day_id INT UNIQUE NOT NULL REFERENCES match_days(id),
  snapshot_data JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- append-only: block UPDATE + DELETE
CREATE OR REPLACE FUNCTION leaderboard_snapshots_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'leaderboard_snapshots is append-only';
END $$;

CREATE TRIGGER leaderboard_snapshots_no_update
  BEFORE UPDATE ON leaderboard_snapshots
  FOR EACH ROW EXECUTE FUNCTION leaderboard_snapshots_block_mutation();

CREATE TRIGGER leaderboard_snapshots_no_delete
  BEFORE DELETE ON leaderboard_snapshots
  FOR EACH ROW EXECUTE FUNCTION leaderboard_snapshots_block_mutation();

CREATE INDEX leaderboard_snapshots_match_day_idx
  ON leaderboard_snapshots(match_day_id);

SELECT public.attach_audit('leaderboard_snapshots');
```

### 3.3 `20260525000003_plan51_broadcast_v2_perms.sql`

```sql
-- 7 new perm scopes
INSERT INTO permissions (scope, description) VALUES
  ('tournament.read',            'View Tournament Management page'),
  ('tournament.score_entry',     'Enter / edit live match scores'),
  ('tournament.walkover_confirm','Confirm or trigger walkover (admin path)'),
  ('tournament.tiebreaker_config','Edit drag-rank tiebreaker order'),
  ('tournament.export',          'Download leaderboard + metrics XLSX/DOCX'),
  ('broadcast.v2.read',          'View Broadcast v2 control panel'),
  ('broadcast.v2.trigger',       'Trigger overlay enter/exit on Broadcast v2')
ON CONFLICT (scope) DO NOTHING;

-- role_permissions assignments
-- admin: all 7
INSERT INTO role_permissions(role, scope) VALUES
  ('admin','tournament.read'),
  ('admin','tournament.score_entry'),
  ('admin','tournament.walkover_confirm'),
  ('admin','tournament.tiebreaker_config'),
  ('admin','tournament.export'),
  ('admin','broadcast.v2.read'),
  ('admin','broadcast.v2.trigger')
ON CONFLICT DO NOTHING;

-- loc / idc / technical: read + export
INSERT INTO role_permissions(role, scope)
SELECT r, s FROM
  (VALUES ('loc'),('idc'),('technical')) AS roles(r),
  (VALUES ('tournament.read'),('tournament.export')) AS scopes(s)
ON CONFLICT DO NOTHING;

-- referee: walkover_confirm (mark-pending only — server enforces ref can only mark, not confirm)
INSERT INTO role_permissions(role, scope) VALUES
  ('referee','tournament.walkover_confirm')
ON CONFLICT DO NOTHING;

-- production + design: broadcast.v2 read + trigger
INSERT INTO role_permissions(role, scope)
SELECT r, s FROM
  (VALUES ('production'),('design')) AS roles(r),
  (VALUES ('broadcast.v2.read'),('broadcast.v2.trigger')) AS scopes(s)
ON CONFLICT DO NOTHING;
```

`apps/web/src/perms.ts` updated to mirror this seed. `perms.seed.test.ts` extended with 12-row contract assertions per scope×role.

---

## 4. Server module API signatures

All modules: `"use server"` files export ONLY async functions; sync helpers/types live in sibling `schemas.ts`. Unit tests mock the Supabase client. Each module ≥10 unit tests.

### 4.1 `apps/web/src/server/standings/win_probability.ts`

```ts
"use server";

export type PlayerStats = {
  playerId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  last5Form: number; // sum of points over last 5 matches (max 15)
  pointsTotal: number;
};

export type H2HRow = {
  playerAId: string;
  playerBId: string;
  aWins: number;
  draws: number;
  bWins: number;
};

export type WinProbResult = {
  pA: number;     // 0..1
  pDraw: number;  // 0..1
  pB: number;     // 0..1
};

export async function computeWinProbability(
  playerA: PlayerStats,
  playerB: PlayerStats,
  h2hRecord?: H2HRow,
): Promise<WinProbResult>;
```

Algorithm (mirrors xlsx Strength formula):

```
strength(p) = 0.4 * h2hScore(p, opponent) + 0.4 * seasonScore(p) + 0.2 * last5Score(p)
where:
  h2hScore = (myWinsVsOpp + 0.5*draws) / max(1, totalH2HMatches)
  seasonScore = pointsTotal / max(1, played * 3)  // normalized to 0..1
  last5Score = last5Form / 15

raw_pA = strength(A) / (strength(A) + strength(B))
raw_pB = 1 - raw_pA
pDraw = clamp(0.18 - 0.2 * abs(raw_pA - 0.5), 0.10, 0.28)  // tighter draws when teams unbalanced
pA = (1 - pDraw) * raw_pA
pB = (1 - pDraw) * raw_pB
return { pA, pDraw, pB }
```

If `h2hRecord` undefined → `h2hScore(p) = 0.5` (neutral). If neither A nor B has played any matches → all three return 1/3.

### 4.2 `apps/web/src/server/standings/tiebreakers.ts`

```ts
"use server";

export type StandingsRow = {
  playerId: string;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  totalPts: number;
};

export type TiebreakerKey = 'totalPts' | 'gd' | 'gf' | 'name' | 'wins' | 'h2h';

export async function applyTiebreakers(
  rows: StandingsRow[],
  order: TiebreakerKey[],
): Promise<StandingsRow[]>;
```

Stable sort. Numeric keys descending; `name` ascending. `h2h` is a placeholder (not implemented in v1; falls back to `totalPts`). If `order` empty → fall back to default `["totalPts","gd","gf","name"]`.

### 4.3 `apps/web/src/server/standings/snapshots.ts`

```ts
"use server";

import { SupabaseClient } from '@supabase/supabase-js';

export type SnapshotRow = {
  id: number;
  matchDayId: number;
  snapshotData: StandingsRow[];
  capturedAt: string;
};

export async function captureSnapshot(
  matchDayId: number,
  supabase: SupabaseClient,
): Promise<SnapshotRow>;

export async function readSnapshot(
  matchDayId: number,
  supabase: SupabaseClient,
): Promise<SnapshotRow | null>;

export async function readPreviousSnapshot(
  currentMatchDayId: number,
  supabase: SupabaseClient,
): Promise<SnapshotRow | null>;
```

Idempotent on `(match_day_id)` UNIQUE — re-call replaces the in-memory copy returned, but the DB throws on duplicate insert (caller catches + treats as no-op via `ON CONFLICT DO NOTHING` semantics in the SQL; module re-reads existing row).

### 4.4 `apps/web/src/server/walkovers/index.ts`

```ts
"use server";

import { SupabaseClient } from '@supabase/supabase-js';

export async function triggerAdminWalkover(
  matchId: string,
  winnerId: string,
  supabase: SupabaseClient,
): Promise<{ matchId: string; isWalkover: true; winnerId: string }>;

export async function markRefPendingWalkover(
  matchId: string,
  absentPlayerId: string,
  supabase: SupabaseClient,
): Promise<{ matchId: string; pending: true; winnerId: string }>;

export async function confirmRefPendingWalkover(
  matchId: string,
  supabase: SupabaseClient,
): Promise<{ matchId: string; isWalkover: true; pendingResolved: true }>;

export async function undoWalkover(
  matchId: string,
  supabase: SupabaseClient,
): Promise<{ matchId: string; isWalkover: false }>;
```

All set `is_walkover = true`, score = 3:0 to winner, GF counts toward Top-Scorers. `markRefPendingWalkover` sets `walkover_pending = true` + `walkover_initiated_by = 'ref'`. `confirmRefPendingWalkover` flips pending → false + sets `walkover_confirmed_at = now()`. `undoWalkover` clears all four columns + `result_type = 'pending'`. Each call triggers full standings recompute via existing `recompute_standings(season_id)`.

### 4.5 Export modules

```ts
// apps/web/src/server/exports/leaderboard_xlsx.ts
"use server";
export async function generateLeaderboardXLSX(
  seasonId: string,
  supabase: SupabaseClient,
): Promise<Buffer>;

// apps/web/src/server/exports/leaderboard_docx.ts
"use server";
export async function generateLeaderboardDOCX(
  seasonId: string,
  supabase: SupabaseClient,
): Promise<Buffer>;

// apps/web/src/server/exports/metrics_xlsx.ts
"use server";
export async function generateMetricsXLSX(
  seasonId: string,
  supabase: SupabaseClient,
): Promise<Buffer>;
```

`leaderboard_xlsx`: 1 sheet, columns Pos / Player / P / W / D / L / GF / GA / GD / Pts / SanctionsAdj. Uses `xlsx` npm package.

`leaderboard_docx`: portrait A4 doc, header logo + season label, table identical to xlsx. Uses `docx` npm package.

`metrics_xlsx`: multi-sheet workbook — Sheet 1 Standings, Sheet 2 Top-Scorers (player × goals), Sheet 3 H2H matrix (13×13 grid of points won), Sheet 4 Sanctions (joined to disciplinary_actions). Uses `xlsx`.

### 4.6 Broadcast v2 hardened-logic extraction

```ts
// apps/web/src/server/broadcast/v2/lazy_mount.ts
"use server";
export async function shouldMountIframe(
  isVisible: boolean,
  hasMounted: boolean,
): Promise<boolean>;

// apps/web/src/server/broadcast/v2/off_routing.ts
"use server";
export async function resolveOffTarget(
  overlayKey: string,
): Promise<{ table: 'overlay_events' | 'overlay_active_instances'; multiInstance: boolean }>;
// Single source of truth for which OFF path each overlay uses.
// MULTI_INSTANCE_KEYS = ['lower_third'] only (per Plan 50 fix).

// apps/web/src/server/broadcast/v2/clear_action.ts
"use server";
export async function clearOverlayInstance(
  sessionId: string,
  overlayKey: string,
  instanceId: string | null,
  supabase: SupabaseClient,
): Promise<{ cleared: number }>;
```

Existing logic at `apps/web/src/components/admin/broadcast/OverlayMiniPreview.tsx`, `OffTriggerButton.tsx`, `clearInstanceAction.ts` is REFACTORED to call these new server modules. Legacy `/admin/broadcast/[sessionId]` continues to work because the components use the same util.

### 4.7 Realtime publishers

```ts
// apps/web/src/server/realtime/publishers/score_changed.ts
export async function publishScoreChanged(
  seasonId: string, matchId: string, supabase: SupabaseClient
): Promise<void>;

// apps/web/src/server/realtime/publishers/standings_recomputed.ts
export async function publishStandingsRecomputed(
  seasonId: string, supabase: SupabaseClient
): Promise<void>;

// apps/web/src/server/realtime/publishers/match_ended.ts
export async function publishMatchEnded(
  seasonId: string, matchId: string, supabase: SupabaseClient
): Promise<void>;

// apps/web/src/server/realtime/publishers/walkover_confirmed.ts
export async function publishWalkoverConfirmed(
  seasonId: string, matchId: string, supabase: SupabaseClient
): Promise<void>;

// apps/web/src/server/realtime/publishers/snapshot_captured.ts
export async function publishSnapshotCaptured(
  seasonId: string, matchDayId: number, supabase: SupabaseClient
): Promise<void>;
```

All five publish on `public:standings:<seasonId>`. Wired into `match_results` upsert path (score_changed + match_ended), `recompute_standings` (standings_recomputed), `walkovers/index.ts` (walkover_confirmed), `snapshots.ts` (snapshot_captured).

---

## 5. Routes + nav

### 5.1 New routes

| Route | Method | Auth | Description |
|---|---|---|---|
| `/admin/tournament` | GET | `tournament.read` | Tabbed UI (8 sections) |
| `/api/tournament/export` | GET | `tournament.export` | Query: `?type=leaderboard\|metrics&format=xlsx\|docx` |
| `/admin/broadcast/v2/[sessionId]` | GET | `broadcast.v2.read` | New control panel — 17 cards |
| `/api/broadcast/v2/sessions/[id]/<key>` | GET | view_token-gated | 17 endpoints, one per overlay key |
| `/overlay/v2/<key>` | GET | public (v2 token) | 17 overlay browser-source routes |

### 5.2 Site Manager hub additions

`/admin/page.tsx` 18-tile grid gets two new tiles:
- **Tournament** — `/admin/tournament` (perm `tournament.read`)
- **Broadcast v2** — `/admin/broadcast/v2/<latest_or_create_new>` (perm `broadcast.v2.read`)

Tile icons: SVG inline (trophy + waveform).

### 5.3 `AdminSubnav.tsx`

Tabs array gets new entry: `{ key: 'tournament', label: 'Tournament', href: '/admin/tournament', perm: 'tournament.read' }`. `admin/layout.tsx` `TAB_PERMS` mirrors.

### 5.4 `middleware.ts`

Matcher extended:
```
/admin/tournament/(.*)
/admin/broadcast/v2/(.*)
/api/tournament/(.*)
/api/broadcast/v2/(.*)
/overlay/v2/(.*)
```

---

## 6. Realtime channels + events

REUSE `public:standings:<seasonId>` from prior Slice 1 audit (commit `7019349`). NO new channels.

Event taxonomy on that single channel:

| Event name | Producer | Payload | Consumers |
|---|---|---|---|
| `standings.changed` | `recompute_standings()` (DB trigger) | `{ seasonId }` | leaderboard overlay, tournament page Standings tab |
| `score.changed` | `match_results` upsert | `{ seasonId, matchId, homeScore, awayScore }` | score-bug overlay, match-scores-day overlay, tournament page Results Entry tab |
| `match.ended` | `match_results` upsert when `result_type='final'` | `{ seasonId, matchId }` | top-scorers overlay, animated leaderboard (trigger snapshot) |
| `walkover.confirmed` | `confirmRefPendingWalkover` + `triggerAdminWalkover` | `{ seasonId, matchId, winnerId }` | tournament page Walkovers tab |
| `snapshot.captured` | `captureSnapshot` | `{ seasonId, matchDayId, snapshotId }` | animated leaderboard overlay |

Subscribers use existing `useDataFeed` hook from Slice 1 with multi-event filter.

---

## 7. Permissions table

Full grid: 7 new perms × 12 roles. `Y` = granted, `-` = denied.

| Perm \ Role | admin | loc | idc | referee | technical | production | design | moderator | coach | team_manager | player | viewer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `tournament.read` | Y | Y | Y | - | Y | - | - | - | - | - | - | - |
| `tournament.score_entry` | Y | - | - | - | - | - | - | - | - | - | - | - |
| `tournament.walkover_confirm` | Y | - | - | Y | - | - | - | - | - | - | - | - |
| `tournament.tiebreaker_config` | Y | - | - | - | - | - | - | - | - | - | - | - |
| `tournament.export` | Y | Y | Y | - | Y | - | - | - | - | - | - | - |
| `broadcast.v2.read` | Y | - | - | - | - | Y | Y | - | - | - | - | - |
| `broadcast.v2.trigger` | Y | - | - | - | - | Y | Y | - | - | - | - | - |

Server enforcement note: referee with `tournament.walkover_confirm` can only call `markRefPendingWalkover` (mark-pending), NOT `confirmRefPendingWalkover` or `triggerAdminWalkover`. Server code checks role explicitly at call site (in addition to perm gate).

---

## 8. Page UI structure

### 8.1 `/admin/tournament` — 8 tabs

Layout: page-level tab strip (sticky, `position: sticky; top: 0`) above active tab content. Use `framer-motion` `<AnimatePresence>` for tab fade. Default tab = Standings.

| Tab | Content |
|---|---|
| **Standings** | 13-row table (`<StandingsTable>`). Live-refreshes on `standings.changed`. Position-change arrows w/ numbers (e.g., "↑2") shown for 5s after recompute. Per-row sanction badges (e.g., "-3pts"). |
| **Fixtures** | Read-only list. 78 fixtures grouped by 8 match-days. Each row: date, players, score (or "—" if not played), walkover badge, dispute badge. Click row → detail panel right-side. |
| **Results Entry** | Form: pick fixture → enter homeScore + awayScore → Submit. Optimistic UI updates standings widget below. Server Action `recordMatchScore` calls `match_results` upsert + publishes `score.changed` + `match.ended` (if final). |
| **Walkovers** | Two lists: (1) Pending walkovers (from ref's mark) — admin clicks Confirm or Reject. (2) Active walkovers — admin can Undo. New Walkover button: pick fixture + pick winner → confirm modal → triggers `triggerAdminWalkover`. |
| **Adjustments** | Single CTA: "Open Punishments →" linking to `/admin/punishments`. Below: read-only summary widget showing 5 most recent punishments. |
| **Tiebreaker Config** | Drag-rank UI (using `dnd-kit` or native HTML5 drag). 4 chips: TotalPts / GD / GF / Name. Reorder + Save → upserts `seasons.tiebreaker_order`. Reset button → restores default. |
| **H2H Lookup** | 2-5 player picker (multi-select dropdown). Renders comparison grid (positions, P, W-D-L, GF, GA, GD, Pts, Win Prob %). Win Prob row uses `computeWinProbability`. |
| **Win-Prob Preview** | Calculator: pick A + B → render % triple (pA / pDraw / pB) + bar visualization. |

### 8.2 `/admin/broadcast/v2/[sessionId]` — 17 control cards

Layout: 17 cards in a responsive grid (3-up on wide, 2-up on medium, 1-up on narrow). Each card:

```
┌─────────────────────────────────────┐
│ [scaled iframe preview ~25% size]   │
│                                     │
├─────────────────────────────────────┤
│ <Overlay Key Label>                 │
│ [ENTER] [OUT]                       │
│ <inline edit fields per overlay>    │
└─────────────────────────────────────┘
```

Lazy-mount: iframe injected only after card scrolls into viewport (IntersectionObserver via `shouldMountIframe`). `content-visibility: auto` on outer card.

Per-overlay edit panels:
- BRB / Starting-soon / Stream-ended — no edits, ENTER/OUT only.
- Timer — input min:sec OR end-clock toggle.
- H2H 2/3/5 — `editable: 'h2hPicker'`, N selects.
- Leaderboard — no edits (live data only).
- Lower-third — 3 simultaneous slot editors + "Save preset" + "Load preset" (localStorage `cade-lt-presets`).
- Score-bug — player + score editable.
- Up-next — fixture dropdown picker.
- Match-scores-day — `editable: 'matchScoresDay'` + 3-part split toggle.
- Top-scorers — no edits.
- Orgs — no edits.
- Coaches — no edits (placeholder).
- Penalties — no edits.

OFF button routes through `resolveOffTarget` — single instance for 16, multi-instance only for `lower_third`.

---

## 9. 17 overlay route map

**Architecture decision (locked 2026-04-25): HTML files are the source-of-truth. Designers iterate by editing the HTML directly; the live overlay routes pick up changes without code rebuilds.**

Mechanism:
1. **Sync script** at `apps/web/scripts/sync-v2-overlays.mjs` mirrors `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html` → `apps/web/public/overlays/v2/<key>/index.html` on dev-server start + on file change (chokidar watch). Also mirrors fonts/logos/players that v2 HTML references via `../../../` relative paths so the public copy resolves correctly. Optionally rewrites paths to absolute `/_next/...` or kept-relative pointing into the same public mirror.
2. **Next.js route** at `apps/web/src/app/(overlay)/overlay/v2/[key]/page.tsx` is a thin server component:
   - Validates `[key]` against the 17-key allowlist.
   - Server-fetches the canonical session payload via the matching `/api/broadcast/v2/sessions/[id]/<key>` endpoint.
   - Renders a single `<iframe src={`/overlays/v2/${key}/index.html?session=${sessionId}&token=${viewToken}`} class="w-screen h-screen border-0">`.
   - The HTML's existing `window.addEventListener('message', ...)` handler stays the contract for live data.
3. **Data injection layer** (small client wrapper around the iframe):
   - Subscribes to the relevant Realtime channels (e.g., `public:standings:<seasonId>`).
   - On event, calls `iframe.contentWindow.postMessage({ type: 'update', data: {...} }, '*')`.
   - The HTML's existing handlers process payload + drive entry/exit animations.
4. **Designer iteration loop**: edit `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html` → save → chokidar watch syncs to `apps/web/public/overlays/v2/<key>/index.html` → browser source picks up changes on next refresh. No Next.js rebuild needed.
5. **Production deployment**: sync script also runs at build time (`prebuild` npm hook) so the public folder is committed/synced when the app deploys. Vercel will serve the static HTML directly from CDN.

**Watch script behavior (apps/web/scripts/sync-v2-overlays.mjs):**

```js
// Pseudocode
import chokidar from 'chokidar';
import { copyFile, mkdir } from 'node:fs/promises';

const SOURCE = 'C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/KNOWLEDGE/brand-assets/elements/v2';
const TARGET = 'C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER/apps/web/public/overlays/v2';

// On startup: copy all 17 overlay folders' index.html. Also copy the fonts + logos + players assets they reference, into apps/web/public/overlays/v2/_assets/.
// Then watch for changes.

if (process.env.NODE_ENV === 'development') {
  chokidar.watch(SOURCE, { ignored: /(^|[/\\])\.\.|node_modules/ }).on('change', syncFile);
}
```

**Path rewriting**: source HTML uses `../../../fonts/...`, `../../../logos/...`, `../../../players/...` relative paths. Sync script rewrites these to `/overlays/v2/_assets/fonts/...`, etc., so the copied HTML resolves correctly when served from `/public/overlays/v2/<key>/index.html`. Sync script regex-replaces these patterns during copy.

**Why iframe vs direct port:** porting HTML→React loses the design-iteration loop the user explicitly requested 2026-04-25 ("we should be able to still update the designs of the overlays by using or changing the html file and using it as reference"). The iframe approach keeps HTML authoritative, supports realtime data via postMessage (already the existing contract per `KNOWLEDGE/brand-assets/elements/v2/02-timer/index.html` etc.), and isolates each overlay's CSS from the host page.

**Per-route page.tsx skeleton:**

```tsx
// apps/web/src/app/(overlay)/overlay/v2/[key]/page.tsx
import { redirect } from 'next/navigation';
import { OverlayDataInjector } from '@/components/broadcast/v2/OverlayDataInjector';

const ALLOWED_KEYS = new Set([
  '01-brb','02-timer','04-h2h-2','05-h2h-3','06-h2h-5','07-leaderboard',
  '08-lower-third','09-secondary-score-bug','10-up-next-bug','11-match-scores-day',
  '12-starting-soon','13-stream-ended','14-top-scorers','15-orgs','16-coaches','17-penalties',
]);

export default async function OverlayV2Page({ params, searchParams }: { params: { key: string }, searchParams: { session?: string; token?: string } }) {
  if (!ALLOWED_KEYS.has(params.key)) return redirect('/overlay/v2/01-brb');
  const { session, token } = searchParams;
  // Verify token if provided. Query session payload for initial render.
  return <OverlayDataInjector overlayKey={params.key} sessionId={session} token={token} />;
}
```

`OverlayDataInjector` is a client component that:
- Renders `<iframe src={`/overlays/v2/${overlayKey}/index.html`} ref={iframeRef} ... />`
- Subscribes to the appropriate Realtime channel(s) based on `overlayKey`.
- On message, posts data into the iframe via `iframeRef.current.contentWindow.postMessage(...)`.

**Net effect on design iteration:** edit HTML → save → chokidar sync → browser refresh → live design updated. Tournament/data wiring lives ONLY in the JS shim (Next.js route + injector + publisher chain), never inside the HTML CSS. Designer never has to touch `.tsx`.

| # | Key | Route | Mockup source |
|---|---|---|---|
| 01 | brb | `/overlay/v2/01-brb` | `v2/01-brb/index.html` |
| 02 | timer | `/overlay/v2/02-timer` | `v2/02-timer/index.html` |
| 04 | h2h-2 | `/overlay/v2/04-h2h-2` | `v2/04-h2h-2/index.html` |
| 05 | h2h-3 | `/overlay/v2/05-h2h-3` | `v2/05-h2h-3/index.html` |
| 06 | h2h-5 | `/overlay/v2/06-h2h-5` | `v2/06-h2h-5/index.html` |
| 07 | leaderboard | `/overlay/v2/07-leaderboard` | `v2/07-leaderboard/index.html` |
| 08 | lower-third | `/overlay/v2/08-lower-third` | `v2/08-lower-third/index.html` |
| 09 | secondary-score-bug | `/overlay/v2/09-secondary-score-bug` | `v2/09-secondary-score-bug/index.html` |
| 10 | up-next-bug | `/overlay/v2/10-up-next-bug` | `v2/10-up-next-bug/index.html` |
| 11 | match-scores-day | `/overlay/v2/11-match-scores-day` | `v2/11-match-scores-day/index.html` |
| 12 | starting-soon | `/overlay/v2/12-starting-soon` | `v2/12-starting-soon/index.html` |
| 13 | stream-ended | `/overlay/v2/13-stream-ended` | `v2/13-stream-ended/index.html` |
| 14 | top-scorers | `/overlay/v2/14-top-scorers` | `v2/14-top-scorers/index.html` |
| 15 | orgs | `/overlay/v2/15-orgs` | `v2/15-orgs/index.html` |
| 16 | coaches | `/overlay/v2/16-coaches` | `v2/16-coaches/index.html` |
| 17 | penalties | `/overlay/v2/17-penalties` | `v2/17-penalties/index.html` |

EXCLUDED from the 17: `03-animated-bg-v1/v2/v3` (meta-overlays — not surface triggers, used as background layer only), `18-partners-strip` (subsumed into other overlays, not a standalone trigger).

Each route is 1920×1080 @ 60fps, sound-disabled. Animated-bg variant locked to `v3` via build-time const.

---

## 10. Test coverage

### 10.1 Unit (Vitest, mocked Supabase)

Per-module minimums:

- `win_probability.ts` — ≥10 tests: neutral H2H, dominant A, dominant B, no-played-yet edge, all-equal edge, draw clamp bounds (0.10 / 0.28), last5Form null tolerance, season-played-zero edge, h2hRecord undefined, blowout symmetry.
- `tiebreakers.ts` — ≥10: default order, reverse order, name tiebreak, gd-only ordering, gf-only ordering, totalPts ties broken by gd, empty-order fallback, single-row no-op, 13-row stable sort, h2h fallback to totalPts.
- `snapshots.ts` — ≥10: capture happy path, double-capture idempotent, read missing returns null, readPrevious returns most recent < current, append-only block (UPDATE rejects), append-only block (DELETE rejects), match_day FK enforced, snapshotData JSONB shape, capturedAt sorted desc, malformed seasonId.
- `walkovers/index.ts` — ≥10: triggerAdmin happy path, triggerAdmin re-trigger same winner is no-op, triggerAdmin switch winner replaces, markRefPending sets pending+ref, confirmRefPending flips pending false, undoWalkover clears all four cols, undo on non-walkover rejects, GF in top-scorers, recompute_standings called, audit row inserted.
- `exports/leaderboard_xlsx.ts` / `_docx.ts` / `metrics_xlsx.ts` — ≥10 each: column shape, row count = 13, totals row absent (per spec), sanctions column populated, season label header present, empty-season produces empty body, multi-sheet count (metrics), formats are valid binary (hex sniff), buffer length > 0, Africa/Lagos timestamp format.
- `broadcast/v2/lazy_mount.ts` / `off_routing.ts` / `clear_action.ts` — ≥10 each: visibility transitions, hasMounted memoization, OFF target = overlay_events for 16, OFF target = overlay_active_instances for lower_third, multi-instance flag toggling, clear with null instanceId, clear with explicit instanceId, clear count returned, supabase error path, perm denial path.
- `realtime/publishers/*.ts` — ≥10 across the 5 publishers: channel name correctness, event name correctness, payload shape, missing seasonId rejects, supabase channel send error path, double-publish dedup, payload size limits, snapshot_captured includes matchDayId, walkover_confirmed includes winnerId, score_changed includes both scores.

### 10.2 E2E (Playwright)

Spec at `apps/web/tests/e2e/plan51-tournament-and-broadcast-v2.spec.ts`:

1. **Score entry flow** — admin logs in, navigates `/admin/tournament` → Results Entry tab. Enters score 5-3 for fixture FARUK vs ANIFE. Submits. Standings tab updates < 1s. Leaderboard overlay (loaded in second tab via Realtime subscription) shows new positions with arrows.
2. **Ref-pending walkover flow** — referee logs in → `/referee/attendance` → marks ANIFE absent for fixture vs FARUK. Switches to admin session → `/admin/tournament` → Walkovers tab. Sees pending row. Clicks Confirm → row moves to Active. `match_results` row has `is_walkover=true`, score 3-0 to FARUK.
3. **Lower-third preset save/reload** — production user → `/admin/broadcast/v2/[sessionId]` → fills 3 lower-third slots → Save preset "MD3-introductions". Reloads page. Click Load → 3 slots restored.
4. **Trigger flow with entry/exit anim** — production user → click ENTER on top-scorers card → overlay tab shows entry animation. Click OFF → exit animation completes within 800ms.
5. **Tiebreaker drag-rank** — admin → Tiebreaker Config tab → drag GF above GD. Save. Standings tab re-sorts visibly. `seasons.tiebreaker_order` JSONB confirmed via `supabase db query` post-test.
6. **Export download** — admin → click Download XLSX → file size > 0, valid xlsx hex magic, 13 rows in first sheet.
7. **Win-prob preview** — admin → Win-Prob Preview tab → pick A=FARUK, B=ANIFE → see triple sums to 1.000 ± 0.001.

### 10.3 Migration smoke

`supabase/tests/plan51_smoke.sql` — confirms each new column exists with correct default + each constraint + leaderboard_snapshots UNIQUE + append-only triggers fire.

---

## 11. Acceptance criteria

1. `npm run test` clean (≥80 new tests added).
2. `npm run lint` clean.
3. `npm run build` clean.
4. `npm --workspace apps/web run e2e` — all 7 plan-51 specs pass.
5. `npm run db:push` applies all 3 migrations to cloud successfully.
6. `/admin/tournament` loads with 8 tabs as admin; each tab renders without runtime error in dev server log or browser console.
7. Score entry recomputes standings + publishes Realtime event within 1s (verified in browser network tab + DB row inspection).
8. Walkover via admin path AND via ref-pending path both produce a 3:0 row with `is_walkover=true` and recompute standings.
9. Tiebreaker drag-rank persists across reload + reorders Standings tab in real-time.
10. `/api/tournament/export?type=leaderboard&format=xlsx` returns valid XLSX with 13 player rows.
11. `/api/tournament/export?type=leaderboard&format=docx` returns valid DOCX (sniff magic bytes `PK\x03\x04`).
12. `/api/tournament/export?type=metrics&format=xlsx` returns multi-sheet workbook (Standings, Top-Scorers, H2H, Sanctions).
13. `/admin/broadcast/v2/[sessionId]` renders 17 cards as production user; lazy-mount confirmed (only viewport-visible cards have iframe DOM).
14. Each of 17 overlay routes renders standalone with entry animation + exit animation working.
15. Realtime channel subscribed by leaderboard overlay receives `standings.changed` event after admin score entry.
16. Lower-third 3-slot editor + preset save/load works end-to-end via localStorage.
17. Legacy `/admin/broadcast/[sessionId]` unaffected — existing OverlayMiniPreview / OffTriggerButton / clearInstanceAction still pass their existing tests after refactor to call new server modules.
18. RLS / perm gates block unauthorized roles from each new route (verified by curl with non-admin cookie).

---

## 12. File ownership table per agent

For Phase B/C parallel dispatch. One agent per row; no shared files except via Agent S coordination at the start.

| Agent | Owned files | Notes |
|---|---|---|
| **Agent S — scaffolding + migrations** | `apps/web/src/perms.ts`, `apps/web/src/middleware.ts`, `apps/web/src/components/admin/AdminSubnav.tsx`, `apps/web/src/app/admin/page.tsx` (tile additions), `apps/web/src/app/admin/tournament/layout.tsx`, `apps/web/src/app/admin/broadcast/v2/layout.tsx`, `apps/web/src/app/(overlay)/overlay/v2/layout.tsx`, `supabase/migrations/20260525000001..03.sql`, `apps/web/src/perms.seed.test.ts` | Goes first; everyone else waits for migrations + perms. |
| **Agent SRV — server modules** | `apps/web/src/server/standings/win_probability.ts` + `.test.ts`, `apps/web/src/server/standings/tiebreakers.ts` + `.test.ts`, `apps/web/src/server/standings/snapshots.ts` + `.test.ts`, `apps/web/src/server/walkovers/index.ts` + `.test.ts`, `apps/web/src/server/exports/leaderboard_xlsx.ts` + `.test.ts`, `apps/web/src/server/exports/leaderboard_docx.ts` + `.test.ts`, `apps/web/src/server/exports/metrics_xlsx.ts` + `.test.ts`, `apps/web/src/server/broadcast/v2/lazy_mount.ts` + `.test.ts`, `apps/web/src/server/broadcast/v2/off_routing.ts` + `.test.ts`, `apps/web/src/server/broadcast/v2/clear_action.ts` + `.test.ts`, `apps/web/src/server/realtime/publishers/score_changed.ts` + `.test.ts`, `apps/web/src/server/realtime/publishers/standings_recomputed.ts` + `.test.ts`, `apps/web/src/server/realtime/publishers/match_ended.ts` + `.test.ts`, `apps/web/src/server/realtime/publishers/walkover_confirmed.ts` + `.test.ts`, `apps/web/src/server/realtime/publishers/snapshot_captured.ts` + `.test.ts` | NO existing-file edits — all new files. |
| **Agent UI-T — Tournament page** | `apps/web/src/app/admin/tournament/page.tsx`, `apps/web/src/app/admin/tournament/_components/StandingsTab.tsx`, `_components/FixturesTab.tsx`, `_components/ResultsEntryTab.tsx`, `_components/WalkoversTab.tsx`, `_components/AdjustmentsTab.tsx`, `_components/TiebreakerConfigTab.tsx`, `_components/H2HLookupTab.tsx`, `_components/WinProbPreviewTab.tsx`, `_components/TiebreakerDragRank.tsx`, `apps/web/src/app/api/tournament/export/route.ts` | All 8 tab components + export route. |
| **Agent UI-OV — Overlay routes** | `apps/web/src/app/(overlay)/overlay/v2/01-brb/page.tsx` through `17-penalties/page.tsx` (17 routes), plus `_lib/v2-asset-paths.ts` | Each ports the corresponding `v2/<key>/index.html` to a client component. Reads data via `useDataFeed` from existing Slice 1. |
| **Agent UI-BC — Broadcast v2 page** | `apps/web/src/app/admin/broadcast/v2/[sessionId]/page.tsx`, `_components/OverlayCardV2.tsx`, `_components/LowerThirdSlotsEditor.tsx`, `_components/H2HPickerEditor.tsx`, `_components/MatchScoresDayEditor.tsx`, `_components/UpNextFixturePicker.tsx`, `apps/web/src/app/api/broadcast/v2/sessions/[id]/[key]/route.ts` (17 endpoints, file-routed) | Reuses existing `OverlayMiniPreview` after Agent SRV's refactor. |
| **Agent RT — Realtime + E2E** | `apps/web/tests/e2e/plan51-tournament-and-broadcast-v2.spec.ts`, `supabase/tests/plan51_smoke.sql`, wiring of all 5 realtime publishers into existing `recordMatchScore` action + `recompute_standings` trigger path + `walkovers/index.ts` calls | Edits 1 existing file: `apps/web/src/server/standings/recompute.ts` to call `publishStandingsRecomputed`. Coordinate via Agent S's branch. |

Dispatch order: Agent S first (blocking) → SRV + UI-OV in parallel → UI-T + UI-BC + RT in parallel after SRV's util exports land.

---

## 13. Parallel agent etiquette (CLAUDE.md §parallel-agent-etiquette compliance)

- **Migration claim block:** This plan owns `20260525000001..03`. No other plan may use these slots.
- **Shared files** (`perms.ts`, `middleware.ts`, `AdminSubnav.tsx`, `admin/page.tsx`): edited only by Agent S. Other agents do NOT touch these files. If they need an updated perm, they ping Agent S.
- **Cloud DB push:** Agent S pushes migrations after own slice green. Subsequent agents do NOT push migrations (they don't write any).
- **Push to remote:** Each agent commits + pushes their own slice only after its tests + lint + build pass on the slice in isolation. No `--no-verify`. No bundle pushes.
- **FK disambiguation:** No new FKs introduced in this plan that touch ambiguous embed paths. `match_results.walkover_initiated_by` is a TEXT enum, not an FK.
- **Idempotent recompute:** All walkover state changes call existing `recompute_standings(season_id)` — no incremental patching. Standings rebuild from scratch.
- **Audit trigger:** All new mutable tables get `public.attach_audit('<table>')` in their migration. Append-only tables (`leaderboard_snapshots`) also get the dedicated `block_mutation` trigger.

---

## 14. Open questions for future

None currently locked. All 70 Q&A items resolved per Section 2. If any ambiguity surfaces during build, escalate to user before proceeding — do not assume.

Possible future-plan additions (NOT in scope here):
- Per-goal score-entry UI feeding `goal_events` (currently top-scorers reader falls back to `player_match_stats.goals`).
- H2H tiebreaker computation (currently stubs to `totalPts`).
- Walkover dispute / appeal flow (Plan 13B handles disputes generally).
- Coach-intros data wiring (currently placeholder).
- Multi-stream broadcast support (currently single session).
- Cutover of legacy `/admin/broadcast/[sessionId]` to v2.
