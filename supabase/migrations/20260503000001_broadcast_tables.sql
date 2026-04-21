-- Plan 12 — Phase 2 prep: vMix overlay bridge.
-- Three broadcast tables: overlay templates (seeded), stream sessions
-- (one active per match_day), and overlay events (every trigger/clear).
-- RLS is deliberately omitted per CLAUDE.md — broadcast tables are
-- business config and gated in the API layer via `hasPermAsync()`.

-- 1. overlay_templates — seeded catalog of renderable overlay kinds.
create table public.overlay_templates (
  id                      uuid primary key default gen_random_uuid(),
  template_key            text not null unique,
  template_type           text not null
                            check (template_type in (
                              'lower_third','scorebar','standings_widget',
                              'player_card','punishment_ticker','intro','outro'
                            )),
  name                    text not null,
  html_route              text not null,
  default_payload_schema  jsonb not null default '{}'::jsonb,
  active_bool             boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);
create index overlay_templates_active_idx
  on public.overlay_templates (active_bool)
  where deleted_at is null;

-- 2. stream_sessions — one live broadcast window per match_day.
-- A partial unique index enforces "only one active (ended_at IS NULL)
-- non-deleted session per match_day".
create table public.stream_sessions (
  id                  uuid primary key default gen_random_uuid(),
  match_day_id        uuid not null references public.match_days (id),
  vmix_session_tag    text,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  started_by_user_id  uuid not null references public.users (id),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create unique index stream_sessions_one_active_per_day
  on public.stream_sessions (match_day_id)
  where ended_at is null and deleted_at is null;
create index stream_sessions_match_day_idx
  on public.stream_sessions (match_day_id);

-- 3. overlay_events — every trigger (with payload JSONB + cleared_at).
create table public.overlay_events (
  id                    uuid primary key default gen_random_uuid(),
  stream_session_id     uuid not null references public.stream_sessions (id),
  template_id           uuid not null references public.overlay_templates (id),
  triggered_by_user_id  uuid not null references public.users (id),
  triggered_at          timestamptz not null default now(),
  payload               jsonb not null,
  cleared_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index overlay_events_session_active_idx
  on public.overlay_events (stream_session_id)
  where cleared_at is null and deleted_at is null;
create index overlay_events_template_idx
  on public.overlay_events (template_id);
