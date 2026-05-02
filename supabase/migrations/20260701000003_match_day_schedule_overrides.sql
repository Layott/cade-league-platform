-- 2026-05-01 — Per-match-day overrides for squad submission deadline +
-- change-window times. The Friday 21:00-22:00 default stays automatic;
-- admin can override per match day via this table.
--
-- The existing `squad_match_day_overrides` table flips a per-MD window
-- between force_open / force_close. THIS table is orthogonal — it lets
-- admin SHIFT the default Thursday 10:00 deadline + Friday 21:00-22:00
-- change window without flipping force_open/force_close at all. Useful
-- when the league bumps a single weekend (e.g. holiday) but otherwise
-- keeps the standard cycle.
--
-- Keys:
--   match_day_id              — FK to match_days(id) cascade delete.
--   submission_deadline_at    — overrides Thursday 10:00 deadline.
--   change_window_open_at     — overrides Friday 21:00 open.
--   change_window_close_at    — overrides Friday 22:00 close.
--
-- All three time columns are nullable so admin can shift just one (e.g.
-- extend the deadline to Thursday 14:00 but leave the change window
-- alone). Soft-delete via `deleted_at` so the audit trigger captures
-- who flipped what, when. Mirrors squad_match_day_overrides shape.

create table if not exists public.match_day_schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days(id) on delete cascade,
  submission_deadline_at  timestamptz,
  change_window_open_at   timestamptz,
  change_window_close_at  timestamptz,
  notes        text,
  set_by       uuid references public.users(id),
  set_at       timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create unique index if not exists match_day_schedule_overrides_unique_active
  on public.match_day_schedule_overrides (match_day_id) where deleted_at is null;

create index if not exists match_day_schedule_overrides_match_day_idx
  on public.match_day_schedule_overrides (match_day_id);

alter table public.match_day_schedule_overrides enable row level security;

create policy match_day_schedule_overrides_deny_select
  on public.match_day_schedule_overrides for select using (false);

select public.attach_audit('public.match_day_schedule_overrides');

comment on table public.match_day_schedule_overrides is
  'Per-match-day admin overrides for the squad submission deadline + Friday change-window times. Layered on top of the Thursday-10:00 + Friday-21:00-22:00 defaults; per-column nullable so admin can shift just one boundary. Permission re-uses squads.window.manage.';
