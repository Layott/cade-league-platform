-- Plan 13A: RLS on organizations (A)
-- Public read allowed (org names, CAC numbers are public info);
-- direct writes blocked — all mutation goes through server modules.

alter table public.organizations enable row level security;

create policy organizations_public_read on public.organizations for select
  using (deleted_at is null);

create policy organizations_no_direct_write on public.organizations for all
  using (false) with check (false);
