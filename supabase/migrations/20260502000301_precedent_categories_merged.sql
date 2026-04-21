-- Plan 11 × Plan 13 reconciliation (part 2): disciplinary_precedents.category
-- must also accept 'preseason_miss' so the precedent trigger can mirror any
-- Plan 13 disciplinary_cases insert. This is a superset of Plan 11's
-- original allowlist.

alter table public.disciplinary_precedents
  drop constraint if exists disciplinary_precedents_category_check;

alter table public.disciplinary_precedents
  add constraint disciplinary_precedents_category_check
    check (category in (
      'late_arrival','absent','unauthorized_access','equipment',
      'social_media','betting','match_fixing','dress_code','forfeit',
      'preseason_miss','other'
    ));
