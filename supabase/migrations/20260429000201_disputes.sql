-- Plan 13A: Disputes (B)
-- Raised by any authenticated user (player/admin/moderator) against a match,
-- sanction, registration, or other subject. RLS lets raiser read their own;
-- writes go through server module.

create table public.disputes (
  id                  uuid primary key default gen_random_uuid(),
  raised_by_user_id   uuid not null references public.users (id) on delete restrict,
  subject_type        text not null check (subject_type in
                        ('match','sanction','registration','other')),
  subject_id          uuid,
  description         text not null,
  evidence_urls       text[] not null default '{}',
  status              text not null default 'submitted'
                        check (status in ('submitted','under_review','resolved','withdrawn')),
  assigned_to_user_id uuid references public.users (id) on delete set null,
  ruling              text,
  opened_at           timestamptz not null default now(),
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint disputes_ruling_ck
    check (status <> 'resolved' or (ruling is not null and resolved_at is not null))
);

create index disputes_raiser_idx on public.disputes (raised_by_user_id)
  where deleted_at is null;
create index disputes_status_idx on public.disputes (status)
  where deleted_at is null;
create index disputes_assigned_idx on public.disputes (assigned_to_user_id)
  where deleted_at is null and assigned_to_user_id is not null;

select public.attach_audit('public.disputes');

alter table public.disputes enable row level security;

create policy disputes_self_read on public.disputes for select
  using (
    deleted_at is null and exists (
      select 1 from public.users u
      where u.id = disputes.raised_by_user_id
        and u.supabase_auth_id = auth.uid()
    )
  );

create policy disputes_no_direct_write on public.disputes for all
  using (false) with check (false);
