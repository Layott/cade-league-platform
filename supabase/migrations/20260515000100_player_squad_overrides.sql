-- 2026-04-23 — Per-player admin override for the weekly squad submission window.
--
-- Sits alongside public.squad_window_overrides (migration 20260514000100),
-- which is league-wide. This table is one row per (player, week) and
-- lets admins/refs override submission rules for a single player:
--
--   state = 'ban'        → this player CANNOT submit/edit this week, even
--                          if the league window is open.
--   state = 'force_open' → this player CAN submit/edit this week even
--                          after the Thursday 10:00 WAT deadline, even if
--                          the league window is closed.
--
-- Final gate precedence (implemented in a different slice):
--   1. player ban          → deny.
--   2. league force_close  → deny.
--   3. player force_open   → allow.
--   4. league force_open   → allow.
--   5. default time-based window.
--
-- Cleared by soft-delete (deleted_at IS NOT NULL) so the audit trigger
-- still captures who flipped what, when. Soft-delete + re-insert works
-- because the (player_id, week_start_date) uniqueness is partial on
-- deleted_at IS NULL.

create table public.player_squad_overrides (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id),
  week_start_date date not null,
  state text not null check (state in ('ban', 'force_open')),
  note text,
  set_by uuid not null references public.users(id),
  set_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Partial unique so soft-delete + re-insert works cleanly. Upserts target
-- (player_id, week_start_date); the server module also handles the
-- resurrection case (clearing deleted_at on a previously-soft-deleted row).
create unique index player_squad_overrides_active_unique
  on public.player_squad_overrides (player_id, week_start_date)
  where deleted_at is null;

-- Admin "list overrides for this week" query.
create index player_squad_overrides_week_state_idx
  on public.player_squad_overrides (week_start_date, state)
  where deleted_at is null;

-- updated_at is written by the server module on every update (no trigger —
-- matches squad_window_overrides convention).
select public.attach_audit('public.player_squad_overrides');

-- Perm seed: admins + loc + referees can flip per-player overrides.
insert into public.role_permissions (role, permission) values
  ('admin', 'squads.player_override.manage'),
  ('loc',   'squads.player_override.manage'),
  ('referee', 'squads.player_override.manage')
on conflict (role, permission) do nothing;

comment on table public.player_squad_overrides is
  'Per-player admin override for the weekly squad submission window. Absence of an active row for a given (player_id, week_start_date) means no per-player override applies; the league-wide squad_window_overrides + default time-based window take over.';
