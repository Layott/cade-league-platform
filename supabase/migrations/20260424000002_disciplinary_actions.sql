create table public.disciplinary_actions (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.disciplinary_cases (id) on delete restrict,
  sanction_type     text not null check (sanction_type in (
    'warning','point_deduction','gd_deduction','forfeit','ban'
  )),
  magnitude         int  not null default 0 check (magnitude >= 0),
  effective_from    date not null default current_date,
  effective_until   date,
  imposed_by        uuid not null references public.users (id) on delete restrict,
  imposed_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  revoke_reason     text,
  public_visible    boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint disciplinary_actions_revoke_reason_ck
    check (revoked_at is null or revoke_reason is not null),
  constraint disciplinary_actions_effective_range_ck
    check (effective_until is null or effective_until >= effective_from)
);

create index disciplinary_actions_case_idx
  on public.disciplinary_actions (case_id)
  where deleted_at is null;

create index disciplinary_actions_active_idx
  on public.disciplinary_actions (sanction_type, effective_from)
  where deleted_at is null and revoked_at is null;

create index disciplinary_actions_public_idx
  on public.disciplinary_actions (imposed_at desc)
  where public_visible = true and revoked_at is null and deleted_at is null;

select public.attach_audit('public.disciplinary_actions');
