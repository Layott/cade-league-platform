create or replace function public.on_disciplinary_action_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player_id uuid;
  v_season_id uuid;
begin
  select c.player_id into v_player_id
  from public.disciplinary_cases c
  where c.id = new.case_id;

  if v_player_id is null then
    return new;
  end if;

  for v_season_id in
    select sp.season_id
    from public.season_participants sp
    where sp.player_id = v_player_id
      and sp.deleted_at is null
  loop
    perform public.recompute_standings(v_season_id);
  end loop;

  return new;
end;
$$;

drop trigger if exists disciplinary_actions_recompute on public.disciplinary_actions;
create trigger disciplinary_actions_recompute
  after insert or update on public.disciplinary_actions
  for each row execute function public.on_disciplinary_action_change();
