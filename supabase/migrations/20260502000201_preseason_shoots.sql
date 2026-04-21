-- Plan 13A: Pre-season shoots (D)
-- Schedule of pre-season photo/video/interview sessions per season.

create table public.preseason_shoots (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references public.seasons (id) on delete restrict,
  shoot_date  date not null,
  type        text not null check (type in ('photo','video','interview')),
  location    text,
  status      text not null default 'scheduled'
                check (status in ('scheduled','completed','cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index preseason_shoots_season_date_idx
  on public.preseason_shoots (season_id, shoot_date)
  where deleted_at is null;

select public.attach_audit('public.preseason_shoots');
