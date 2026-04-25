-- Plan 51 follow-up — walkover_pending implies is_walkover.
--
-- Smoke test (supabase/tests/plan51_smoke.sql §4) asserts this CHECK
-- exists. The original Plan 51 migration only typed walkover_initiated_by;
-- this adds the cross-column invariant so a row can't be marked as
-- "pending walkover confirmation" without also being flagged a walkover.

ALTER TABLE public.match_results
  DROP CONSTRAINT IF EXISTS match_results_walkover_pending_chk;

ALTER TABLE public.match_results
  ADD CONSTRAINT match_results_walkover_pending_chk
  CHECK (NOT walkover_pending OR is_walkover);
