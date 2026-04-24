-- Audit Slice 1 (2026-04-24) — goal_events table for per-match goal-scorer
-- attribution. Enables the `top_scorers` overlay to aggregate goals by
-- player instead of reading the team-level `match_results.home_score` /
-- `away_score` numbers (which attribute goals to a side, not a scorer).
--
-- Schema design notes
-- -------------------
-- * One row per goal scored. Minute and own_goal are optional (admin may
--   not capture per-goal timing — we still want the aggregate to be
--   correct even when minutes are all NULL).
-- * `player_id` is the scorer. For OWN GOALS, `player_id` is the player
--   who put it in their own net, AND `own_goal = true`. The aggregate
--   reader will EXCLUDE `own_goal = true` rows from the scorer's total so
--   own goals don't pollute the top-scorers list.
-- * `match_id` cascades on delete so deleting a match tears down its
--   goal_events in the same transaction. Soft-deleted via `deleted_at`
--   per CLAUDE.md §7 so restore-from-trash works.
-- * Audit trigger attached via `public.attach_audit()` (CLAUDE.md §3).
--
-- IMPORTANT: this migration only creates the TABLE. Score-entry code does
-- NOT yet populate it (per Slice 1 boundary — another slice handles score-
-- entry UI). Until that lands, the `top_scorers` reader falls back to
-- `player_match_stats.goals` when the goal_events table is empty for a
-- given season. The OCR pipeline (Plan 14) also lands rows in
-- `player_match_stats.goals` directly for screenshot-based ingestion.

create table public.goal_events (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches (id) on delete cascade,
  player_id     uuid not null references public.players (id) on delete restrict,
  minute        int  check (minute is null or (minute >= 0 and minute <= 130)),
  own_goal      boolean not null default false,
  entered_by    uuid not null references public.users (id) on delete restrict,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Indexes: per-match + per-player for top_scorers aggregation + admin UI.
create index goal_events_match_idx
  on public.goal_events (match_id)
  where deleted_at is null;

create index goal_events_player_idx
  on public.goal_events (player_id)
  where deleted_at is null;

-- Partial index on non-own-goal events — top_scorers aggregation filter
-- runs off this so the scan is tight even with thousands of goals across
-- the season.
create index goal_events_scorer_idx
  on public.goal_events (player_id)
  where deleted_at is null and own_goal = false;

select public.attach_audit('public.goal_events');

comment on table public.goal_events is
  'Per-goal attribution — one row per goal scored in a match. Consumed by the top_scorers overlay aggregate. Own-goals are excluded from the scorer total by filtering own_goal = false in the reader.';
comment on column public.goal_events.minute is
  'Optional (0..130). NULL when the admin did not capture per-goal timing.';
comment on column public.goal_events.own_goal is
  'True when the scorer put it in their own net. Aggregate scorer totals filter these out.';
