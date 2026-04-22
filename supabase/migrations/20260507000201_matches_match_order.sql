-- Plan 26 — add `match_order` to public.matches.
--
-- The real LOC-supplied schedule lists fixtures within each match day in a
-- canonical, meaningful order (announced match 1, match 2, ...). The previous
-- synthetic seed (Plan 18) ordered fixtures only by `scheduled_time`, which
-- the LOC schedule leaves NULL. We need a deterministic per-match-day sort
-- key independent of clock time so the public Fixtures page and the admin
-- match-day detail page show the schedule as the LOC published it.
--
-- Default 0 keeps existing rows valid without a backfill — Plan 26's seed
-- writes the real values explicitly, and the editable-fixture UI assigns the
-- next free integer when an admin appends a fixture.

alter table public.matches
  add column if not exists match_order int not null default 0;

create index if not exists matches_match_day_order_idx
  on public.matches (match_day_id, match_order)
  where deleted_at is null;
