-- Plan 12 — seed the 7 overlay templates.
-- template_key matches the path segment under /overlay/<key>.
-- Idempotent via `on conflict (template_key) do nothing` so re-running is
-- a no-op even after an admin toggles active_bool.
insert into public.overlay_templates (template_key, template_type, name, html_route)
values
  ('scorebar',           'scorebar',           'Scorebar',            '/overlay/scorebar'),
  ('lower_third',        'lower_third',        'Lower Third',         '/overlay/lower-third'),
  ('standings_widget',   'standings_widget',   'Standings Widget',    '/overlay/standings-widget'),
  ('player_card',        'player_card',        'Player Card',         '/overlay/player-card'),
  ('punishment_ticker',  'punishment_ticker',  'Punishment Ticker',   '/overlay/punishment-ticker'),
  ('intro',              'intro',              'Match Day Intro',     '/overlay/intro'),
  ('outro',              'outro',              'Match Day Outro',     '/overlay/outro')
on conflict (template_key) do nothing;
