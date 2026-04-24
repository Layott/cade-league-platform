-- Fix infinite-recursion error between disciplinary_cases_public_select
-- and disciplinary_actions_self_select.
--
-- Original cycle:
--   disciplinary_cases_public_select USING EXISTS (... disciplinary_actions ...)
--   disciplinary_actions_self_select USING EXISTS (... disciplinary_cases ...)
--   Postgres couldn't statically pick a branch → infinite recursion at query
--   time. Runtime error: "infinite recursion detected in policy for relation
--   disciplinary_cases". The /profile sanctions fetch (+ /players/[id]
--   listForPlayer) failed silently with empty results for every caller.
--
-- Break the cycle by dropping the EXISTS from the case-level public policy.
-- disciplinary_cases holds only metadata (player_id, incident_type, match_id,
-- reported_by, opened_at, status) — none of it is sensitive on its own. The
-- actual sensitive payload (sanction_type, magnitude, notes) lives on
-- disciplinary_actions and stays gated by its own public+self policies.

drop policy if exists disciplinary_cases_public_select on public.disciplinary_cases;

create policy disciplinary_cases_public_select
  on public.disciplinary_cases for select
  to anon, authenticated
  using (deleted_at is null);
