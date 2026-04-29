-- Overlay Design Page v2 — Wave 2 Stage 5 (universal element labels + kinds)
-- ------------------------------------------------------------------
-- The current `overlay_text_elements.kind` enum is technical
-- (heading/subheading/eyebrow/title/subtitle/caption/number/label/body/
-- image/layout) — admins editing the Text panel see cryptic
-- `data-element-id` strings without knowing whether `season-mark` is a
-- caption or `partners-strip` is a sponsor strip vs a player container.
--
-- This migration:
--   1. Widens the `kind` CHECK to a UNION of the legacy enum + the new
--      semantic enum the user-facing brief calls for (text /
--      score-number / player-name / player-photo / player-box /
--      sponsor-logo-strip / sponsor-logo-floating / partner-strip-container /
--      bg-image / bg-vignette / box). Keeping the legacy values keeps the
--      existing 168 seed rows valid until backfill.
--   2. Adds `display_label text` so the admin UI can show a human-readable
--      name (e.g. "BRB Title", "Player A Photo", "GameEvo Sponsor Logo")
--      next to the technical `element_id`.
--   3. Backfills `kind` to the NEW semantic value where the legacy value
--      is less specific (e.g. `partners-strip` → `partner-strip-container`,
--      `player-N-photo` → `player-photo`, `home-score` → `score-number`).
--      Legacy values (heading/subheading/etc.) survive where they are
--      already accurate.
--   4. Backfills `display_label` for every (overlay_key, element_id) pair
--      so every row in the catalog has a clear human label on first read.
--   5. Drops the column-level `default 'caption'` so future inserts MUST
--      specify a kind (the seed catalog covers every existing element id;
--      runtime additions go through the admin UI which sets `kind`
--      explicitly).
--
-- Idempotent — every step uses `if not exists` / `if exists` /
-- conditional update so re-running on a partially-applied DB is safe.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.1, §8
-- ------------------------------------------------------------------

-- 1. Widen kind CHECK constraint to union of legacy + new semantic enum.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'overlay_text_elements_kind_check'
      and conrelid = 'public.overlay_text_elements'::regclass
  ) then
    alter table public.overlay_text_elements
      drop constraint overlay_text_elements_kind_check;
  end if;
end$$;

alter table public.overlay_text_elements
  add constraint overlay_text_elements_kind_check
  check (kind in (
    -- Legacy typographic enum (kept for back-compat).
    'heading','subheading','eyebrow','title','subtitle','caption',
    'number','label','body','image','layout',
    -- New semantic enum (per brief).
    'text','score-number','player-name','player-photo','player-box',
    'sponsor-logo-strip','sponsor-logo-floating','partner-strip-container',
    'bg-image','bg-vignette','box'
  ));

-- 2. Add display_label column.
alter table public.overlay_text_elements
  add column if not exists display_label text;

-- 3+4. Backfill kind + display_label for all 168 seed rows.
-- Each (overlay_key, element_id) tuple gets the most accurate kind +
-- a human-readable label. Updates are idempotent (overwrites existing
-- backfill values so re-running picks up corrections).
update public.overlay_text_elements t
set
  kind = m.new_kind,
  display_label = m.label
from (
  values
    -- 01-brb (BE RIGHT BACK)
    ('01-brb', 'kicker',           'caption',                  'BRB Kicker'),
    ('01-brb', 'title',             'heading',                  'BRB Title'),
    ('01-brb', 'subtitle',          'subheading',               'BRB Subtitle'),
    ('01-brb', 'season-mark',       'caption',                  'Season Mark'),
    ('01-brb', 'chevron-1',         'box',                      'Chevron 1'),
    ('01-brb', 'chevron-2',         'box',                      'Chevron 2'),
    ('01-brb', 'chevron-3',         'box',                      'Chevron 3'),
    ('01-brb', 'chevron-4',         'box',                      'Chevron 4'),
    ('01-brb', 'chevron-5',         'box',                      'Chevron 5'),
    ('01-brb', 'chevron-6',         'box',                      'Chevron 6'),
    ('01-brb', 'chevron-7',         'box',                      'Chevron 7'),
    ('01-brb', 'chevron-8',         'box',                      'Chevron 8'),
    ('01-brb', 'partners-strip',    'partner-strip-container',  'Partners Strip'),
    ('01-brb', 'bg-image',          'bg-image',                 'Background Image'),
    ('01-brb', 'bg-vignette',       'bg-vignette',              'Background Vignette'),
    ('01-brb', 'bg-grain',          'bg-image',                 'Background Grain'),
    ('01-brb', 'top-band-divider',  'box',                      'Top Band Divider'),
    ('01-brb', 'partners-label',    'caption',                  'Partners Label'),
    ('01-brb', 'top-band-logo',     'sponsor-logo-floating',    'Top Band Logo'),

    -- 02-timer (countdown badge)
    ('02-timer', 'timer-badge',     'box',                      'Timer Badge'),
    ('02-timer', 'timer-label',     'caption',                  'Timer Label'),
    ('02-timer', 'timer-display',   'score-number',             'Timer Display'),
    ('02-timer', 'timer-icon',      'box',                      'Timer Icon'),

    -- 04-h2h-2 — head-to-head 2 players
    ('04-h2h-2', 'eyebrow',         'caption',                  'H2H Eyebrow'),
    ('04-h2h-2', 'title',           'heading',                  'H2H Title'),
    ('04-h2h-2', 'player-1-name',   'player-name',              'Player A Name'),
    ('04-h2h-2', 'player-2-name',   'player-name',              'Player B Name'),
    ('04-h2h-2', 'player-1-photo',  'player-photo',             'Player A Photo'),
    ('04-h2h-2', 'player-2-photo',  'player-photo',             'Player B Photo'),
    ('04-h2h-2', 'vs-divider',      'box',                      'VS Divider'),
    ('04-h2h-2', 'bg-image',        'bg-image',                 'Background Image'),
    ('04-h2h-2', 'partners-strip',  'partner-strip-container',  'Partners Strip'),

    -- 05-h2h-3
    ('05-h2h-3', 'eyebrow',         'caption',                  'H2H Eyebrow'),
    ('05-h2h-3', 'title',           'heading',                  'H2H Title'),
    ('05-h2h-3', 'player-1-name',   'player-name',              'Player 1 Name'),
    ('05-h2h-3', 'player-2-name',   'player-name',              'Player 2 Name'),
    ('05-h2h-3', 'player-3-name',   'player-name',              'Player 3 Name'),
    ('05-h2h-3', 'player-1-photo',  'player-photo',             'Player 1 Photo'),
    ('05-h2h-3', 'player-2-photo',  'player-photo',             'Player 2 Photo'),
    ('05-h2h-3', 'player-3-photo',  'player-photo',             'Player 3 Photo'),
    ('05-h2h-3', 'bg-image',        'bg-image',                 'Background Image'),
    ('05-h2h-3', 'partners-strip',  'partner-strip-container',  'Partners Strip'),

    -- 06-h2h-5
    ('06-h2h-5', 'eyebrow',         'caption',                  'H2H Eyebrow'),
    ('06-h2h-5', 'title',           'heading',                  'H2H Title'),
    ('06-h2h-5', 'player-1-name',   'player-name',              'Player 1 Name'),
    ('06-h2h-5', 'player-2-name',   'player-name',              'Player 2 Name'),
    ('06-h2h-5', 'player-3-name',   'player-name',              'Player 3 Name'),
    ('06-h2h-5', 'player-4-name',   'player-name',              'Player 4 Name'),
    ('06-h2h-5', 'player-5-name',   'player-name',              'Player 5 Name'),
    ('06-h2h-5', 'player-1-photo',  'player-photo',             'Player 1 Photo'),
    ('06-h2h-5', 'player-2-photo',  'player-photo',             'Player 2 Photo'),
    ('06-h2h-5', 'player-3-photo',  'player-photo',             'Player 3 Photo'),
    ('06-h2h-5', 'player-4-photo',  'player-photo',             'Player 4 Photo'),
    ('06-h2h-5', 'player-5-photo',  'player-photo',             'Player 5 Photo'),
    ('06-h2h-5', 'partners-strip',  'partner-strip-container',  'Partners Strip'),

    -- 07-leaderboard
    ('07-leaderboard', 'eyebrow',           'caption',                  'Leaderboard Eyebrow'),
    ('07-leaderboard', 'title',             'heading',                  'Leaderboard Title'),
    ('07-leaderboard', 'matchday-mark',     'caption',                  'Match Day Mark'),
    ('07-leaderboard', 'season-mark',       'caption',                  'Season Mark'),
    ('07-leaderboard', 'corner-badge-img',  'sponsor-logo-floating',    'Corner Badge Logo'),
    ('07-leaderboard', 'top-band-logo',     'sponsor-logo-floating',    'Top Band Logo'),
    ('07-leaderboard', 'col-headers-left',  'caption',                  'Column Headers (Left)'),
    ('07-leaderboard', 'col-headers-right', 'caption',                  'Column Headers (Right)'),
    ('07-leaderboard', 'partners-strip',    'partner-strip-container',  'Partners Strip'),
    ('07-leaderboard', 'bg-image',          'bg-image',                 'Background Image'),
    ('07-leaderboard', 'bg-vignette',       'bg-vignette',              'Background Vignette'),

    -- 08-lower-third
    ('08-lower-third', 'lower-third-card', 'box',         'Lower Third Card'),
    ('08-lower-third', 'slot-1-name',      'player-name', 'Slot 1 Name'),
    ('08-lower-third', 'slot-1-tagline',   'caption',     'Slot 1 Tagline'),
    ('08-lower-third', 'slot-2-name',      'player-name', 'Slot 2 Name'),
    ('08-lower-third', 'slot-2-tagline',   'caption',     'Slot 2 Tagline'),
    ('08-lower-third', 'slot-3-name',      'player-name', 'Slot 3 Name'),
    ('08-lower-third', 'slot-3-tagline',   'caption',     'Slot 3 Tagline'),
    ('08-lower-third', 'slot-1-icon',      'box',         'Slot 1 Icon'),
    ('08-lower-third', 'slot-2-icon',      'box',         'Slot 2 Icon'),
    ('08-lower-third', 'slot-3-icon',      'box',         'Slot 3 Icon'),

    -- 09-secondary-score-bug
    ('09-secondary-score-bug', 'home-name',      'player-name',           'Home Team / Player Name'),
    ('09-secondary-score-bug', 'away-name',      'player-name',           'Away Team / Player Name'),
    ('09-secondary-score-bug', 'home-score',     'score-number',          'Home Score'),
    ('09-secondary-score-bug', 'away-score',     'score-number',          'Away Score'),
    ('09-secondary-score-bug', 'match-clock',    'score-number',          'Match Clock'),
    ('09-secondary-score-bug', 'match-status',   'caption',               'Match Status'),
    ('09-secondary-score-bug', 'score-bug-card', 'box',                   'Score Bug Card'),
    ('09-secondary-score-bug', 'home-logo',      'sponsor-logo-floating', 'Home Team Logo'),
    ('09-secondary-score-bug', 'away-logo',      'sponsor-logo-floating', 'Away Team Logo'),

    -- 10-up-next-bug
    ('10-up-next-bug', 'up-next-eyebrow',    'caption',      'Up Next Eyebrow'),
    ('10-up-next-bug', 'up-next-home-name',  'player-name',  'Up Next Home Name'),
    ('10-up-next-bug', 'up-next-away-name',  'player-name',  'Up Next Away Name'),
    ('10-up-next-bug', 'up-next-time',       'caption',      'Up Next Time'),
    ('10-up-next-bug', 'up-next-card',       'box',          'Up Next Card'),
    ('10-up-next-bug', 'up-next-home-photo', 'player-photo', 'Up Next Home Photo'),
    ('10-up-next-bug', 'up-next-away-photo', 'player-photo', 'Up Next Away Photo'),

    -- 11-match-scores-day
    ('11-match-scores-day', 'eyebrow',        'caption',                 'Match Scores Eyebrow'),
    ('11-match-scores-day', 'title',          'heading',                 'Match Scores Title'),
    ('11-match-scores-day', 'subtitle',       'subheading',              'Match Scores Subtitle'),
    ('11-match-scores-day', 'match-row-1',    'box',                     'Match Row 1'),
    ('11-match-scores-day', 'match-row-2',    'box',                     'Match Row 2'),
    ('11-match-scores-day', 'match-row-3',    'box',                     'Match Row 3'),
    ('11-match-scores-day', 'match-row-4',    'box',                     'Match Row 4'),
    ('11-match-scores-day', 'match-row-5',    'box',                     'Match Row 5'),
    ('11-match-scores-day', 'match-row-6',    'box',                     'Match Row 6'),
    ('11-match-scores-day', 'match-row-7',    'box',                     'Match Row 7'),
    ('11-match-scores-day', 'match-row-8',    'box',                     'Match Row 8'),
    ('11-match-scores-day', 'match-row-9',    'box',                     'Match Row 9'),
    ('11-match-scores-day', 'match-row-10',   'box',                     'Match Row 10'),
    ('11-match-scores-day', 'match-row-11',   'box',                     'Match Row 11'),
    ('11-match-scores-day', 'match-row-12',   'box',                     'Match Row 12'),
    ('11-match-scores-day', 'match-row-13',   'box',                     'Match Row 13'),
    ('11-match-scores-day', 'partners-strip', 'partner-strip-container', 'Partners Strip'),
    ('11-match-scores-day', 'bg-image',       'bg-image',                'Background Image'),
    ('11-match-scores-day', 'season-mark',    'caption',                 'Season Mark'),
    ('11-match-scores-day', 'matchday-mark',  'caption',                 'Match Day Mark'),

    -- 12-starting-soon
    ('12-starting-soon', 'eyebrow',          'caption',                 'Starting Soon Eyebrow'),
    ('12-starting-soon', 'title',            'heading',                 'Starting Soon Title'),
    ('12-starting-soon', 'subtitle',         'subheading',              'Starting Soon Subtitle'),
    ('12-starting-soon', 'cta-text',         'caption',                 'Starting Soon CTA'),
    ('12-starting-soon', 'caster-1-name',    'player-name',             'Caster 1 Name'),
    ('12-starting-soon', 'caster-2-name',    'player-name',             'Caster 2 Name'),
    ('12-starting-soon', 'caster-1-tagline', 'caption',                 'Caster 1 Tagline'),
    ('12-starting-soon', 'caster-2-tagline', 'caption',                 'Caster 2 Tagline'),
    ('12-starting-soon', 'partners-strip',   'partner-strip-container', 'Partners Strip'),
    ('12-starting-soon', 'bg-image',         'bg-image',                'Background Image'),
    ('12-starting-soon', 'top-band-logo',    'sponsor-logo-floating',   'Top Band Logo'),
    ('12-starting-soon', 'corner-badge-img', 'sponsor-logo-floating',   'Corner Badge Logo'),

    -- 13-stream-ended
    ('13-stream-ended', 'eyebrow',        'caption',                 'Stream Ended Eyebrow'),
    ('13-stream-ended', 'title',          'heading',                 'Stream Ended Title'),
    ('13-stream-ended', 'subtitle',       'subheading',              'Stream Ended Subtitle'),
    ('13-stream-ended', 'cta-text',       'caption',                 'Stream Ended CTA'),
    ('13-stream-ended', 'partners-strip', 'partner-strip-container', 'Partners Strip'),
    ('13-stream-ended', 'bg-image',       'bg-image',                'Background Image'),
    ('13-stream-ended', 'season-mark',    'caption',                 'Season Mark'),

    -- 14-top-scorers (Golden Pad)
    ('14-top-scorers', 'eyebrow',        'caption',                 'Top Scorers Eyebrow'),
    ('14-top-scorers', 'title',          'heading',                 'Top Scorers Title'),
    ('14-top-scorers', 'pad-1-name',     'player-name',             'Pad 1 Name'),
    ('14-top-scorers', 'pad-1-goals',    'score-number',            'Pad 1 Goals'),
    ('14-top-scorers', 'pad-1-photo',    'player-photo',            'Pad 1 Photo'),
    ('14-top-scorers', 'pad-2-name',     'player-name',             'Pad 2 Name'),
    ('14-top-scorers', 'pad-2-goals',    'score-number',            'Pad 2 Goals'),
    ('14-top-scorers', 'pad-2-photo',    'player-photo',            'Pad 2 Photo'),
    ('14-top-scorers', 'pad-3-name',     'player-name',             'Pad 3 Name'),
    ('14-top-scorers', 'pad-3-goals',    'score-number',            'Pad 3 Goals'),
    ('14-top-scorers', 'pad-3-photo',    'player-photo',            'Pad 3 Photo'),
    ('14-top-scorers', 'bg-image',       'bg-image',                'Background Image'),
    ('14-top-scorers', 'partners-strip', 'partner-strip-container', 'Partners Strip'),

    -- 15-orgs
    ('15-orgs', 'eyebrow',           'caption',                 'Orgs Eyebrow'),
    ('15-orgs', 'title',             'heading',                 'Orgs Title'),
    ('15-orgs', 'org-card-template', 'box',                     'Org Card Template'),
    ('15-orgs', 'partners-strip',    'partner-strip-container', 'Partners Strip'),

    -- 16-coaches
    ('16-coaches', 'eyebrow',          'caption',                 'Coaches Eyebrow'),
    ('16-coaches', 'title',            'heading',                 'Coaches Title'),
    ('16-coaches', 'coach-1-name',     'player-name',             'Coach 1 Name'),
    ('16-coaches', 'coach-2-name',     'player-name',             'Coach 2 Name'),
    ('16-coaches', 'coach-3-name',     'player-name',             'Coach 3 Name'),
    ('16-coaches', 'coach-1-tagline',  'caption',                 'Coach 1 Tagline'),
    ('16-coaches', 'coach-2-tagline',  'caption',                 'Coach 2 Tagline'),
    ('16-coaches', 'coach-3-tagline',  'caption',                 'Coach 3 Tagline'),
    ('16-coaches', 'coach-1-photo',    'player-photo',            'Coach 1 Photo'),
    ('16-coaches', 'coach-2-photo',    'player-photo',            'Coach 2 Photo'),
    ('16-coaches', 'coach-3-photo',    'player-photo',            'Coach 3 Photo'),
    ('16-coaches', 'partners-strip',   'partner-strip-container', 'Partners Strip'),

    -- 17-penalties
    ('17-penalties', 'eyebrow',        'caption',                 'Penalties Eyebrow'),
    ('17-penalties', 'title',          'heading',                 'Penalties Title'),
    ('17-penalties', 'home-pens',      'score-number',            'Home Penalties'),
    ('17-penalties', 'away-pens',      'score-number',            'Away Penalties'),
    ('17-penalties', 'home-name',      'player-name',             'Home Team / Player Name'),
    ('17-penalties', 'away-name',      'player-name',             'Away Team / Player Name'),
    ('17-penalties', 'outcome-line',   'subheading',              'Outcome Line'),
    ('17-penalties', 'partners-strip', 'partner-strip-container', 'Partners Strip')
) as m(overlay_key, element_id, new_kind, label)
where t.overlay_key = m.overlay_key
  and t.element_id = m.element_id
  and t.deleted_at is null;

-- For any rows the seed catalog above missed (none expected — covers all
-- 168 seed inserts) fall back to a deterministic display_label derived
-- from the element_id so the admin UI never shows a blank label.
update public.overlay_text_elements
set display_label = initcap(replace(element_id, '-', ' '))
where display_label is null
  and deleted_at is null;

-- 5. Drop the column-level default. New rows must specify `kind`
-- explicitly (the seed catalog covers every existing element id;
-- runtime additions go through the admin UI which sets `kind`).
alter table public.overlay_text_elements
  alter column kind drop default;
