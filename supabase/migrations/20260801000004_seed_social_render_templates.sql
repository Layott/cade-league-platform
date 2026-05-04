-- Plan 54 — Broadcast Social Media (Wave 1A, migration 4/6).
--
-- Seed the 5 Phase-1 templates. Idempotent via ON CONFLICT (template_key)
-- DO NOTHING so re-runs against a partially-seeded DB are safe. To
-- update an existing template's metadata, ship a follow-up migration
-- with explicit UPDATE statements rather than mutating this seed.
--
-- `data_endpoint` holds the `{sessionId}` placeholder verbatim — the
-- caller substitutes it at render time. `scene_path` is set only for
-- templates that have an overlay HTML scene the video worker can boot;
-- the three pure-image templates (upcoming-fixtures, gd-leaders,
-- league-avg) leave it NULL and rely on the @vercel/og image renderer.
--
-- Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §4 (Seeds)

insert into public.social_render_templates
  (template_key, label, description, format, data_endpoint, default_supports_size, scene_path, active, sort_order)
values
  (
    'leaderboard',
    'Weekly Leaderboard',
    'Current Elite season standings — points, GD, goal totals.',
    'both',
    '/api/broadcast/sessions/{sessionId}/leaderboard',
    array['1080x1920','1080x1080','1200x675'],
    'KNOWLEDGE/brand-assets/elements/v2/07-leaderboard/index.html',
    true,
    10
  ),
  (
    'top-scorers',
    'Golden Boot Race',
    'Top scorers tracker for the current season.',
    'both',
    '/api/broadcast/sessions/{sessionId}/top-scorers',
    array['1080x1920','1080x1080'],
    'KNOWLEDGE/brand-assets/elements/v2/14-top-scorers/index.html',
    true,
    20
  ),
  (
    'upcoming-fixtures',
    'Upcoming Fixtures',
    'Next match-day fixture card — kickoff times + headshots.',
    'image',
    '/api/broadcast/sessions/{sessionId}/match-scores-day',
    array['1080x1080','1080x1920'],
    null,
    true,
    30
  ),
  (
    'gd-leaders',
    'Goal Difference Leaders',
    'Top players by goal differential — derived from leaderboard.',
    'image',
    '/api/broadcast/sessions/{sessionId}/leaderboard',
    array['1080x1080'],
    null,
    true,
    40
  ),
  (
    'league-avg',
    'League Average Stats',
    'Computed aggregate stats across the season — avg GPG, clean sheets, etc.',
    'image',
    '/api/broadcast/sessions/{sessionId}/leaderboard',
    array['1080x1080'],
    null,
    true,
    50
  )
on conflict (template_key) do nothing;
