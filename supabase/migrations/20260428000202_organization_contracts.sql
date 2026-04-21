-- Plan 13A: Organization → Player contracts (A)
-- One active contract per (player, season) enforced via partial unique index.
-- RLS blocks direct client read/write — all access via server modules.

create table public.organization_contracts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  player_id        uuid not null references public.players (id) on delete restrict,
  season_id        uuid not null references public.seasons (id) on delete restrict,
  contract_url     text not null,
  signed_at        timestamptz,
  valid_from       date not null,
  valid_until      date not null,
  status           text not null default 'draft'
                     check (status in ('draft','active','terminated','expired')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint org_contracts_valid_range_ck check (valid_until >= valid_from)
);

create index org_contracts_player_idx on public.organization_contracts (player_id, valid_from)
  where deleted_at is null;
create index org_contracts_org_idx on public.organization_contracts (organization_id)
  where deleted_at is null;
create unique index org_contracts_unique_active_per_season
  on public.organization_contracts (player_id, season_id)
  where deleted_at is null and status = 'active';

select public.attach_audit('public.organization_contracts');

alter table public.organization_contracts enable row level security;

create policy org_contracts_no_direct on public.organization_contracts for all
  using (false) with check (false);
