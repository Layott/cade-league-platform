-- Plan 11 Task 17: backfill disciplinary_precedents from historical
-- attendance_marks + disciplinary_cases rows.
--
-- Idempotent: ON CONFLICT (player_id, category) DO UPDATE replaces the
-- cached counter with the re-computed value (not an incremental bump),
-- so re-running the migration against a live DB produces the same state
-- as running it once.
--
-- Attendance-category rows come from attendance_marks (source of truth).
-- Other categories come from disciplinary_cases (manual IDC/referee files).
-- Case incident_types 'late_arrival' + 'absent' are SKIPPED here; those
-- precedents come exclusively from attendance_marks so we don't double-count
-- the auto-case rows that attendance/penalty.ts inserts.

insert into public.disciplinary_precedents (player_id, category, offense_count, last_offense_at, last_case_id)
select
  am.player_id,
  case am.status when 'late' then 'late_arrival' else 'absent' end as category,
  count(*) as offense_count,
  max(am.marked_at) as last_offense_at,
  (array_agg(am.auto_case_id order by am.marked_at desc))[1] as last_case_id
from public.attendance_marks am
where am.deleted_at is null
  and am.status in ('late','absent')
group by am.player_id, am.status
on conflict (player_id, category) do update
  set offense_count   = excluded.offense_count,
      last_offense_at = excluded.last_offense_at,
      last_case_id    = coalesce(excluded.last_case_id, public.disciplinary_precedents.last_case_id),
      updated_at      = now();

insert into public.disciplinary_precedents (player_id, category, offense_count, last_offense_at, last_case_id)
select
  c.player_id,
  c.incident_type as category,
  count(*),
  max(c.opened_at),
  (array_agg(c.id order by c.opened_at desc))[1]
from public.disciplinary_cases c
where c.deleted_at is null
  and c.incident_type in (
    'unauthorized_access','equipment','social_media','betting','match_fixing',
    'dress_code','other','forfeit'
  )
group by c.player_id, c.incident_type
on conflict (player_id, category) do update
  set offense_count   = excluded.offense_count,
      last_offense_at = excluded.last_offense_at,
      last_case_id    = coalesce(excluded.last_case_id, public.disciplinary_precedents.last_case_id),
      updated_at      = now();
