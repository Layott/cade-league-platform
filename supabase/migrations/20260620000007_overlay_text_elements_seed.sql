-- Overlay Design Page v2 — Wave 2 Stage 1 (7/8)
-- ------------------------------------------------------------------
-- Seed `overlay_text_elements` with one row per (overlay_key,
-- element_id) listed in spec §8. Every row carries `origin='seed'`,
-- `content=''` (empty = "use HTML default"), and ALL typography
-- fields NULL so first deploy is a no-op — the resolver's effective
-- map is empty for these rows and the bootstrap script doesn't emit
-- any `<style id="cade-injected-text">` block.
--
-- Picks any admin user as `set_by` for FK satisfaction; if no admins
-- exist (fresh schema), falls back to any user; if still none, the
-- seed skips entirely (the runtime upsert path will create rows on
-- first admin save).
--
-- Idempotent — `ON CONFLICT (overlay_key, variant_id, element_id)
-- DO NOTHING` so re-running a partial deploy is safe.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §8
-- ------------------------------------------------------------------

do $$
declare
  v_set_by uuid;
begin
  select u.id into v_set_by
  from public.users u
  join public.user_roles ur on ur.user_id = u.id
                            and ur.role = 'admin'
                            and ur.deleted_at is null
  where u.deleted_at is null
  order by u.created_at asc
  limit 1;

  if v_set_by is null then
    select id into v_set_by
    from public.users
    where deleted_at is null
    order by created_at asc
    limit 1;
  end if;

  if v_set_by is null then
    raise notice 'overlay_text_elements seed: no users in public.users yet — skipping (runtime upsert will create rows on first admin save)';
    return;
  end if;

  insert into public.overlay_text_elements
    (overlay_key, variant_id, element_id, origin, kind, content, set_by)
  values
    -- 01-brb (BE RIGHT BACK) — 19 elements
    ('01-brb', 'default', 'kicker',           'seed', 'eyebrow',  '', v_set_by),
    ('01-brb', 'default', 'title',            'seed', 'title',    '', v_set_by),
    ('01-brb', 'default', 'subtitle',         'seed', 'subtitle', '', v_set_by),
    ('01-brb', 'default', 'season-mark',      'seed', 'label',    '', v_set_by),
    ('01-brb', 'default', 'chevron-1',        'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'chevron-2',        'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'chevron-3',        'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'chevron-4',        'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'chevron-5',        'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'chevron-6',        'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'chevron-7',        'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'chevron-8',        'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'partners-strip',   'seed', 'layout',   '', v_set_by),
    ('01-brb', 'default', 'bg-image',         'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'bg-vignette',      'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'bg-grain',         'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'top-band-divider', 'seed', 'image',    '', v_set_by),
    ('01-brb', 'default', 'partners-label',   'seed', 'label',    '', v_set_by),
    ('01-brb', 'default', 'top-band-logo',    'seed', 'image',    '', v_set_by),

    -- 02-timer (countdown badge) — 4 elements
    ('02-timer', 'default', 'timer-badge',   'seed', 'layout',  '', v_set_by),
    ('02-timer', 'default', 'timer-label',   'seed', 'eyebrow', '', v_set_by),
    ('02-timer', 'default', 'timer-display', 'seed', 'number',  '', v_set_by),
    ('02-timer', 'default', 'timer-icon',    'seed', 'image',   '', v_set_by),

    -- 04-h2h-2 — 9 elements
    ('04-h2h-2', 'default', 'eyebrow',       'seed', 'eyebrow',  '', v_set_by),
    ('04-h2h-2', 'default', 'title',         'seed', 'title',    '', v_set_by),
    ('04-h2h-2', 'default', 'player-1-name', 'seed', 'heading',  '', v_set_by),
    ('04-h2h-2', 'default', 'player-2-name', 'seed', 'heading',  '', v_set_by),
    ('04-h2h-2', 'default', 'player-1-photo','seed', 'image',    '', v_set_by),
    ('04-h2h-2', 'default', 'player-2-photo','seed', 'image',    '', v_set_by),
    ('04-h2h-2', 'default', 'vs-divider',    'seed', 'label',    '', v_set_by),
    ('04-h2h-2', 'default', 'bg-image',      'seed', 'image',    '', v_set_by),
    ('04-h2h-2', 'default', 'partners-strip','seed', 'layout',   '', v_set_by),

    -- 05-h2h-3 — 10 elements
    ('05-h2h-3', 'default', 'eyebrow',       'seed', 'eyebrow',  '', v_set_by),
    ('05-h2h-3', 'default', 'title',         'seed', 'title',    '', v_set_by),
    ('05-h2h-3', 'default', 'player-1-name', 'seed', 'heading',  '', v_set_by),
    ('05-h2h-3', 'default', 'player-2-name', 'seed', 'heading',  '', v_set_by),
    ('05-h2h-3', 'default', 'player-3-name', 'seed', 'heading',  '', v_set_by),
    ('05-h2h-3', 'default', 'player-1-photo','seed', 'image',    '', v_set_by),
    ('05-h2h-3', 'default', 'player-2-photo','seed', 'image',    '', v_set_by),
    ('05-h2h-3', 'default', 'player-3-photo','seed', 'image',    '', v_set_by),
    ('05-h2h-3', 'default', 'bg-image',      'seed', 'image',    '', v_set_by),
    ('05-h2h-3', 'default', 'partners-strip','seed', 'layout',   '', v_set_by),

    -- 06-h2h-5 — 12 elements
    ('06-h2h-5', 'default', 'eyebrow',       'seed', 'eyebrow',  '', v_set_by),
    ('06-h2h-5', 'default', 'title',         'seed', 'title',    '', v_set_by),
    ('06-h2h-5', 'default', 'player-1-name', 'seed', 'heading',  '', v_set_by),
    ('06-h2h-5', 'default', 'player-2-name', 'seed', 'heading',  '', v_set_by),
    ('06-h2h-5', 'default', 'player-3-name', 'seed', 'heading',  '', v_set_by),
    ('06-h2h-5', 'default', 'player-4-name', 'seed', 'heading',  '', v_set_by),
    ('06-h2h-5', 'default', 'player-5-name', 'seed', 'heading',  '', v_set_by),
    ('06-h2h-5', 'default', 'player-1-photo','seed', 'image',    '', v_set_by),
    ('06-h2h-5', 'default', 'player-2-photo','seed', 'image',    '', v_set_by),
    ('06-h2h-5', 'default', 'player-3-photo','seed', 'image',    '', v_set_by),
    ('06-h2h-5', 'default', 'player-4-photo','seed', 'image',    '', v_set_by),
    ('06-h2h-5', 'default', 'player-5-photo','seed', 'image',    '', v_set_by),

    -- 07-leaderboard — 11 elements (row rows attach dynamically)
    ('07-leaderboard', 'default', 'eyebrow',          'seed', 'eyebrow', '', v_set_by),
    ('07-leaderboard', 'default', 'title',            'seed', 'title',   '', v_set_by),
    ('07-leaderboard', 'default', 'matchday-mark',    'seed', 'label',   '', v_set_by),
    ('07-leaderboard', 'default', 'season-mark',      'seed', 'label',   '', v_set_by),
    ('07-leaderboard', 'default', 'corner-badge-img', 'seed', 'image',   '', v_set_by),
    ('07-leaderboard', 'default', 'top-band-logo',    'seed', 'image',   '', v_set_by),
    ('07-leaderboard', 'default', 'col-headers-left', 'seed', 'label',   '', v_set_by),
    ('07-leaderboard', 'default', 'col-headers-right','seed', 'label',   '', v_set_by),
    ('07-leaderboard', 'default', 'partners-strip',   'seed', 'layout',  '', v_set_by),
    ('07-leaderboard', 'default', 'bg-image',         'seed', 'image',   '', v_set_by),
    ('07-leaderboard', 'default', 'bg-vignette',      'seed', 'image',   '', v_set_by),

    -- 08-lower-third — 10 elements
    ('08-lower-third', 'default', 'lower-third-card', 'seed', 'layout',   '', v_set_by),
    ('08-lower-third', 'default', 'slot-1-name',      'seed', 'heading',  '', v_set_by),
    ('08-lower-third', 'default', 'slot-1-tagline',   'seed', 'subtitle', '', v_set_by),
    ('08-lower-third', 'default', 'slot-2-name',      'seed', 'heading',  '', v_set_by),
    ('08-lower-third', 'default', 'slot-2-tagline',   'seed', 'subtitle', '', v_set_by),
    ('08-lower-third', 'default', 'slot-3-name',      'seed', 'heading',  '', v_set_by),
    ('08-lower-third', 'default', 'slot-3-tagline',   'seed', 'subtitle', '', v_set_by),
    ('08-lower-third', 'default', 'slot-1-icon',      'seed', 'image',    '', v_set_by),
    ('08-lower-third', 'default', 'slot-2-icon',      'seed', 'image',    '', v_set_by),
    ('08-lower-third', 'default', 'slot-3-icon',      'seed', 'image',    '', v_set_by),

    -- 09-secondary-score-bug — 9 elements
    ('09-secondary-score-bug', 'default', 'home-name',      'seed', 'heading', '', v_set_by),
    ('09-secondary-score-bug', 'default', 'away-name',      'seed', 'heading', '', v_set_by),
    ('09-secondary-score-bug', 'default', 'home-score',     'seed', 'number',  '', v_set_by),
    ('09-secondary-score-bug', 'default', 'away-score',     'seed', 'number',  '', v_set_by),
    ('09-secondary-score-bug', 'default', 'match-clock',    'seed', 'number',  '', v_set_by),
    ('09-secondary-score-bug', 'default', 'match-status',   'seed', 'label',   '', v_set_by),
    ('09-secondary-score-bug', 'default', 'score-bug-card', 'seed', 'layout',  '', v_set_by),
    ('09-secondary-score-bug', 'default', 'home-logo',      'seed', 'image',   '', v_set_by),
    ('09-secondary-score-bug', 'default', 'away-logo',      'seed', 'image',   '', v_set_by),

    -- 10-up-next-bug — 7 elements
    ('10-up-next-bug', 'default', 'up-next-eyebrow',    'seed', 'eyebrow', '', v_set_by),
    ('10-up-next-bug', 'default', 'up-next-home-name',  'seed', 'heading', '', v_set_by),
    ('10-up-next-bug', 'default', 'up-next-away-name',  'seed', 'heading', '', v_set_by),
    ('10-up-next-bug', 'default', 'up-next-time',       'seed', 'label',   '', v_set_by),
    ('10-up-next-bug', 'default', 'up-next-card',       'seed', 'layout',  '', v_set_by),
    ('10-up-next-bug', 'default', 'up-next-home-photo', 'seed', 'image',   '', v_set_by),
    ('10-up-next-bug', 'default', 'up-next-away-photo', 'seed', 'image',   '', v_set_by),

    -- 11-match-scores-day — 20 elements (3 hdrs + 13 rows + partners + bg + 2 marks)
    ('11-match-scores-day', 'default', 'eyebrow',        'seed', 'eyebrow',  '', v_set_by),
    ('11-match-scores-day', 'default', 'title',          'seed', 'title',    '', v_set_by),
    ('11-match-scores-day', 'default', 'subtitle',       'seed', 'subtitle', '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-1',    'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-2',    'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-3',    'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-4',    'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-5',    'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-6',    'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-7',    'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-8',    'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-9',    'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-10',   'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-11',   'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-12',   'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'match-row-13',   'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'partners-strip', 'seed', 'layout',   '', v_set_by),
    ('11-match-scores-day', 'default', 'bg-image',       'seed', 'image',    '', v_set_by),
    ('11-match-scores-day', 'default', 'season-mark',    'seed', 'label',    '', v_set_by),
    ('11-match-scores-day', 'default', 'matchday-mark',  'seed', 'label',    '', v_set_by),

    -- 12-starting-soon — 12 elements
    ('12-starting-soon', 'default', 'eyebrow',          'seed', 'eyebrow',  '', v_set_by),
    ('12-starting-soon', 'default', 'title',            'seed', 'title',    '', v_set_by),
    ('12-starting-soon', 'default', 'subtitle',         'seed', 'subtitle', '', v_set_by),
    ('12-starting-soon', 'default', 'cta-text',         'seed', 'caption',  '', v_set_by),
    ('12-starting-soon', 'default', 'caster-1-name',    'seed', 'heading',  '', v_set_by),
    ('12-starting-soon', 'default', 'caster-2-name',    'seed', 'heading',  '', v_set_by),
    ('12-starting-soon', 'default', 'caster-1-tagline', 'seed', 'subtitle', '', v_set_by),
    ('12-starting-soon', 'default', 'caster-2-tagline', 'seed', 'subtitle', '', v_set_by),
    ('12-starting-soon', 'default', 'partners-strip',   'seed', 'layout',   '', v_set_by),
    ('12-starting-soon', 'default', 'bg-image',         'seed', 'image',    '', v_set_by),
    ('12-starting-soon', 'default', 'top-band-logo',    'seed', 'image',    '', v_set_by),
    ('12-starting-soon', 'default', 'corner-badge-img', 'seed', 'image',    '', v_set_by),

    -- 13-stream-ended — 7 elements
    ('13-stream-ended', 'default', 'eyebrow',        'seed', 'eyebrow',  '', v_set_by),
    ('13-stream-ended', 'default', 'title',          'seed', 'title',    '', v_set_by),
    ('13-stream-ended', 'default', 'subtitle',       'seed', 'subtitle', '', v_set_by),
    ('13-stream-ended', 'default', 'cta-text',       'seed', 'caption',  '', v_set_by),
    ('13-stream-ended', 'default', 'partners-strip', 'seed', 'layout',   '', v_set_by),
    ('13-stream-ended', 'default', 'bg-image',       'seed', 'image',    '', v_set_by),
    ('13-stream-ended', 'default', 'season-mark',    'seed', 'label',    '', v_set_by),

    -- 14-top-scorers (Golden Pad) — 13 elements
    ('14-top-scorers', 'default', 'eyebrow',         'seed', 'eyebrow', '', v_set_by),
    ('14-top-scorers', 'default', 'title',           'seed', 'title',   '', v_set_by),
    ('14-top-scorers', 'default', 'pad-1-name',      'seed', 'heading', '', v_set_by),
    ('14-top-scorers', 'default', 'pad-1-goals',     'seed', 'number',  '', v_set_by),
    ('14-top-scorers', 'default', 'pad-1-photo',     'seed', 'image',   '', v_set_by),
    ('14-top-scorers', 'default', 'pad-2-name',      'seed', 'heading', '', v_set_by),
    ('14-top-scorers', 'default', 'pad-2-goals',     'seed', 'number',  '', v_set_by),
    ('14-top-scorers', 'default', 'pad-2-photo',     'seed', 'image',   '', v_set_by),
    ('14-top-scorers', 'default', 'pad-3-name',      'seed', 'heading', '', v_set_by),
    ('14-top-scorers', 'default', 'pad-3-goals',     'seed', 'number',  '', v_set_by),
    ('14-top-scorers', 'default', 'pad-3-photo',     'seed', 'image',   '', v_set_by),
    ('14-top-scorers', 'default', 'bg-image',        'seed', 'image',   '', v_set_by),
    ('14-top-scorers', 'default', 'partners-strip',  'seed', 'layout',  '', v_set_by),

    -- 15-orgs — 4 elements
    ('15-orgs', 'default', 'eyebrow',           'seed', 'eyebrow', '', v_set_by),
    ('15-orgs', 'default', 'title',             'seed', 'title',   '', v_set_by),
    ('15-orgs', 'default', 'org-card-template', 'seed', 'layout',  '', v_set_by),
    ('15-orgs', 'default', 'partners-strip',    'seed', 'layout',  '', v_set_by),

    -- 16-coaches — 12 elements
    ('16-coaches', 'default', 'eyebrow',          'seed', 'eyebrow',  '', v_set_by),
    ('16-coaches', 'default', 'title',            'seed', 'title',    '', v_set_by),
    ('16-coaches', 'default', 'coach-1-name',     'seed', 'heading',  '', v_set_by),
    ('16-coaches', 'default', 'coach-2-name',     'seed', 'heading',  '', v_set_by),
    ('16-coaches', 'default', 'coach-3-name',     'seed', 'heading',  '', v_set_by),
    ('16-coaches', 'default', 'coach-1-tagline',  'seed', 'subtitle', '', v_set_by),
    ('16-coaches', 'default', 'coach-2-tagline',  'seed', 'subtitle', '', v_set_by),
    ('16-coaches', 'default', 'coach-3-tagline',  'seed', 'subtitle', '', v_set_by),
    ('16-coaches', 'default', 'coach-1-photo',    'seed', 'image',    '', v_set_by),
    ('16-coaches', 'default', 'coach-2-photo',    'seed', 'image',    '', v_set_by),
    ('16-coaches', 'default', 'coach-3-photo',    'seed', 'image',    '', v_set_by),
    ('16-coaches', 'default', 'partners-strip',   'seed', 'layout',   '', v_set_by),

    -- 17-penalties — 7 elements
    ('17-penalties', 'default', 'eyebrow',      'seed', 'eyebrow',  '', v_set_by),
    ('17-penalties', 'default', 'title',        'seed', 'title',    '', v_set_by),
    ('17-penalties', 'default', 'home-pens',    'seed', 'number',   '', v_set_by),
    ('17-penalties', 'default', 'away-pens',    'seed', 'number',   '', v_set_by),
    ('17-penalties', 'default', 'home-name',    'seed', 'heading',  '', v_set_by),
    ('17-penalties', 'default', 'away-name',    'seed', 'heading',  '', v_set_by),
    ('17-penalties', 'default', 'outcome-line', 'seed', 'subtitle', '', v_set_by)
  on conflict (overlay_key, variant_id, element_id) where deleted_at is null do nothing;
end$$;
