-- Plan 16 — extend overlay_templates.template_type CHECK with 20 new keys
-- and seed the corresponding rows. Idempotent.
--
-- The Plan 12 CHECK is replaced (drop + recreate) because Postgres does
-- not support extending an inline CHECK in place. All existing rows are
-- covered by the superset.

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
    'top_scorers','orgs_roster','coach_intros','player_penalties'
  ));

-- Seed the 20 new rows. html_route matches /overlay/<kebab-case-of-key>.
insert into public.overlay_templates (template_key, template_type, name, html_route)
values
  ('stinger_intro',         'stinger_intro',         'Intro Stinger (10s)',        '/overlay/stinger-intro'),
  ('stinger_normal',        'stinger_normal',        'Normal Stinger (2s)',        '/overlay/stinger-normal'),
  ('stinger_replay',        'stinger_replay',        'Replay Stinger (2s)',        '/overlay/stinger-replay'),
  ('stinger_goal',          'stinger_goal',          'Goal Stinger (2s)',          '/overlay/stinger-goal'),
  ('stinger_winner',        'stinger_winner',        'Winner Stinger (2s)',        '/overlay/stinger-winner'),
  ('layout_4pip',           'layout_4pip',           '4-PIP Layout',               '/overlay/layout-4pip'),
  ('layout_2pip',           'layout_2pip',           '2-PIP Layout',               '/overlay/layout-2pip'),
  ('layout_brb_full',       'layout_brb_full',       'BRB (Ad + Timer)',           '/overlay/layout-brb-full'),
  ('layout_brb_basic',      'layout_brb_basic',      'BRB (Basic)',                '/overlay/layout-brb-basic'),
  ('layout_timer',          'layout_timer',          'Timer (Composable)',         '/overlay/layout-timer'),
  ('layout_animated_bg',    'layout_animated_bg',    'Animated Background',        '/overlay/layout-animated-bg'),
  ('layout_casters_chat',   'layout_casters_chat',   'Casters + Chat',             '/overlay/layout-casters-chat'),
  ('h2h_2',                 'h2h_2',                 'H2H Matchup (2-player)',     '/overlay/h2h-2'),
  ('h2h_3',                 'h2h_3',                 'H2H Matchup (3-player)',     '/overlay/h2h-3'),
  ('h2h_5',                 'h2h_5',                 'H2H Matchup (5-player)',     '/overlay/h2h-5'),
  ('leaderboard_animated',  'leaderboard_animated',  'Animated Leaderboard',       '/overlay/leaderboard-animated'),
  ('score_bug',             'score_bug',             'Score Bug',                  '/overlay/score-bug'),
  ('up_next_bug',           'up_next_bug',           'Up Next Bug',                '/overlay/up-next-bug'),
  ('match_scores_day',      'match_scores_day',      'Match Scores For The Day',   '/overlay/match-scores-day'),
  ('starting_soon_basic',   'starting_soon_basic',   'Starting Soon (Basic)',      '/overlay/starting-soon-basic'),
  ('starting_soon_timer',   'starting_soon_timer',   'Starting Soon (Timer + Ad)', '/overlay/starting-soon-timer'),
  ('stream_ended',          'stream_ended',          'Stream Ended',               '/overlay/stream-ended'),
  ('top_scorers',           'top_scorers',           'Top 10 Goal Scorers',        '/overlay/top-scorers'),
  ('orgs_roster',           'orgs_roster',           'Registered Orgs / Teams',    '/overlay/orgs-roster'),
  ('coach_intros',          'coach_intros',          'Coach Intros',               '/overlay/coach-intros'),
  ('player_penalties',      'player_penalties',      'Player Penalties',           '/overlay/player-penalties')
on conflict (template_key) do nothing;
