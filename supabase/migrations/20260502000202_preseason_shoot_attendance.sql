-- Plan 13A: Pre-season shoot attendance (D)
-- Player × shoot roster row. Absent players auto-issued a warning per Rule 2.5
-- via server/preseason/attendance.ts → punishments.issue (incident_type =
-- 'preseason_miss'). warning_issued_bool set true to keep the auto-warning
-- idempotent on re-save.

create table public.preseason_shoot_attendance (
  id                    uuid primary key default gen_random_uuid(),
  shoot_id              uuid not null references public.preseason_shoots (id) on delete restrict,
  player_id             uuid not null references public.players (id) on delete restrict,
  attended_bool         boolean not null default false,
  warning_issued_bool   boolean not null default false,
  warning_action_id     uuid references public.disciplinary_actions (id) on delete set null,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create unique index preseason_attendance_unique
  on public.preseason_shoot_attendance (shoot_id, player_id)
  where deleted_at is null;

create index preseason_attendance_shoot_idx
  on public.preseason_shoot_attendance (shoot_id)
  where deleted_at is null;

select public.attach_audit('public.preseason_shoot_attendance');
