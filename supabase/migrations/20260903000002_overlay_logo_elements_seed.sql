-- Overlay design system — seed CADE Esports + ESOCCER (Pro League) logos.
-- ------------------------------------------------------------------
-- Adds `logo-cade` + `logo-pro` text-element rows to every overlay
-- whose source HTML carries those header logos. Source `<img>` tags
-- now carry `data-element-id="logo-cade"` and `data-element-id="logo-
-- pro"` so the existing design system pipeline can move / resize /
-- hide / animate them per overlay.
--
-- Seeded as `kind='sponsor-logo-floating'` with ALL fields NULL —
-- byte-identical render until an admin edits a knob. Admin sees them
-- in the Text panel + Animations picker on /admin/broadcast/v2/design.
--
-- Idempotent — `ON CONFLICT DO NOTHING`.

do $$
declare
  v_set_by uuid;
  v_overlay text;
  v_overlays text[] := array[
    '01-brb',
    '04-h2h-2',
    '05-h2h-3',
    '06-h2h-5',
    '11-match-scores-day',
    '12-starting-soon',
    '13-stream-ended',
    '14-top-scorers',
    '15-orgs',
    '16-coaches',
    '17-penalties',
    '19-player-squads'
  ];
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
    raise notice 'overlay logo seed: no users yet — skipping (runtime upsert will create rows on first admin save)';
    return;
  end if;

  foreach v_overlay in array v_overlays loop
    insert into public.overlay_text_elements
      (overlay_key, variant_id, element_id, origin, kind, display_label, content, set_by)
    values
      (v_overlay, 'default', 'logo-cade', 'seed', 'sponsor-logo-floating',
        'CADE Esports logo', '', v_set_by),
      (v_overlay, 'default', 'logo-pro',  'seed', 'sponsor-logo-floating',
        'ESOCCER Pro League logo', '', v_set_by)
    on conflict (overlay_key, variant_id, element_id) where deleted_at is null do nothing;
  end loop;
end$$;
