-- Plan 51 follow-up — add winner_player_id to match_results.
--
-- The original Plan 51 column migration (20260525000001) added the four
-- walkover flag columns but not the winner FK. Walkovers page +
-- walkovers/index.ts both need this column to identify which player
-- claimed the 3-0 walkover (since the row's home/away score equality
-- doesn't always survive admin overrides + future generic walkover
-- targets aren't bound to home/away semantics — see Plan 51 Q35:
-- "no home/away — just player names").

ALTER TABLE public.match_results
  ADD COLUMN IF NOT EXISTS winner_player_id UUID
    REFERENCES public.players(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS match_results_winner_player_id_idx
  ON public.match_results(winner_player_id)
  WHERE winner_player_id IS NOT NULL;
