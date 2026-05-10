-- Cover-up overlays (22, 25, 26, 28, 29) — text-element catalog seed.
-- ------------------------------------------------------------------
-- Adds editable text slots to the 5 copy-heavy cover-up overlays so
-- producers can edit punditry quotes, did-you-know trivia, power-
-- rankings blurbs, and the card-meta / goalfests sub-heads through the
-- existing /admin/broadcast/v2/design Text panel. Pre-Phase 3 (AI
-- Regenerate button) ships, this gives the existing edit-pane immediate
-- value: type new copy, save, the SSR resolver injects it into the live
-- overlay on next trigger.
--
-- Each row carries `origin='seed'`, `kind='text'`, an initial curated
-- `content` line (the same string already baked into the source HTML),
-- and ALL typography fields NULL so the visual layout stays byte-
-- identical until an admin chooses to override.
--
-- Picks the oldest admin user as `set_by` for FK satisfaction (mirrors
-- the seed pattern in 20260620000007_overlay_text_elements_seed.sql).
-- Falls back to any user; if no users exist yet, the seed skips and
-- the runtime upsert path creates rows on first admin save.
--
-- Idempotent — `ON CONFLICT (overlay_key, variant_id, element_id)
-- DO NOTHING` so re-running a partial deploy is safe.

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
    raise notice 'overlay cover-up text seed: no users yet — skipping (runtime upsert will create rows on first admin save)';
    return;
  end if;

  insert into public.overlay_text_elements
    (overlay_key, variant_id, element_id, origin, kind, display_label, content, set_by)
  values
    -- 22-power-rankings — 5 per-rank blurbs
    ('22-power-rankings', 'default', 'pr-blurb-1', 'seed', 'text',
      'Rank 1 Blurb',
      'Untouched at the top. Five straight wins to open the season.',
      v_set_by),
    ('22-power-rankings', 'default', 'pr-blurb-2', 'seed', 'text',
      'Rank 2 Blurb',
      'Climbed four spots in a single week. Form is electric.',
      v_set_by),
    ('22-power-rankings', 'default', 'pr-blurb-3', 'seed', 'text',
      'Rank 3 Blurb',
      'Slipped one slot but goal-difference still elite.',
      v_set_by),
    ('22-power-rankings', 'default', 'pr-blurb-4', 'seed', 'text',
      'Rank 4 Blurb',
      'Rock-solid 4-1-1 record. Quietly stacking points.',
      v_set_by),
    ('22-power-rankings', 'default', 'pr-blurb-5', 'seed', 'text',
      'Rank 5 Blurb',
      '31 goals in six games. Highest entertainment factor.',
      v_set_by),

    -- 25-did-you-know — one trivia paragraph
    ('25-did-you-know', 'default', 'dyk-detail', 'seed', 'body',
      'Did You Know Detail',
      'First player to open Season 2 with five consecutive victories. Goal aggregate: 31 scored, 16 conceded. +15 differential. Untouched at the summit.',
      v_set_by),

    -- 26-card-meta — sub-head tagline
    ('26-card-meta', 'default', 'cm-subhead', 'seed', 'subheading',
      'Card Meta Subhead',
      'MOST-PICKED CARDS · WEEK 3 SUBMISSIONS',
      v_set_by),

    -- 28-punditry — quote, author, role
    ('28-punditry', 'default', 'pq-quote', 'seed', 'text',
      'Punditry Quote',
      'BAJI JNR MAKES IT LOOK EASY — BUT GURU CLIMBING FOUR SPOTS IN ONE WEEK IS THE STORY OF THE SEASON SO FAR.',
      v_set_by),
    ('28-punditry', 'default', 'pq-author', 'seed', 'label',
      'Punditry Author',
      'CADE PUNDIT DESK',
      v_set_by),
    ('28-punditry', 'default', 'pq-role', 'seed', 'caption',
      'Punditry Role',
      'WEEK 3 ANALYSIS',
      v_set_by),

    -- 29-goalfests — sub-head tagline
    ('29-goalfests', 'default', 'gf-subhead', 'seed', 'subheading',
      'Goalfests Subhead',
      '7+ GOALS COMBINED · MOST EXPLOSIVE FIXTURES',
      v_set_by)
  on conflict (overlay_key, variant_id, element_id) where deleted_at is null
    do nothing;
end $$;
