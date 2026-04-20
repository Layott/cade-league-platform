create table public.disciplinary_cases (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.players (id) on delete restrict,
  match_id       uuid references public.matches (id) on delete set null,
  incident_type  text not null check (incident_type in (
    'late_arrival','forfeit','equipment','social_media','other'
  )),
  reported_by    uuid not null references public.users (id) on delete restrict,
  opened_at      timestamptz not null default now(),
  status         text not null default 'open' check (status in ('open','resolved')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index disciplinary_cases_player_idx
  on public.disciplinary_cases (player_id, opened_at desc)
  where deleted_at is null;

create index disciplinary_cases_match_idx
  on public.disciplinary_cases (match_id)
  where match_id is not null and deleted_at is null;

create index disciplinary_cases_status_idx
  on public.disciplinary_cases (status)
  where deleted_at is null;

select public.attach_audit('public.disciplinary_cases');
