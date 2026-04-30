-- Extend `overlay_templates.template_type` CHECK to include the new
-- `player_squads` legacy template_key, and seed the `overlay_templates`
-- row that the broadcast-v2 ControlGrid → triggerOverlayAction pipeline
-- joins through (`overlay_events.template_id` → `overlay_templates`).
--
-- Without this row, the v2 player-squads control button would 500 on
-- Trigger because `triggerOverlayAction` looks up the template_id by
-- `template_key='player_squads'` first.
--
-- Mirrors the pattern in:
--   - 20260508000010_plan16_stinger_miss.sql
--   - 20260510000100_plan44_youtube_bind.sql

-- ---- (1) Extend CHECK -----------------------------------------------

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
    'stinger_miss',
    -- Plan 44 (1)
    'featured_comment',
    -- 2026-04-30 (1)
    'player_squads'
  ));

-- ---- (2) Seed the template row --------------------------------------

insert into public.overlay_templates (template_key, template_type, name, html_route)
values (
  'player_squads',
  'player_squads',
  'Player Squads',
  '/overlay/v2/19-player-squads'
)
on conflict (template_key) do nothing;
