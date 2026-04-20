-- One match = one head-to-head fixture between two players on a match day.

create table public.matches (
  id               uuid primary key default gen_random_uuid(),
  season_id        uuid not null references public.seasons (id) on delete restrict,
  match_day_id     uuid not null references public.match_days (id) on delete cascade,
  home_player_id   uuid not null references public.players (id) on delete restrict,
  away_player_id   uuid not null references public.players (id) on delete restrict,
  scheduled_time   time,
  status           text not null default 'scheduled'
                   check (status in ('scheduled','in_progress','completed','forfeited','voided')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  check (home_player_id <> away_player_id)
);

create index matches_match_day_idx
  on public.matches (match_day_id)
  where deleted_at is null;

create index matches_season_status_idx
  on public.matches (season_id, status)
  where deleted_at is null;

create index matches_home_idx
  on public.matches (home_player_id, season_id)
  where deleted_at is null;

create index matches_away_idx
  on public.matches (away_player_id, season_id)
  where deleted_at is null;

select public.attach_audit('public.matches');
