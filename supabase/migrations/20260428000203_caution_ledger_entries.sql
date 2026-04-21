-- Plan 13A: Caution-fee ledger (A)
-- Append-only. UPDATE + DELETE blocked by triggers. RLS deny-all for direct
-- client access; server reads go via service-role.
-- NO updated_at, NO deleted_at on this table: every entry immutable.

create table public.caution_ledger_entries (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  entry_type             text not null check (entry_type in (
                           'deposit','fine_deduction','topup','adjustment')),
  amount_coins           bigint not null check (amount_coins > 0),
  direction              text not null check (direction in ('credit','debit')),
  balance_after_coins    bigint not null check (balance_after_coins >= 0),
  reference              text,
  entered_by_user_id     uuid not null references public.users (id) on delete restrict,
  entered_at             timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create index caution_ledger_org_idx
  on public.caution_ledger_entries (organization_id, entered_at desc);
create index caution_ledger_entered_by_idx
  on public.caution_ledger_entries (entered_by_user_id, entered_at desc);

select public.attach_audit('public.caution_ledger_entries');

create or replace function public.block_mutation_caution_ledger()
returns trigger language plpgsql as $$
begin
  raise exception 'caution_ledger_entries is append-only';
end;
$$;

create trigger caution_ledger_no_update
  before update on public.caution_ledger_entries
  for each row execute function public.block_mutation_caution_ledger();

create trigger caution_ledger_no_delete
  before delete on public.caution_ledger_entries
  for each row execute function public.block_mutation_caution_ledger();

alter table public.caution_ledger_entries enable row level security;

create policy caution_ledger_no_direct on public.caution_ledger_entries for all
  using (false) with check (false);
