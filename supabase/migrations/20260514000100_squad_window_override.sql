-- 2026-04-23 — Admin override for the weekly squad submission window.
--
-- The default window is time-based (Thursday 10:00 WAT deadline + Friday
-- 21:00-22:00 change window). Admins occasionally need to force the
-- window open (late-start weeks) or force it shut (emergency freeze).
-- This table is a one-row-per-week knob consulted by the squad-status
-- helper and the /player/squad submit guard.
--
-- Keys:
--   week_start_date  — the Thursday that anchors the week (same key as
--                      squad_submissions.week_start_date).
--   state            — 'force_open' or 'force_close'. Absence = auto.
--
-- Cleared by soft-delete (deleted_at IS NOT NULL) so the audit trigger
-- still captures who flipped what, when.

create table public.squad_window_overrides (
  week_start_date date primary key,
  state text not null check (state in ('force_open', 'force_close')),
  note text,
  set_by uuid not null references public.users(id),
  set_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index squad_window_overrides_active_idx
  on public.squad_window_overrides (week_start_date)
  where deleted_at is null;

-- updated_at is written by the server module on every update (no trigger —
-- this project's convention, matches brand_settings/brand_assets).
select public.attach_audit('public.squad_window_overrides');

-- Perm seed: admins + loc + referees can flip the window.
insert into public.role_permissions (role, permission) values
  ('admin', 'squads.window.manage'),
  ('loc',   'squads.window.manage'),
  ('referee', 'squads.window.manage')
on conflict (role, permission) do nothing;

comment on table public.squad_window_overrides is
  'Admin override for the weekly squad submission window. Absence of an active row for a given week_start_date means the default time-based window applies.';
