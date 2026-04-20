-- Link table: which players are in which season.
-- Supports multi-season in later phases. No RLS: no PII.

create table public.season_participants (
  id              uuid primary key default gen_random_uuid(),
  season_id       uuid not null references public.seasons (id) on delete cascade,
  player_id       uuid not null references public.players (id) on delete cascade,
  entry_status    text not null default 'confirmed'
                    check (entry_status in ('invited','confirmed','withdrawn','disqualified')),
  registered_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (season_id, player_id)
);

create index season_participants_season_idx
  on public.season_participants (season_id)
  where deleted_at is null;

create index season_participants_player_idx
  on public.season_participants (player_id)
  where deleted_at is null;

select public.attach_audit('public.season_participants');
