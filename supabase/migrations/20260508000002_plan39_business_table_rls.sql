-- Plan 39 C3 — Enable RLS on 6 sensitive business tables that were
-- previously relying on "PostgREST anon never knows the URL" security.
-- Per CLAUDE.md §4 the locked policy was "RLS on PII tables only" — but
-- the audit findings (B1, K1) showed that left disciplinary, telemetry and
-- session tables exposed to anyone with the anon key (which ships in the
-- browser bundle).
--
-- Posture per table:
--   * deny-all SELECT for anon + authenticated (FALSE policy)
--   * service-role bypasses RLS so server modules + cron unaffected
--   * `sessions` + `auth_events` additionally allow self-read so the
--     player-facing UI can show "your sign-in history" without leaking
--     other users' data.

-- 1. disciplinary_actions ----------------------------------------------------
alter table public.disciplinary_actions enable row level security;
drop policy if exists disciplinary_actions_deny_all on public.disciplinary_actions;
create policy disciplinary_actions_deny_all
  on public.disciplinary_actions for select
  to anon, authenticated
  using (false);

-- 2. auth_events -------------------------------------------------------------
alter table public.auth_events enable row level security;
drop policy if exists auth_events_deny_all on public.auth_events;
drop policy if exists auth_events_self_read on public.auth_events;
create policy auth_events_deny_all
  on public.auth_events for select
  to anon
  using (false);
create policy auth_events_self_read
  on public.auth_events for select
  to authenticated
  using (
    user_id = (
      select id from public.users
       where supabase_auth_id = auth.uid()
       limit 1
    )
  );

-- 3. sessions ----------------------------------------------------------------
alter table public.sessions enable row level security;
drop policy if exists sessions_deny_all on public.sessions;
drop policy if exists sessions_self_read on public.sessions;
create policy sessions_deny_all
  on public.sessions for select
  to anon
  using (false);
create policy sessions_self_read
  on public.sessions for select
  to authenticated
  using (
    user_id = (
      select id from public.users
       where supabase_auth_id = auth.uid()
       limit 1
    )
  );

-- 4. attendance_marks --------------------------------------------------------
alter table public.attendance_marks enable row level security;
drop policy if exists attendance_marks_deny_all on public.attendance_marks;
create policy attendance_marks_deny_all
  on public.attendance_marks for select
  to anon, authenticated
  using (false);

-- 5. match_stat_screenshots --------------------------------------------------
alter table public.match_stat_screenshots enable row level security;
drop policy if exists match_stat_screenshots_deny_all on public.match_stat_screenshots;
create policy match_stat_screenshots_deny_all
  on public.match_stat_screenshots for select
  to anon, authenticated
  using (false);

-- 6. ocr_usage_log -----------------------------------------------------------
alter table public.ocr_usage_log enable row level security;
drop policy if exists ocr_usage_log_deny_all on public.ocr_usage_log;
create policy ocr_usage_log_deny_all
  on public.ocr_usage_log for select
  to anon, authenticated
  using (false);

-- Verification (run in supabase db query after push):
--   select tablename, rowsecurity from pg_tables
--    where schemaname='public'
--      and tablename in (
--        'disciplinary_actions','auth_events','sessions',
--        'attendance_marks','match_stat_screenshots','ocr_usage_log'
--      );
-- Expected: rowsecurity=t for all six.
