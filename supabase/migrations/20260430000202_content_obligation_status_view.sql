-- Plan 13A: Content obligation status view (C)
-- Aggregates content_posts per (player, week); `met` = verified posts across
-- >=2 distinct platforms. Live-updating — as moderators verify/reject posts
-- the view immediately reflects the new state.

create or replace view public.content_obligation_status as
select
  player_id,
  week_start,
  count(*)                                           as post_count,
  count(distinct platform) filter (where verification_status = 'verified')
                                                     as verified_platforms,
  (count(distinct platform) filter (where verification_status = 'verified')) >= 2
                                                     as met
from public.content_posts
where deleted_at is null
group by player_id, week_start;
