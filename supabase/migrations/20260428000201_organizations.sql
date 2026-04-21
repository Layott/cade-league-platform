-- Plan 13A: Organizations table (A)
-- Org-level entity owning caution-fee balance + CAC identity.
-- RLS in separate 000205 migration so we can seed inside bare perms.

create table public.organizations (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,
  cac_number                 text,
  cac_cert_url               text,
  contact_rep_user_id        uuid references public.users (id) on delete set null,
  status                     text not null default 'active'
                               check (status in ('active','suspended','dissolved')),
  caution_fee_balance_coins  bigint not null default 0
                               check (caution_fee_balance_coins >= 0),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz
);

create unique index organizations_cac_idx on public.organizations (cac_number)
  where deleted_at is null and cac_number is not null;
create index organizations_rep_idx on public.organizations (contact_rep_user_id)
  where deleted_at is null;
create index organizations_status_idx on public.organizations (status)
  where deleted_at is null;

select public.attach_audit('public.organizations');
