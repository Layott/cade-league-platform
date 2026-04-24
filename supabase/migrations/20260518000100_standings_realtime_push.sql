-- Audit Slice 3 (2026-04-24) — push a Realtime broadcast at the end of
-- recompute_standings() so public /standings + /profile pages can live-
-- refresh instead of waiting up to 60s for the SSR cache to revalidate.
--
-- Channel topic: public:standings:<seasonId>
-- Event name:    standings.changed
-- Payload:       { seasonId, at } — consumers re-query for fresh data.
--
-- Uses Supabase's built-in realtime.send(payload jsonb, event text,
-- topic text, private bool default false) which broadcasts on the
-- Realtime channel without requiring the row to land in the WAL.
-- Subscribers authenticate via the regular supabase-js client.
--
-- Idempotency: this migration only REPLACES the function body; it does
-- not touch the trigger wired up in 20260423000007. The rebuild logic
-- at the top of the function is identical to 20260424000003 (the last
-- punishment-aware version) plus an appended realtime.send() at the
-- very end. If realtime.send fails (e.g. Realtime down, missing schema)
-- the exception is swallowed so score-entry transactions are never
-- blocked by a broadcast failure — the standings row is the durable
-- record; the broadcast is just the wake-up signal.

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

  -- Audit Slice 3 — broadcast on a public Realtime topic so the
  -- standings page + each player's profile page can live-refresh.
  -- Topic is per-season so multi-season layouts later can subscribe
  -- to just the season they care about without cross-talk.
  begin
    perform realtime.send(
      jsonb_build_object(
        'seasonId', p_season_id,
        'at',       now()
      ),
      'standings.changed',
      'public:standings:' || p_season_id::text,
      false  -- public channel; anon clients can subscribe
    );
  exception when others then
    -- Never fail a standings recompute because a broadcast could not
    -- be published (Realtime outage, schema drift, etc). The standings
    -- row is the durable record; the broadcast is only the wake-up.
    raise warning 'standings realtime broadcast failed: %', sqlerrm;
  end;
end;
$$;

comment on function public.recompute_standings(uuid) is
  'Idempotent rebuild of public.standings for one season. Broadcasts '
  '`standings.changed` on `public:standings:<seasonId>` via realtime.send '
  'so public /standings + /profile pages can live-refresh.';
