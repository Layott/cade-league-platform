-- Middleware needs to read the current user's roles to gate admin routes.
-- Previously user_roles_no_direct blocked ALL direct access; replace with
-- "user can read their own roles" + "no direct write".

drop policy if exists user_roles_no_direct on public.user_roles;

create policy user_roles_self_select
  on public.user_roles for select
  using (
    user_id in (
      select id from public.users where supabase_auth_id = auth.uid()
    )
  );

-- Writes still blocked; server mutations use service role key which bypasses RLS.
create policy user_roles_no_write
  on public.user_roles for insert with check (false);
create policy user_roles_no_update
  on public.user_roles for update using (false) with check (false);
create policy user_roles_no_delete
  on public.user_roles for delete using (false);
