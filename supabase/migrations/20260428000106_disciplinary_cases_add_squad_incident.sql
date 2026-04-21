-- Plan 10 — extend disciplinary_cases.incident_type to allow the
-- 'squad_late_submission' bucket used by the Thursday 10:00 WAT cron
-- auto-warning ladder.
alter table public.disciplinary_cases
  drop constraint if exists disciplinary_cases_incident_type_check;

alter table public.disciplinary_cases
  add constraint disciplinary_cases_incident_type_check check (
    incident_type in (
      'late_arrival',
      'forfeit',
      'equipment',
      'social_media',
      'squad_late_submission',
      'other'
    )
  );
