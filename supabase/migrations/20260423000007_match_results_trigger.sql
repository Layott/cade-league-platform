-- On any mutation of match_results, recompute affected season's standings
-- synchronously in same transaction. Drafts are filtered inside recompute.

create or replace function public.match_results_recompute_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season_id uuid;
  v_match_id  uuid;
begin
  if tg_op = 'DELETE' then
    v_match_id := old.match_id;
  else
    v_match_id := new.match_id;
  end if;

  select m.season_id into v_season_id
    from public.matches m
    where m.id = v_match_id;

  if v_season_id is not null then
    perform public.recompute_standings(v_season_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

drop trigger if exists match_results_recompute on public.match_results;
create trigger match_results_recompute
  after insert or update or delete on public.match_results
  for each row execute function public.match_results_recompute_trigger();
