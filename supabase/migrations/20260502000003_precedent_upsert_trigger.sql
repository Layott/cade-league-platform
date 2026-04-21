-- Plan 11 Task 4: automatic precedent upsert.
--
-- `upsert_precedent` is the single entry point: bump +1 for (player, category),
-- stamp last_offense_at/last_case_id, leave deleted_at rows alone.
--
-- Two triggers call it:
--   1. attendance_marks AFTER INSERT — drives 'late_arrival' + 'absent'.
--   2. disciplinary_cases AFTER INSERT — drives all other categories
--      (unauthorized_access, equipment, social_media, betting, match_fixing,
--      dress_code, other, forfeit). `late_arrival`/`absent` cases are
--      SKIPPED here because attendance_marks is already the source-of-truth
--      for those; counting a case row as well would double-count.

create or replace function public.upsert_precedent(
  p_player_id uuid,
  p_category  text,
  p_case_id   uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.disciplinary_precedents (player_id, category, offense_count, last_offense_at, last_case_id)
  values (p_player_id, p_category, 1, now(), p_case_id)
  on conflict (player_id, category) do update
    set offense_count   = public.disciplinary_precedents.offense_count + 1,
        last_offense_at = now(),
        last_case_id    = coalesce(excluded.last_case_id, public.disciplinary_precedents.last_case_id),
        updated_at      = now()
  where public.disciplinary_precedents.deleted_at is null;
end;
$$;

create or replace function public.on_attendance_mark_precedent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_category text;
begin
  if tg_op = 'INSERT' then
    if new.status in ('late','absent') and new.deleted_at is null then
      v_category := case new.status when 'late' then 'late_arrival' else 'absent' end;
      perform public.upsert_precedent(new.player_id, v_category, new.auto_case_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_marks_precedent on public.attendance_marks;
create trigger attendance_marks_precedent
  after insert on public.attendance_marks
  for each row execute function public.on_attendance_mark_precedent();

create or replace function public.on_disciplinary_case_precedent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT'
     and new.deleted_at is null
     and new.incident_type in (
       'unauthorized_access','equipment','social_media','betting','match_fixing',
       'dress_code','other','forfeit'
     )
  then
    perform public.upsert_precedent(new.player_id, new.incident_type, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists disciplinary_cases_precedent on public.disciplinary_cases;
create trigger disciplinary_cases_precedent
  after insert on public.disciplinary_cases
  for each row execute function public.on_disciplinary_case_precedent();
