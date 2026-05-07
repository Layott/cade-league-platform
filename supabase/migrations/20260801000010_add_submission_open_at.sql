-- 2026-05-07 — Add per-match-day submission OPEN-AT gate.
--
-- Existing `match_day_schedule_overrides` shifts the close time
-- (`submission_deadline_at`). Default behaviour was "open from forever
-- until deadline" — players could submit weeks ahead of a match day.
-- Admin asked for a matching OPEN time so a specific match-day window
-- is gated on BOTH sides: open at T_open, close at T_close.
--
-- Column is nullable. NULL preserves existing behaviour (open from
-- forever); a non-null value gates `now < openAt` as closed in the
-- resolver with reason `schedule_not_open_yet`.

alter table public.match_day_schedule_overrides
  add column if not exists submission_open_at timestamptz;

comment on column public.match_day_schedule_overrides.submission_open_at is
  'Optional admin-set timestamp gating when squad submissions OPEN for this match day. NULL = open from forever (default). Pre-openAt the resolver returns closed with reason schedule_not_open_yet.';
