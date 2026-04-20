-- Materialized per-player per-season. Rebuilt by recompute_standings(season_id).
-- punishment_* columns exist now so Plan 4 can write them without schema change.

create table public.standings (
  id                            uuid primary key default gen_random_uuid(),
  season_id                     uuid not null references public.seasons (id) on delete cascade,
  player_id                     uuid not null references public.players (id) on delete cascade,
  matches_played                int  not null default 0,
  wins                          int  not null default 0,
  draws                         int  not null default 0,
  losses                        int  not null default 0,
  goals_for                     int  not null default 0,
  goals_against                 int  not null default 0,
  goal_difference               int  not null default 0,
  points                        int  not null default 0,
  punishment_points_deducted    int  not null default 0,
  punishment_gd_deducted        int  not null default 0,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  deleted_at                    timestamptz,
  unique (season_id, player_id)
);

create index standings_season_idx
  on public.standings (season_id)
  where deleted_at is null;

create index standings_season_points_idx
  on public.standings (season_id, points desc, goal_difference desc, goals_for desc)
  where deleted_at is null;

select public.attach_audit('public.standings');
