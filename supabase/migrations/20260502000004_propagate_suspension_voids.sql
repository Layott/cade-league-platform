-- Plan 11 Task 5: void-match propagation per Rule §3.4.4.2.
--
-- When a sanction_type='ban' disciplinary_action is inserted (or its dates
-- are changed), every scheduled match involving the suspended player whose
-- match_day.match_date lies in [effective_from, effective_until] is voided:
--   - match_results row UPSERTed with result_type='void', 0-0
--   - matches.status flipped to 'voided'
--   - standings.recompute invoked once at the end
--
-- The void rows are tagged via their `notes` field with a unique marker
-- tied to the imposing action id, so `unpropagate_suspension_voids` can
-- reverse only its own writes and leave manually-entered results intact.
--
-- Uses existing recompute_standings (Plan 3 + punishment-aware Plan 4),
-- which already filters `mr.result_type in ('normal','forfeit')` — voids
-- therefore contribute zero to matches_played / GD / points.

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
      entered_by, confirmed_by, confirmed_at, notes
    )
    values (
      r.match_id, 0, 0, 'void',
      v_actor_user_id, v_actor_user_id, now(),
      format('auto-voided: suspension action %s', p_action_id)
    )
    on conflict (match_id) do update
      set result_type  = 'void',
          home_score   = 0,
          away_score   = 0,
          confirmed_by = excluded.confirmed_by,
          confirmed_at = excluded.confirmed_at,
          notes        = excluded.notes,
          updated_at   = now();

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
      and notes = format('auto-voided: suspension action %s', p_action_id)
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
