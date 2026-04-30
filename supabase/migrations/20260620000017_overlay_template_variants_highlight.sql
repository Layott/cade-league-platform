-- Register the new `20-highlight` v2 overlay template variant.
-- Same pattern as `20260620000014_overlay_template_variants_player_squads.sql`.

insert into public.overlay_template_variants
  (overlay_key, variant_id, label, html_path, active)
values
  (
    '20-highlight',
    'default',
    '20-highlight',
    'apps/web/public/overlays/v2/20-highlight/index.html',
    true
  )
on conflict (overlay_key, variant_id) do nothing;

do $$
declare
  admin_user_id uuid;
begin
  select u.id into admin_user_id
  from public.users u
  join public.user_roles r on r.user_id = u.id
  where r.role = 'admin' and r.deleted_at is null
  order by u.created_at asc
  limit 1;

  if admin_user_id is null then
    raise notice 'No admin user found - skipping overlay_text_elements seed for 20-highlight.';
    return;
  end if;

  insert into public.overlay_text_elements
    (overlay_key, variant_id, element_id, origin, kind, display_label,
     content, sort_order, set_by)
  values
    -- 20-highlight seed (matches data-element-ids in 20-highlight HTML).
    ('20-highlight', 'default', 'season-mark',     'seed', 'eyebrow',                 'Season mark',         'CADE / ELITE / 2025-2026', 1, admin_user_id),
    ('20-highlight', 'default', 'highlight-label', 'seed', 'heading',                 'Highlight title',     'HIGHLIGHT', 2, admin_user_id),
    ('20-highlight', 'default', 'highlight-stage', 'seed', 'layout',                  'Video stage area',    '',          3, admin_user_id),
    ('20-highlight', 'default', 'recent-fixtures', 'seed', 'layout',                  'Recent fixtures grid', '',         4, admin_user_id),
    ('20-highlight', 'default', 'partners-strip',  'seed', 'partner-strip-container', 'Partners strip',      '',          5, admin_user_id),
    -- 11-match-scores-day post-redesign IDs (parity check fix).
    ('11-match-scores-day', 'default', 'week-pill',      'seed', 'label',                   'Week pill',      'WEEK 1',   50, admin_user_id),
    ('11-match-scores-day', 'default', 'fixtures-grid',  'seed', 'layout',                  'Fixtures grid',  '',         51, admin_user_id),
    ('11-match-scores-day', 'default', 'season-mark',    'seed', 'eyebrow',                 'Season mark',    'CADE / ELITE / 2025-2026', 52, admin_user_id),
    ('11-match-scores-day', 'default', 'partners-strip', 'seed', 'partner-strip-container', 'Partners strip', '',         53, admin_user_id),
    -- 19-player-squads parity backfill (HTML data-element-ids not in
    -- the original migration `20260620000014`).
    ('19-player-squads', 'default', 'draft-owner-name',  'seed', 'heading',  'Draft owner name',  '',          70, admin_user_id),
    ('19-player-squads', 'default', 'draft-owner-photo', 'seed', 'image',    'Draft owner photo', '',          71, admin_user_id),
    ('19-player-squads', 'default', 'chemistry-value',   'seed', 'number',   'Chemistry value',   '',          72, admin_user_id),
    ('19-player-squads', 'default', 'formation-value',   'seed', 'label',    'Formation value',   '',          73, admin_user_id),
    ('19-player-squads', 'default', 'header-row',        'seed', 'layout',   'Header row',        '',          74, admin_user_id),
    ('19-player-squads', 'default', 'pitch-wrap',        'seed', 'layout',   'Pitch wrap',        '',          75, admin_user_id),
    ('19-player-squads', 'default', 'pitch',             'seed', 'layout',   'Pitch',             '',          76, admin_user_id),
    ('19-player-squads', 'default', 'subs-panel',        'seed', 'layout',   'Subs panel',        '',          77, admin_user_id),
    ('19-player-squads', 'default', 'subs-grid',         'seed', 'layout',   'Subs grid',         '',          78, admin_user_id),
    ('19-player-squads', 'default', 'partners-strip',    'seed', 'partner-strip-container', 'Partners strip', '', 79, admin_user_id)
  on conflict (overlay_key, variant_id, element_id) where deleted_at is null do nothing;
end$$;
