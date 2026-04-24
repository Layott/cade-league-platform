-- Plan 50 (2026-04-24): upgrade the Plan 11 void-propagation helpers so
-- that (a) they populate the new match_results.voided_by_action_id column
-- and (b) they fire on UN-revoke (admin undoes an appeal upheld, resetting
-- disciplinary_actions.revoked_at back to NULL).
--
-- Matches the original Plan 11 functions exactly except for:
--   * insert/update now sets `voided_by_action_id = p_action_id`
--   * unpropagate queries by the column, not the free-text `notes` marker
--     (falls back to the marker for pre-Plan-50 rows that weren't backfilled
--      at migration time)
--   * new trigger branch: UPDATE where old.revoked_at is not null AND
--     new.revoked_at is null AND sanction_type='ban' → re-propagate.

create or replace function public.propagate_suspension_voids(p_action_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player_id       uuid;
  v_effective_from  date;
  v_effective_until date;
  v_actor_user_id   uuid;
  v_season_id       uuid;
  v_void_count      int := 0;
  r                 record;
begin
  select c.player_id,
         a.effective_from,
         a.effective_until,
         a.imposed_by
    into v_player_id, v_effective_from, v_effective_until, v_actor_user_id
    from public.disciplinary_actions a
    join public.disciplinary_cases   c on c.id = a.case_id
    where a.id = p_action_id
      and a.deleted_at is null
      and a.revoked_at is null
      and a.sanction_type = 'ban';

  if v_player_id is null then
    return 0;
  end if;

  if v_effective_from is null or v_effective_until is null then
    raise exception 'propagate_suspension_voids: action % missing effective_from/until', p_action_id;
  end if;

  for r in
    select m.id            as match_id,
           m.season_id,
           m.home_player_id,
           m.away_player_id
      from public.matches m
      join public.match_days md on md.id = m.match_day_id
     where m.deleted_at is null
       and md.deleted_at is null
       and (m.home_player_id = v_player_id or m.away_player_id = v_player_id)
       and md.match_date between v_effective_from and v_effective_until
  loop
    insert into public.match_results (
      match_id, home_score, away_score, result_type,
      entered_by, confirmed_by, confirmed_at, notes,
      voided_by_action_id
    )
    values (
      r.match_id, 0, 0, 'void',
      v_actor_user_id, v_actor_user_id, now(),
      format('auto-voided: suspension action %s', p_action_id),
      p_action_id
    )
    on conflict (match_id) do update
      set result_type          = 'void',
          home_score           = 0,
          away_score           = 0,
          confirmed_by         = excluded.confirmed_by,
          confirmed_at         = excluded.confirmed_at,
          notes                = excluded.notes,
          voided_by_action_id  = excluded.voided_by_action_id,
          updated_at           = now();

    update public.matches
       set status = 'voided'
     where id = r.match_id;

    v_season_id := r.season_id;
    v_void_count := v_void_count + 1;
  end loop;

  if v_season_id is not null then
    perform public.recompute_standings(v_season_id);
  end if;

  return v_void_count;
end;
$$;

create or replace function public.unpropagate_suspension_voids(p_action_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_season_id uuid; v_count int := 0; r record;
begin
  for r in
    delete from public.match_results
    where result_type = 'void'
      and (
        voided_by_action_id = p_action_id
        or (voided_by_action_id is null
            and notes = format('auto-voided: suspension action %s', p_action_id))
      )
    returning match_id
  loop
    update public.matches m
       set status = 'scheduled'
     where m.id = r.match_id
     returning m.season_id into v_season_id;
    v_count := v_count + 1;
  end loop;

  if v_season_id is not null then
    perform public.recompute_standings(v_season_id);
  end if;
  return v_count;
end;
$$;

--
-- Trigger: extend Plan 11's on_ban_action_change to handle UN-revoke.
-- When admin upholds an appeal the linked action is revoked; when the admin
-- then UNDOES the upheld decision, revoked_at goes back to NULL and we
-- re-propagate the voids.
--
create or replace function public.on_ban_action_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.sanction_type = 'ban'
       and new.deleted_at is null and new.revoked_at is null then
    perform public.propagate_suspension_voids(new.id);
  elsif tg_op = 'UPDATE' then
    if old.revoked_at is null and new.revoked_at is not null and new.sanction_type = 'ban' then
      perform public.unpropagate_suspension_voids(new.id);
    elsif old.revoked_at is not null and new.revoked_at is null
            and new.sanction_type = 'ban'
            and new.deleted_at is null then
      -- Plan 50: undo-revoke (e.g. admin reverses an upheld appeal) →
      -- re-propagate voids for the freshly-live ban window.
      perform public.propagate_suspension_voids(new.id);
    elsif old.deleted_at is null and new.deleted_at is not null and new.sanction_type = 'ban' then
      perform public.unpropagate_suspension_voids(new.id);
    elsif new.sanction_type = 'ban'
       and new.deleted_at is null
       and new.revoked_at is null
       and (
         coalesce(new.effective_from, '0001-01-01'::date) <> coalesce(old.effective_from, '0001-01-01'::date)
         or coalesce(new.effective_until, '0001-01-01'::date) <> coalesce(old.effective_until, '0001-01-01'::date)
       ) then
      perform public.unpropagate_suspension_voids(new.id);
      perform public.propagate_suspension_voids(new.id);
    end if;
  end if;
  return new;
end;
$$;

-- Trigger itself is already attached by Plan 11 migration 20260502000005;
-- we only replaced the underlying function body above.
