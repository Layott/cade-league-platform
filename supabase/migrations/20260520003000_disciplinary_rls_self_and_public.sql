-- Linkage audit slice (2026-04-24) — replace the Plan 39 deny-all RLS on
-- `disciplinary_actions` with a pair of narrowly-scoped SELECT policies so
-- the authenticated session client can read:
--   (a) every row marked public_visible that isn't revoked / soft-deleted
--   (b) every row whose case.player_id -> player.user_id matches the
--       calling user (self-visibility for private sanctions too)
--
-- Staff surfaces (admin / moderator / loc / referee) already go through
-- the service-role client in /admin/punishments + /admin/match-days,
-- which bypasses RLS — so staff reads are unaffected.
--
-- Also mirrors the _self_select pattern onto `disciplinary_cases` and
-- `appeals` so that Supabase's PostgREST nested-embed queries can traverse
-- the join chain without hitting a policy-denied table in the middle.
-- (disciplinary_cases.player_id and appeals.disciplinary_case_id are the
-- linchpins.)
--
-- Plan 39 lesson captured: any RLS policy that subqueries
-- `users.supabase_auth_id` must be scoped TO authenticated only — anon's
-- `auth.uid()` is NULL so the predicate never matches anyway, but the
-- plan-time column check still fails for anon. See lessons.md §2026-04-24.

-- 1. disciplinary_actions ---------------------------------------------------
alter table public.disciplinary_actions enable row level security;

-- Drop the Plan 39 deny-all.
drop policy if exists disciplinary_actions_deny_all on public.disciplinary_actions;
drop policy if exists disciplinary_actions_public_select on public.disciplinary_actions;
drop policy if exists disciplinary_actions_self_select on public.disciplinary_actions;

-- Public read — everyone (anon + authenticated) can see rows that are
-- public-visible, not revoked, not soft-deleted. Matches the existing
-- partial index `disciplinary_actions_public_idx`.
create policy disciplinary_actions_public_select
  on public.disciplinary_actions for select
  to anon, authenticated
  using (
    public_visible = true
    and revoked_at is null
    and deleted_at is null
  );

-- Self read — authenticated user can see every disciplinary_action whose
-- parent case belongs to their player row, regardless of public_visible.
-- Include soft-deleted = false so the player doesn't see rows admins have
-- retracted. Keep revoked visible for self so the player sees their own
-- revoked sanctions (useful for appeal context).
create policy disciplinary_actions_self_select
  on public.disciplinary_actions for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
        from public.disciplinary_cases dc
        join public.players p on p.id = dc.player_id
        join public.users    u on u.id = p.user_id
       where dc.id = disciplinary_actions.case_id
         and dc.deleted_at is null
         and p.deleted_at is null
         and u.supabase_auth_id = auth.uid()
    )
  );

-- 2. disciplinary_cases -----------------------------------------------------
-- `disciplinary_cases` had no RLS enabled before. PostgREST embed queries
-- (`disciplinary_cases!inner (...)`) must resolve the join row for the
-- per-row filter on disciplinary_actions to succeed, so we enable RLS AND
-- add matching public + self policies. Staff still bypass via service-role.
alter table public.disciplinary_cases enable row level security;

drop policy if exists disciplinary_cases_public_select on public.disciplinary_cases;
drop policy if exists disciplinary_cases_self_select on public.disciplinary_cases;

-- Public read — allow anon + authenticated to resolve case rows that have
-- at least one public_visible + non-revoked + non-deleted action. Enforced
-- via EXISTS on disciplinary_actions so the two policies stay consistent.
create policy disciplinary_cases_public_select
  on public.disciplinary_cases for select
  to anon, authenticated
  using (
    deleted_at is null
    and exists (
      select 1
        from public.disciplinary_actions da
       where da.case_id = disciplinary_cases.id
         and da.public_visible = true
         and da.revoked_at is null
         and da.deleted_at is null
    )
  );

-- Self read — authenticated player can read every case row that belongs
-- to their own player, even if every action on it is non-public.
create policy disciplinary_cases_self_select
  on public.disciplinary_cases for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
        from public.players p
        join public.users   u on u.id = p.user_id
       where p.id = disciplinary_cases.player_id
         and p.deleted_at is null
         and u.supabase_auth_id = auth.uid()
    )
  );

-- 3. appeals ---------------------------------------------------------------
-- appeals had `appeals_no_direct` (deny-all). /profile needs to read the
-- appeal status per disciplinary_case_id to show "Under review / Upheld /
-- Dismissed" on each sanction row. Self-read is the minimum needed.
drop policy if exists appeals_no_direct on public.appeals;
drop policy if exists appeals_self_select on public.appeals;

-- Keep writes closed (server-managed only).
create policy appeals_no_direct_write
  on public.appeals for all
  using (false) with check (false);

-- Self-read — authenticated user can read appeals THEY submitted OR
-- appeals attached to a case that is about themselves (covers the rare
-- case of an admin submitting on a player's behalf).
create policy appeals_self_select
  on public.appeals for select
  to authenticated
  using (
    deleted_at is null
    and (
      exists (
        select 1 from public.users u
         where u.id = appeals.submitted_by_user_id
           and u.supabase_auth_id = auth.uid()
      )
      or exists (
        select 1
          from public.disciplinary_cases dc
          join public.players p on p.id = dc.player_id
          join public.users   u on u.id = p.user_id
         where dc.id = appeals.disciplinary_case_id
           and u.supabase_auth_id = auth.uid()
      )
    )
  );

-- 4. attendance_marks ------------------------------------------------------
-- Plan 39 gave attendance_marks a deny-all. Self-read lets /profile render
-- the player's own attendance history. Admin-visible panel on
-- /players/[id] still goes through service-role (see page.tsx).
drop policy if exists attendance_marks_deny_all on public.attendance_marks;
drop policy if exists attendance_marks_self_select on public.attendance_marks;

create policy attendance_marks_deny_anon
  on public.attendance_marks for select
  to anon
  using (false);

create policy attendance_marks_self_select
  on public.attendance_marks for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
        from public.players p
        join public.users   u on u.id = p.user_id
       where p.id = attendance_marks.player_id
         and p.deleted_at is null
         and u.supabase_auth_id = auth.uid()
    )
  );

-- 4b. match_stat_screenshots (public read of confirmed rows) --------------
-- Plan 39 locked down match_stat_screenshots with deny-all. The
-- `/players/[id]` recent-stats card embeds this table to prove the stat
-- rows were admin-confirmed (`parse_status='confirmed'`), so anon + self
-- embeds get zero rows today. Widening to a narrow public-read (confirmed
-- + non-deleted) is safe: OCR's pre-confirmed parsed_json is the only
-- sensitive field, and once the admin flips parse_status to 'confirmed'
-- every downstream read is already authoritative (player_match_stats
-- has been populated). Admin writes remain closed — the upload +
-- rerun-OCR + confirm-review server actions all run via service-role.
drop policy if exists match_stat_screenshots_deny_all on public.match_stat_screenshots;
drop policy if exists match_stat_screenshots_public_confirmed on public.match_stat_screenshots;

create policy match_stat_screenshots_public_confirmed
  on public.match_stat_screenshots for select
  to anon, authenticated
  using (
    parse_status = 'confirmed'
    and deleted_at is null
  );

-- 5. organization_contracts ------------------------------------------------
-- `organization_contracts` had `org_contracts_no_direct` (deny-all).
-- /players/[id] needs to render the org badge; the data behind that badge
-- (org name + logo) is already public via `organizations_public_read`, so
-- exposing which players have an active contract with which org adds no
-- new PII. Public select allows the UI to resolve the join.
drop policy if exists org_contracts_no_direct on public.organization_contracts;
drop policy if exists org_contracts_public_select on public.organization_contracts;

create policy org_contracts_no_direct_write
  on public.organization_contracts for all
  using (false) with check (false);

create policy org_contracts_public_select
  on public.organization_contracts for select
  to anon, authenticated
  using (
    deleted_at is null
    and status = 'active'
  );

-- Verification (run after db:push):
--   -- 1. Anon with public rows returns > 0 rows.
--   set role anon;
--   select count(*) from public.disciplinary_actions
--    where public_visible and revoked_at is null and deleted_at is null;
--   -- 2. Service-role unaffected.
--   reset role;
--   select count(*) from public.disciplinary_actions;
