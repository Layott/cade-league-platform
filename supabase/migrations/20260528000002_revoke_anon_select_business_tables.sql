-- Plan 39 hardening (2026-04-28, P1-001) — revoke anonymous SELECT on
-- business tables that hold strategy IP / forensic data. Anonymous
-- callers using `NEXT_PUBLIC_SUPABASE_ANON_KEY` can today hit
-- `${SUPABASE_URL}/rest/v1/squad_submissions?select=*` and pull every
-- player's full Futbin path, item list, budget, formation, and
-- screenshot path. Same for `audit_events` (full forensic ledger of
-- every actor action, suitable for entity-history reconstruction).
--
-- Server reads in this codebase always use the service-role client
-- (which bypasses GRANTs) for any `audit_events` SELECT and for any
-- cross-player squad query. Player-facing self-reads use the cookie-
-- scoped server client which authenticates as `authenticated` —
-- preserving GRANT for `authenticated` keeps those flows working
-- while closing the anon leak.
--
-- Re-running this migration is idempotent: REVOKE on a role that
-- doesn't have the privilege is a no-op.

revoke select on public.squad_submissions      from anon;
revoke select on public.squad_player_items     from anon;
revoke select on public.squad_change_requests  from anon;
revoke select on public.audit_events           from anon;
revoke select on public.match_stat_screenshots from anon;

-- Tighten audit ledger further: even authenticated users have no
-- legitimate need to query the ledger directly via PostgREST. All
-- audit reads in the app go through service-role helpers
-- (`server/audit/index.ts`). Keep `authenticated` SELECT off so
-- a stolen user JWT can't dump it.
revoke select on public.audit_events from authenticated;
