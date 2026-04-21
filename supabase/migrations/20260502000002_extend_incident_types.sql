-- Plan 11 Task 3: extend disciplinary_cases.incident_type check to cover
-- every ladder category. Existing values are preserved; adds
-- 'equipment' was already there; adds 'unauthorized_access','betting',
-- 'match_fixing','dress_code'. `other` already present. `forfeit` already
-- present (Plan 4 used it for auto-forfeit cases).

alter table public.disciplinary_cases
  drop constraint disciplinary_cases_incident_type_check;

alter table public.disciplinary_cases
  add constraint disciplinary_cases_incident_type_check
    check (incident_type in (
      'late_arrival','absent','forfeit','equipment','social_media',
      'unauthorized_access','betting','match_fixing','dress_code','other'
    ));
