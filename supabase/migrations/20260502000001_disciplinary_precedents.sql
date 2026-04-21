-- Plan 11 Task 2: disciplinary_precedents — first-class per-player per-category
-- offence counter that drives Rule 5.4 ladder progression. Composite PK
-- (player_id, category) ensures one row per combination; `id` is kept as a
-- secondary uuid so the audit trigger has a stable row identity.
--
-- Maintained by triggers in `20260502000003_precedent_upsert_trigger.sql`
-- (attendance_marks INSERT and disciplinary_cases INSERT for non-attendance
-- categories). Backfill lives in `20260502000007_backfill_precedents.sql`.

create table public.disciplinary_precedents (
  id                uuid        not null default gen_random_uuid(),
  player_id         uuid        not null references public.players (id) on delete restrict,
  category          text        not null check (category in (
    'late_arrival','absent','unauthorized_access','equipment',
    'social_media','betting','match_fixing','other','forfeit','dress_code'
  )),
  offense_count     int         not null default 0 check (offense_count >= 0),
  last_offense_at   timestamptz,
  last_case_id      uuid        references public.disciplinary_cases (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  primary key (player_id, category)
);

create index disciplinary_precedents_id_idx
  on public.disciplinary_precedents (id);

create index disciplinary_precedents_active_idx
  on public.disciplinary_precedents (player_id, category)
  where deleted_at is null;

select public.attach_audit('public.disciplinary_precedents');
