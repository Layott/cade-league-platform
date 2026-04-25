-- Plan 51 — Tournament page columns.
--
-- Adds:
--   seasons.tiebreaker_order — JSONB array of stat keys, ordered. Default
--     reflects the locked Phase 1A spec ranking. Future per-season override
--     edits land via /admin/tournament/tiebreaker-config.
--
--   match_results.is_walkover         — flag for walkover-counted rows.
--   match_results.walkover_initiated_by — admin | ref (who triggered).
--   match_results.walkover_pending    — true while awaiting confirm.
--   match_results.walkover_confirmed_at — set when ref confirms.
--
-- All additions are NULLable / default-driven so existing rows keep their
-- semantics. Walkover rows still live in match_results so the standings
-- recomputer (which already filters by result_type='void') doesn't need a
-- shape change. Walkovers count as a normal/forfeit row with the new flag
-- exposed for the tournament admin UI + UI badging.

alter table public.seasons
  add column if not exists tiebreaker_order jsonb
    not null
    default '["totalPts","gd","gf","name"]'::jsonb;

comment on column public.seasons.tiebreaker_order is
  'Plan 51: ordered list of standings tiebreaker stat keys. Edited via /admin/tournament/tiebreaker-config; consumed by the standings recompute. Default = ["totalPts","gd","gf","name"].';

alter table public.match_results
  add column if not exists is_walkover boolean not null default false;

alter table public.match_results
  add column if not exists walkover_initiated_by text
    check (walkover_initiated_by is null or walkover_initiated_by in ('admin','ref'))
    default null;

alter table public.match_results
  add column if not exists walkover_pending boolean not null default false;

alter table public.match_results
  add column if not exists walkover_confirmed_at timestamptz default null;

comment on column public.match_results.is_walkover is
  'Plan 51: TRUE when this result was logged as a walkover (no actual play). Standings count it as a forfeit-style 3-0 unless the admin overrides scores.';
comment on column public.match_results.walkover_initiated_by is
  'Plan 51: who initiated the walkover request — admin or ref. Pairs with walkover_pending while the second party still has to confirm.';
comment on column public.match_results.walkover_pending is
  'Plan 51: TRUE while waiting on the ref/admin counter-confirm. Cleared once walkover_confirmed_at is set.';
comment on column public.match_results.walkover_confirmed_at is
  'Plan 51: timestamp the walkover was confirmed by the second party. NULL while pending.';
