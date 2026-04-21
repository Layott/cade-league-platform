-- Plan 13A: extend players with org + staff FKs (A)
-- All three columns nullable; existing roster pre-dates orgs.

alter table public.players
  add column if not exists organization_id uuid references public.organizations (id) on delete set null,
  add column if not exists team_manager_id uuid references public.users (id) on delete set null,
  add column if not exists coach_id        uuid references public.users (id) on delete set null;

create index if not exists players_org_idx on public.players (organization_id)
  where deleted_at is null and organization_id is not null;
create index if not exists players_team_manager_idx on public.players (team_manager_id)
  where deleted_at is null and team_manager_id is not null;
create index if not exists players_coach_idx on public.players (coach_id)
  where deleted_at is null and coach_id is not null;
