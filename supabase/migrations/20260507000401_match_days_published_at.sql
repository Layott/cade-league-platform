-- Plan 27 — per-match-day publish flag.
--
-- The public /fixtures page should only surface match days the LOC has
-- explicitly chosen to release ahead of the session. Until then players
-- see the empty-state. Admins can publish (sets `published_at = now()`)
-- or unpublish (clears it) from the match-day detail page.
--
-- Soft-delete continues to live in `deleted_at`. The two flags compose:
-- a row is "visible to players" iff `published_at is not null AND
-- deleted_at is null`. The partial index below matches that predicate
-- so the public-page query is a pure index scan.

alter table public.match_days
  add column if not exists published_at timestamptz null;

create index if not exists match_days_published_idx
  on public.match_days (season_id, match_date desc)
  where published_at is not null and deleted_at is null;
