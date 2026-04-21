-- Plan 13A: extend disciplinary_cases.incident_type enum with 'preseason_miss'
-- so attendance.markAttendance can call punishments.issue for absent players.
--
-- Must preserve Plan 11's extended enum (absent, unauthorized_access, betting,
-- match_fixing, dress_code). Order of migration application guarantees
-- Plan 11's 20260502000002_extend_incident_types.sql runs first (numerically
-- earlier in the 20260502000002 → 20260502000203 sequence).

alter table public.disciplinary_cases
  drop constraint if exists disciplinary_cases_incident_type_check;

alter table public.disciplinary_cases
  add constraint disciplinary_cases_incident_type_check
  check (incident_type in (
    'late_arrival',
    'absent',
    'forfeit',
    'equipment',
    'social_media',
    'unauthorized_access',
    'betting',
    'match_fixing',
    'dress_code',
    'preseason_miss',
    'other'
  ));
