-- Fully rebuilds public.standings rows for one season. Idempotent.
-- Draft results (confirmed_at IS NULL) are excluded.
-- Void results are excluded. Forfeit + normal count.

create or replace function public.recompute_standings(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.standings
    where season_id = p_season_id;

  insert into public.standings (
    season_id, player_id,
    matches_played, wins, draws, losses,
    goals_for, goals_against, goal_difference, points,
    punishment_points_deducted, punishment_gd_deducted,
    updated_at
  )
  with
  participants as (
    select sp.player_id
      from public.season_participants sp
      where sp.season_id = p_season_id
        and sp.deleted_at is null
  ),
  confirmed_results as (
    select m.id as match_id,
           m.home_player_id,
           m.away_player_id,
           mr.home_score,
           mr.away_score,
           mr.result_type
      from public.matches m
      join public.match_results mr on mr.match_id = m.id
      where m.season_id = p_season_id
        and m.deleted_at is null
        and mr.deleted_at is null
        and mr.confirmed_at is not null
        and mr.result_type in ('normal','forfeit')
  ),
  per_player as (
    select home_player_id as player_id,
           home_score as gf,
           away_score as ga,
           case when home_score > away_score then 1 else 0 end as win,
           case when home_score = away_score then 1 else 0 end as draw,
           case when home_score < away_score then 1 else 0 end as loss
      from confirmed_results
    union all
    select away_player_id as player_id,
           away_score as gf,
           home_score as ga,
           case when away_score > home_score then 1 else 0 end as win,
           case when away_score = home_score then 1 else 0 end as draw,
           case when away_score < home_score then 1 else 0 end as loss
      from confirmed_results
  ),
  aggregated as (
    select p.player_id,
           coalesce(sum(pp.win + pp.draw + pp.loss), 0)::int as matches_played,
           coalesce(sum(pp.win), 0)::int                     as wins,
           coalesce(sum(pp.draw), 0)::int                    as draws,
           coalesce(sum(pp.loss), 0)::int                    as losses,
           coalesce(sum(pp.gf), 0)::int                      as goals_for,
           coalesce(sum(pp.ga), 0)::int                      as goals_against
      from participants p
      left join per_player pp on pp.player_id = p.player_id
      group by p.player_id
  )
  select p_season_id,
         a.player_id,
         a.matches_played,
         a.wins, a.draws, a.losses,
         a.goals_for, a.goals_against,
         (a.goals_for - a.goals_against) as goal_difference,
         (a.wins * 3 + a.draws)          as points,
         0  as punishment_points_deducted,
         0  as punishment_gd_deducted,
         now()
    from aggregated a;
end;
$$;

comment on function public.recompute_standings(uuid) is
  'Idempotent rebuild of public.standings for one season.';
