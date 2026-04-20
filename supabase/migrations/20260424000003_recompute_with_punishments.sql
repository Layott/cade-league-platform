-- Supersede Plan 3's recompute_standings with punishment-aware version.
-- Same signature; same idempotency contract.

create or replace function public.recompute_standings(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.standings where season_id = p_season_id;

  insert into public.standings (
    season_id, player_id,
    matches_played, wins, draws, losses,
    goals_for, goals_against, goal_difference,
    points,
    punishment_points_deducted, punishment_gd_deducted,
    updated_at
  )
  with participants as (
    select sp.player_id
    from public.season_participants sp
    where sp.season_id = p_season_id
      and sp.deleted_at is null
  ),
  match_agg as (
    select
      p.player_id,
      count(distinct mr.id)                                                          as matches_played,
      sum(case
            when (m.home_player_id = p.player_id and mr.home_score > mr.away_score)
              or (m.away_player_id = p.player_id and mr.away_score > mr.home_score)
            then 1 else 0 end)                                                       as wins,
      sum(case when mr.home_score = mr.away_score and mr.id is not null then 1 else 0 end) as draws,
      sum(case
            when (m.home_player_id = p.player_id and mr.home_score < mr.away_score)
              or (m.away_player_id = p.player_id and mr.away_score < mr.home_score)
            then 1 else 0 end)                                                       as losses,
      sum(case when m.home_player_id = p.player_id then mr.home_score
               when m.away_player_id = p.player_id then mr.away_score
               else 0 end)                                                           as goals_for,
      sum(case when m.home_player_id = p.player_id then mr.away_score
               when m.away_player_id = p.player_id then mr.home_score
               else 0 end)                                                           as goals_against
    from participants p
    left join public.matches m
      on (m.home_player_id = p.player_id or m.away_player_id = p.player_id)
     and m.season_id = p_season_id
     and m.deleted_at is null
    left join public.match_results mr
      on mr.match_id = m.id
     and mr.result_type in ('normal','forfeit')
     and mr.deleted_at is null
     and mr.confirmed_at is not null
    group by p.player_id
  ),
  punishment_agg as (
    select
      c.player_id,
      coalesce(sum(case when a.sanction_type = 'point_deduction' then a.magnitude else 0 end), 0) as pts_ded,
      coalesce(sum(case when a.sanction_type = 'gd_deduction'    then a.magnitude else 0 end), 0) as gd_ded
    from public.disciplinary_cases c
    join public.disciplinary_actions a
      on a.case_id = c.id
     and a.deleted_at is null
     and a.revoked_at is null
     and a.sanction_type in ('point_deduction','gd_deduction')
    where c.deleted_at is null
      and (
        c.match_id is null
        or exists (
          select 1 from public.matches m2
          where m2.id = c.match_id
            and m2.season_id = p_season_id
            and m2.deleted_at is null
        )
      )
    group by c.player_id
  )
  select
    p_season_id,
    p.player_id,
    coalesce(ma.matches_played, 0),
    coalesce(ma.wins, 0),
    coalesce(ma.draws, 0),
    coalesce(ma.losses, 0),
    coalesce(ma.goals_for, 0),
    coalesce(ma.goals_against, 0),
    coalesce(ma.goals_for, 0) - coalesce(ma.goals_against, 0) - coalesce(pa.gd_ded, 0),
    (coalesce(ma.wins, 0) * 3 + coalesce(ma.draws, 0)) - coalesce(pa.pts_ded, 0),
    coalesce(pa.pts_ded, 0),
    coalesce(pa.gd_ded, 0),
    now()
  from participants p
  left join match_agg      ma on ma.player_id = p.player_id
  left join punishment_agg pa on pa.player_id = p.player_id;
end;
$$;
