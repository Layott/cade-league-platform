-- 2026-05-01 — Backfill Sunday match days to 12:00 arrival cutoff +
-- 13:00 kick-off. User reports the live site shows 09:00/10:00 because
-- the original seed used the form defaults. Per the user brief: "the
-- start time on every Sunday matchday is 1pm and players must have
-- arrived by 12pm".
--
-- Only Sunday rows (extract(dow FROM match_date) = 0) are touched.
-- Saturday matches keep their current call-time. Existing soft-deleted
-- rows are left alone. `updated_at` is bumped so the audit trigger
-- captures the change.

update public.match_days
set
  arrival_cutoff_time = '12:00:00',
  match_start_time    = '13:00:00',
  updated_at          = now()
where extract(dow from match_date) = 0
  and deleted_at is null
  and (arrival_cutoff_time <> '12:00:00' or match_start_time <> '13:00:00');
