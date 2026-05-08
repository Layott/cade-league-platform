-- 2026-05-08 — Allow distinct per-MD submissions within the same
-- Thursday-anchor week.
--
-- Plan 10 enforced "one submission per (player, week)" via the partial
-- unique index `squad_submissions_player_week_live_uidx`. Plan 56
-- introduced per-match-day submissions but kept the original index, so
-- submitting different squads for Saturday + Sunday in the same weekend
-- pair would either collide on the unique index OR (per submit.ts
-- canReplace path) silently soft-delete the prior day's submission.
--
-- The user-facing model is per-day: each MD = independent squad. Player
-- can apply one squad to multiple days explicitly via the
-- WeekendApplyPrompt or `/player/squad?submitted=…` flow, but the
-- DEFAULT must allow Sat ≠ Sun.
--
-- Strategy: split the unique index into two partial indexes:
--   1. Per-MD rows (match_day_id IS NOT NULL) → unique on
--      (player_id, match_day_id). One live submission per (player, MD).
--   2. Legacy weekly rows (match_day_id IS NULL) → keep the original
--      (player_id, week_start_date) constraint. Pre-Plan-56 submissions
--      stay valid.

drop index if exists public.squad_submissions_player_week_live_uidx;

create unique index if not exists squad_submissions_player_md_live_uidx
  on public.squad_submissions (player_id, match_day_id)
  where deleted_at is null and match_day_id is not null;

create unique index if not exists squad_submissions_player_week_legacy_live_uidx
  on public.squad_submissions (player_id, week_start_date)
  where deleted_at is null and match_day_id is null;

comment on index public.squad_submissions_player_md_live_uidx is
  'Per-match-day uniqueness: one live submission per (player, match_day). Plan 56+ flow. Soft-deletes do not block resubmission.';

comment on index public.squad_submissions_player_week_legacy_live_uidx is
  'Legacy weekly uniqueness for pre-Plan-56 rows where match_day_id IS NULL. Preserved so any historical weekly submission keeps its single-per-week guarantee.';
