-- Plan 18 — add a unique constraint on (match_day_id, home_player_id, away_player_id)
-- so the round-robin fixture seed (supabase/seed/plan18_fixtures.sql) can use
-- ON CONFLICT DO NOTHING for idempotent re-runs. The constraint is narrow: it
-- only prevents the identical fixture being inserted twice into the same
-- match day, which is a correctness property independent of Plan 18 anyway.
--
-- Partial unique index (WHERE deleted_at IS NULL) so a soft-deleted fixture
-- doesn't block re-creating the same pairing on the same match day.

create unique index if not exists matches_match_day_home_away_uidx
  on public.matches (match_day_id, home_player_id, away_player_id)
  where deleted_at is null;
