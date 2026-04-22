-- Plan 16 amendment — add `stinger_miss` template_type + seed row.
-- Sibling of `stinger_goal`; fired when a penalty / shot goes wide.
--
-- Postgres cannot extend a CHECK in place — drop + recreate with the
-- superset list. Copied verbatim from
-- 20260505000003_plan16_overlay_template_types.sql and appended
-- 'stinger_miss'. Idempotent.

alter table public.overlay_templates
  drop constraint if exists overlay_templates_template_type_check;

alter table public.overlay_templates
  add constraint overlay_templates_template_type_check
  check (template_type in (
    -- Plan 12 originals (7)
    'lower_third','scorebar','standings_widget','player_card',
    'punishment_ticker','intro','outro',
    -- Plan 16 additions (20)
    'stinger_intro','stinger_normal','stinger_replay','stinger_goal','stinger_winner',
    'layout_4pip','layout_2pip','layout_brb_full','layout_brb_basic','layout_timer',
    'layout_animated_bg','layout_casters_chat',
    'h2h_2','h2h_3','h2h_5',
    'leaderboard_animated','score_bug','up_next_bug','match_scores_day',
    'starting_soon_basic','starting_soon_timer','stream_ended',
    'top_scorers','orgs_roster','coach_intros','player_penalties',
    -- Plan 16 amended (1)
    'stinger_miss'
  ));

-- Seed the stinger_miss row. Column names match the table definition
-- (template_key, template_type, name, html_route).
insert into public.overlay_templates (template_key, template_type, name, html_route)
values
  ('stinger_miss', 'stinger_miss', 'Miss Stinger (2s)', '/overlay/stinger-miss')
on conflict (template_key) do nothing;
