-- Bug 2 (2026-05-01) — harden attendance_marks write-path RLS contract.
--
-- Symptom: user reported "the page crashes and it gives an error" when
-- marking attendance for week 1. Smoke-tested service-role INSERT against
-- the live DB successfully — direct service-role writes work. But the
-- existing RLS posture on `attendance_marks` (per migration
-- `20260520003000_disciplinary_rls_self_and_public.sql`) only declares
-- SELECT policies (deny anon, self-select for authenticated) and never
-- enumerates INSERT/UPDATE/DELETE policies. With RLS enabled, missing
-- write policies behave as deny-by-default for authenticated session
-- clients — but adding *explicit* deny policies makes the contract
-- self-documenting and prevents a future regression where someone wires
-- the API layer to use a user-session client and the silent "permission
-- denied" surfaces only at runtime as a page crash.
--
-- The API layer at `apps/web/src/app/admin/match-days/[id]/attendance/
-- actions.ts` uses `getServiceRoleSupabase()` (audited 2026-05-01) which
-- bypasses RLS entirely. These policies do NOT block service-role; they
-- only fence off authenticated user-session clients. Anon writes were
-- already deny-by-default and remain so (no policy listed for `to anon`).

-- INSERT — deny authenticated session clients. Service-role bypasses RLS.
create policy attendance_marks_insert_block_authenticated
  on public.attendance_marks for insert
  to authenticated
  with check (false);

-- UPDATE — deny authenticated session clients. Service-role bypasses RLS.
create policy attendance_marks_update_block_authenticated
  on public.attendance_marks for update
  to authenticated
  using (false)
  with check (false);

-- DELETE — deny authenticated session clients. Service-role bypasses RLS.
create policy attendance_marks_delete_block_authenticated
  on public.attendance_marks for delete
  to authenticated
  using (false);

-- Verification (run after db:push):
--   set role authenticated;
--   insert into public.attendance_marks (match_day_id, player_id, status, marked_by, scheduled_call_time, delta_seconds)
--     values (gen_random_uuid(), gen_random_uuid(), 'present', gen_random_uuid(), now(), 0);
--   -- expect: ERROR: new row violates row-level security policy
--   reset role;
--   -- service-role INSERT continues to succeed (this script).
