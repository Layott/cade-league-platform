-- A match day groups N fixtures played on the same physical date at the same venue.
-- Phase 1A: single venue, single season. Statuses drive the admin UI state machine.

create table public.match_days (
  id                    uuid primary key default gen_random_uuid(),
  season_id             uuid not null references public.seasons (id) on delete restrict,
  match_date            date not null,
  arrival_cutoff_time   time not null,
  match_start_time      time not null,
  venue_name            text not null,
  status                text not null default 'scheduled'
                        check (status in ('scheduled','in_progress','completed','cancelled')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (season_id, match_date)
);

create index match_days_season_date_idx
  on public.match_days (season_id, match_date desc)
  where deleted_at is null;

create index match_days_status_idx
  on public.match_days (status)
  where deleted_at is null;

select public.attach_audit('public.match_days');
