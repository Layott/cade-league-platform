-- Plan 11 Task 3 (continued): widen disciplinary_cases.status check to
-- include 'auto' so the ladder can attach a lightweight case row to every
-- auto-sanction event (including 1st-late "log only" offences). Admin cases
-- list filters `status='auto'` by default.
--
-- No existing rows use 'auto' (Plan 4-10 only wrote 'open'/'resolved'), so
-- widening the constraint is safe.

alter table public.disciplinary_cases
  drop constraint disciplinary_cases_status_check;

alter table public.disciplinary_cases
  add constraint disciplinary_cases_status_check
    check (status in ('auto','open','resolved'));
