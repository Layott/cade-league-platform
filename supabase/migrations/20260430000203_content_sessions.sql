-- Plan 13A: Content sessions (C)
-- Scheduled match-day content shoots per player. If a player misses the primary
-- session, a makeup slot can be scheduled. One row per (match_day, player).

create table public.content_sessions (
  id                          uuid primary key default gen_random_uuid(),
  match_day_id                uuid not null references public.match_days (id) on delete restrict,
  player_id                   uuid not null references public.players (id) on delete restrict,
  scheduled_time              timestamptz not null,
  attended_bool               boolean not null default false,
  makeup_session_scheduled_at timestamptz,
  makeup_attended_bool        boolean not null default false,
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  constraint content_sessions_makeup_ck
    check (
      (makeup_session_scheduled_at is null and makeup_attended_bool = false)
      or (attended_bool = false and makeup_session_scheduled_at is not null)
    )
);

create unique index content_sessions_match_player_unique
  on public.content_sessions (match_day_id, player_id)
  where deleted_at is null;

create index content_sessions_match_idx
  on public.content_sessions (match_day_id)
  where deleted_at is null;

select public.attach_audit('public.content_sessions');
