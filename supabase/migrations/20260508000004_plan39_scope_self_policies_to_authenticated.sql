-- Plan 39 C2 follow-up — scope "self" RLS policies that subquery into
-- public.users to role `authenticated` only.
--
-- Background: Plan 39 C2 (migration 20260508000001) revoked anon's
-- table-wide SELECT on public.users, re-granting only the public-safe
-- columns (id, display_name, created_at, updated_at, deleted_at).
--
-- Side effect: any RLS policy that subqueries `users.supabase_auth_id`
-- (to resolve "the row's user matches the caller") is now a plan error
-- for anon because the subquery plan requires SELECT privilege on
-- `supabase_auth_id`, which anon does not have. Postgres evaluates
-- every PERMISSIVE policy that could apply — it does not short-circuit
-- across OR'd subquery policies — so the anon request fails with
-- "permission denied for table users" even when a cheaper permissive
-- policy (e.g. public_read with `deleted_at IS NULL`) would have
-- already granted the row.
--
-- Observable breakage before this fix:
--   * `/` — 500 (listStandings subquery fails)
--   * `/players` — 500 (listPlayersInActiveSeason join through players)
--   * any anon PostgREST read of: players, disputes, user_roles
--
-- Fix: re-create each affected policy with `TO authenticated`. The
-- predicates already filter on `auth.uid()` which is NULL for anon, so
-- the policies NEVER grant anon a row — narrowing the role list is
-- semantically identical and removes anon from the plan.
--
-- Tables with a cheaper permissive public-read policy (players,
-- content_posts) remain publicly readable via that policy. Tables
-- without one (disputes, user_roles) become visible only to
-- authenticated callers — which matches their pre-Plan-39 behaviour,
-- because before Plan 39 anon had no privilege to issue the query at
-- all (PII columns on users were gated via column grants).

-- 1) public.players — self-read and self-update
drop policy if exists players_self_read_any on public.players;
create policy players_self_read_any
  on public.players for select
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = players.user_id and u.supabase_auth_id = auth.uid()
    )
  );

drop policy if exists players_self_update on public.players;
create policy players_self_update
  on public.players for update
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = players.user_id and u.supabase_auth_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = players.user_id and u.supabase_auth_id = auth.uid()
    )
  );

-- 2) public.disputes — self-read
drop policy if exists disputes_self_read on public.disputes;
create policy disputes_self_read
  on public.disputes for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.users u
      where u.id = disputes.raised_by_user_id and u.supabase_auth_id = auth.uid()
    )
  );

-- 3) public.user_roles — self-select
drop policy if exists user_roles_self_select on public.user_roles;
create policy user_roles_self_select
  on public.user_roles for select
  to authenticated
  using (
    user_id in (
      select id from public.users where supabase_auth_id = auth.uid()
    )
  );

-- 4) public.content_posts — self-read (table soft-archived per Plan 33
--    but policy still attached; narrow for hygiene so the table does
--    not re-break anon if it's ever re-enabled).
drop policy if exists content_posts_self_read on public.content_posts;
create policy content_posts_self_read
  on public.content_posts for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.players p
      join public.users u on u.id = p.user_id
      where p.id = content_posts.player_id and u.supabase_auth_id = auth.uid()
    )
  );

-- Note: public.users `users_self_select` / `users_self_update` are
-- INTENTIONALLY left alone. Their predicate `supabase_auth_id = auth.uid()`
-- is an inline comparison on the current row (no subquery), and direct
-- anon SELECT on users works correctly today (verified empirically).
-- Re-touching them risks regressing the column-grant resolution order.
