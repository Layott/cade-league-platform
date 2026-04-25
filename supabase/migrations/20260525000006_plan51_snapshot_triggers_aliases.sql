-- Plan 51 follow-up — split append-only trigger into named pair.
--
-- Original Plan 51 migration created a single combined trigger
-- `leaderboard_snapshots_block` on UPDATE OR DELETE. The smoke test
-- (supabase/tests/plan51_smoke.sql §6) asserts two separate triggers
-- `leaderboard_snapshots_no_update` + `leaderboard_snapshots_no_delete`
-- so observability tooling can grep them by intent. Both reuse the
-- existing `ls_block_mutation()` function.

DROP TRIGGER IF EXISTS leaderboard_snapshots_block ON public.leaderboard_snapshots;
DROP TRIGGER IF EXISTS leaderboard_snapshots_no_update ON public.leaderboard_snapshots;
DROP TRIGGER IF EXISTS leaderboard_snapshots_no_delete ON public.leaderboard_snapshots;

CREATE TRIGGER leaderboard_snapshots_no_update
  BEFORE UPDATE ON public.leaderboard_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.ls_block_mutation();

CREATE TRIGGER leaderboard_snapshots_no_delete
  BEFORE DELETE ON public.leaderboard_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.ls_block_mutation();
