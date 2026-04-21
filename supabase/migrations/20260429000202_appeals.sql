-- Plan 13A: Appeals (B)
-- Filed by player against a disciplinary_case; ruled by 3-member panel.
-- deadline_at computed server-side via addBusinessDays (5 biz days).
-- One open appeal per case via partial unique index.

create table public.appeals (
  id                     uuid primary key default gen_random_uuid(),
  disciplinary_case_id   uuid not null references public.disciplinary_cases (id) on delete restrict,
  submitted_by_user_id   uuid not null references public.users (id) on delete restrict,
  submitted_at           timestamptz not null default now(),
  grounds                text not null,
  evidence_urls          text[] not null default '{}',
  panel_member_user_ids  uuid[] not null default '{}'
                           check (array_length(panel_member_user_ids, 1) is null
                                  or array_length(panel_member_user_ids, 1) <= 5),
  ruling                 text,
  ruled_at               timestamptz,
  deadline_at            timestamptz not null,
  status                 text not null default 'submitted'
                           check (status in ('submitted','under_review','ruled','withdrawn','expired')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  constraint appeals_ruling_ck
    check (status <> 'ruled' or (ruling is not null and ruled_at is not null))
);

create unique index appeals_one_open_per_case
  on public.appeals (disciplinary_case_id)
  where deleted_at is null and status in ('submitted','under_review');

create index appeals_deadline_idx on public.appeals (deadline_at)
  where deleted_at is null and status in ('submitted','under_review');

create index appeals_submitter_idx on public.appeals (submitted_by_user_id)
  where deleted_at is null;

select public.attach_audit('public.appeals');

alter table public.appeals enable row level security;

create policy appeals_no_direct on public.appeals for all
  using (false) with check (false);
