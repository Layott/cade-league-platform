-- Plan 11 × Plan 13 reconciliation: both plans narrow
-- disciplinary_cases.incident_type to their own allowlist. This migration
-- is numbered AFTER both (20260502000002 from Plan 11 and 20260502000203
-- from Plan 13) so it wins and contains the UNION of every category any
-- plan needs.
--
-- Adds:
--   Plan 11 — 'absent', 'unauthorized_access', 'betting', 'match_fixing',
--             'dress_code'
--   Plan 13 — 'preseason_miss'
-- Preserves Phase 1A originals — 'late_arrival', 'forfeit', 'equipment',
-- 'social_media', 'other'.

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
