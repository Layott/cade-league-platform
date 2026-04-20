-- Per-player stat row per match. custom_metrics JSONB is the extension slot.

create table public.player_match_stats (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches (id) on delete cascade,
  player_id       uuid not null references public.players (id) on delete restrict,
  goals           int  not null default 0 check (goals >= 0),
  assists         int  not null default 0 check (assists >= 0),
  clean_sheet     boolean not null default false,
  custom_metrics  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (match_id, player_id)
);

create index player_match_stats_player_idx
  on public.player_match_stats (player_id)
  where deleted_at is null;

create index player_match_stats_match_idx
  on public.player_match_stats (match_id)
  where deleted_at is null;

select public.attach_audit('public.player_match_stats');
