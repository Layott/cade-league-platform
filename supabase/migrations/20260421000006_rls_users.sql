-- RLS on PII tables only (per Phase 1A decision). Business perms live in API layer.

alter table public.users       enable row level security;
alter table public.user_roles  enable row level security;

-- A user can read their own public.users row.
create policy users_self_select
  on public.users for select
  using (supabase_auth_id = auth.uid());

-- A user can update their own non-sensitive fields.
-- (Server-side code with service role bypasses RLS for all other writes.)
create policy users_self_update
  on public.users for update
  using (supabase_auth_id = auth.uid())
  with check (supabase_auth_id = auth.uid());

-- user_roles is server-managed only. No client direct access.
-- (Server uses service role key which bypasses RLS.)
create policy user_roles_no_direct
  on public.user_roles for all
  using (false)
  with check (false);
