-- 2026-04-27 — Per-match-day override for the squad submission window.
--
-- Plan 10 introduced a weekly window keyed on `week_start_date` (Thursday
-- anchor). Admins now want a finer-grained per-MATCH-DAY toggle so they can
-- reopen/close submissions for a specific match day independent of the
-- weekly cycle. The weekly override stays as the fallback; per-match-day
-- override (when present) takes precedence.
--
-- Keys:
--   match_day_id  — primary key, FK to match_days(id) cascade delete.
--   state         — 'force_open' or 'force_close'. Absence (or soft-delete)
--                   = fall through to the weekly resolver.
--
-- Cleared by soft-delete (deleted_at IS NOT NULL) so the audit trigger
-- still captures who flipped what, when. Mirrors the shape of
-- squad_window_overrides exactly except for the keying column.

create table public.squad_match_day_overrides (
  match_day_id uuid primary key references public.match_days(id) on delete cascade,
  state        text not null check (state in ('force_open', 'force_close')),
  note         text,
  set_by       uuid not null references public.users(id),
  set_at       timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index squad_match_day_overrides_active_idx
  on public.squad_match_day_overrides (match_day_id)
  where deleted_at is null;

select public.attach_audit('public.squad_match_day_overrides');

-- RLS posture matches squad_window_overrides — deny all from anon/authed,
-- callers go through the API/perms layer with the service-role client.
alter table public.squad_match_day_overrides enable row level security;

-- Permission re-uses the existing seed (admin/loc/referee already have
-- 'squads.window.manage' from migration 20260514000100). No new perm row
-- needed — both override flavours share the gate.

comment on table public.squad_match_day_overrides is
  'Admin override for the per-match-day squad submission window. Takes precedence over squad_window_overrides (weekly mode). Absence of an active row falls through to the weekly resolver.';

-- Stamp squad_submissions with the match_day_id when a player submits
-- through the per-match-day flow. Plan 10 weekly submissions leave this
-- null. FK is nullable + soft-delete-aware via on delete set null so a
-- match-day rebuild doesn't strand submission rows.
alter table public.squad_submissions
  add column if not exists match_day_id uuid references public.match_days(id) on delete set null;

create index if not exists squad_submissions_match_day_idx
  on public.squad_submissions (match_day_id)
  where deleted_at is null and match_day_id is not null;

comment on column public.squad_submissions.match_day_id is
  'Optional link to the match_day this submission was filed against. Populated when admin uses the per-match-day window override flow; null for weekly-mode submissions.';
