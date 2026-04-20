-- attendance_marks: one row per player per match day.
-- status tracks Present/Late/Absent; marked_at is wall clock of the mark;
-- scheduled_call_time is captured at mark-time (match_day.match_start_time − arrival_cutoff)
-- so later edits to the match_day don't rewrite history.
-- delta_seconds = marked_at − scheduled_call_time (negative = early).
-- override_reason is required (and set) whenever an existing row is edited.
-- auto_action_id points to the disciplinary_action created for late/absent so
-- editMark can revoke it idempotently without searching.

create table public.attendance_marks (
  id                   uuid primary key default gen_random_uuid(),
  match_day_id         uuid not null references public.match_days (id) on delete cascade,
  player_id            uuid not null references public.players (id) on delete cascade,
  status               text not null check (status in ('present','late','absent')),
  marked_at            timestamptz not null default now(),
  marked_by            uuid not null references public.users (id),
  scheduled_call_time  timestamptz not null,
  delta_seconds        int not null,
  override_reason      text,
  auto_case_id         uuid references public.disciplinary_cases (id),
  auto_action_id       uuid references public.disciplinary_actions (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (match_day_id, player_id)
);

create index attendance_marks_match_day_idx
  on public.attendance_marks (match_day_id)
  where deleted_at is null;

create index attendance_marks_player_idx
  on public.attendance_marks (player_id)
  where deleted_at is null;

create index attendance_marks_status_idx
  on public.attendance_marks (match_day_id, status)
  where deleted_at is null;

select public.attach_audit('public.attendance_marks');
