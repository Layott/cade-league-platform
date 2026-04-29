-- Overlay Design Page v2 — Wave 2 Stage 1 (8/8)
-- ------------------------------------------------------------------
-- Seed `overlay_partner_logos` with the current 5 partner logos
-- referenced by the existing 01-brb / 12-starting-soon / etc. HTML.
-- File URLs point at the existing `/overlays/v2/_assets/logos/processed/`
-- bundle so first deploy is a no-op — the Stage 2/3 admin UI will
-- replace these with bucket-uploaded URLs as admins re-upload.
--
-- Dimensions are 600×300 per the brand pipeline at
-- KNOWLEDGE/brand-assets/players/_process.py (the `_strip` variant
-- size). file_size_bytes is set to a conservative ~150 KB placeholder
-- — the runtime upload action recomputes via sharp on each new upload.
--
-- Picks any admin user as `set_by`. Falls back to any user. Skips if
-- there are none. Idempotent — `ON CONFLICT (partner_key) DO NOTHING`.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.3
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
    raise notice 'overlay_partner_logos seed: no users in public.users yet — skipping (runtime upload will create rows on first admin save)';
    return;
  end if;

  insert into public.overlay_partner_logos
    (partner_key, label, alt, file_url, file_size_bytes,
     dimension_w_px, dimension_h_px, sort_order, set_by)
  values
    ('gameevo',  'GameEvo Esports',     'GameEvo Esports',
     '/overlays/v2/_assets/logos/processed/GameEvo%20Esports%20White_strip.png',
     150000, 600, 300, 0, v_set_by),
    ('gamepride', 'Gamepride',          'Gamepride',
     '/overlays/v2/_assets/logos/processed/Gamepride%20Green-01_strip.png',
     150000, 600, 300, 1, v_set_by),
    ('esn',      'Esports Africa News', 'Esports Africa News',
     '/overlays/v2/_assets/logos/processed/ESPORTS%20AFRICA%20NEWS%20WHITE_strip.png',
     150000, 600, 300, 2, v_set_by),
    ('trace',    'TRACE',               'TRACE',
     '/overlays/v2/_assets/logos/processed/TRACE_2010_logo.svg_strip.png',
     150000, 600, 300, 3, v_set_by),
    ('oas',      'OAS Esport',          'OAS esport',
     '/overlays/v2/_assets/logos/processed/OAS%20esport_strip.png',
     150000, 600, 300, 4, v_set_by)
  on conflict (partner_key) where deleted_at is null do nothing;
end$$;
