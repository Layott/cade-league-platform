-- Plan 39 C2 — Lock down public.users so anon / authenticated cannot SELECT
-- the PII columns (`email`, `phone`, `failed_login_count`, `last_login_at`,
-- `supabase_auth_id`). The previous `users_public_select` policy granted
-- table-wide SELECT to anyone with the anon key, which leaks email + phone
-- to anyone who opens devtools on the public site.
--
-- Strategy: drop the wide policy, then revoke column-level SELECT on the
-- PII columns from the anon + authenticated roles. The remaining
-- public-safe columns (id, display_name, gamer_tag, jersey_number,
-- photo_url, deleted_at, created_at) stay readable so the /players +
-- /standings public pages keep working.
--
-- Service-role bypasses RLS + column grants entirely (Postgres role-level
-- grant) so server modules continue to function.

drop policy if exists users_public_select on public.users;

-- Replacement: allow anon + authenticated to SELECT only the public-safe
-- columns of non-deleted rows. We re-create a row-level policy whose
-- USING clause is intentionally permissive (deleted_at filter only); the
-- column-level grants below do the actual narrowing.
create policy users_public_safe_select
  on public.users for select
  to anon, authenticated
  using (deleted_at is null);

-- Revoke table-wide SELECT then re-grant only the public-safe columns.
-- Postgres requires column-level grants to live alongside an explicit
-- table-level revoke for the column filter to take effect.
revoke select on public.users from anon, authenticated;

-- Per the actual public.users schema (migration 20260421000001), the only
-- non-PII columns are id, display_name, created_at, updated_at, deleted_at.
-- gamer_tag / jersey_number / photo_url live on public.players, which has
-- its own public-read policy. Email + phone + supabase_auth_id +
-- failed_login_count + last_login_at stay revoked from anon/authenticated.
grant select (
  id,
  display_name,
  created_at,
  updated_at,
  deleted_at
) on public.users to anon, authenticated;

-- Sanity check via psql / supabase db query:
--   select grantee, column_name, privilege_type
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'users'
--      and grantee in ('anon','authenticated');
-- Expected: only the 7 columns above appear.
