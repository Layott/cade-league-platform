-- Add WAGYR as the 6th partner logo in the global roster.
-- Source asset processed via apps/web/scripts/_process-wagyr-strip.mjs
-- (sharp: ensureAlpha + trim + contain-fit 600×300 transparent canvas).
-- Output mirrored at:
--   apps/web/public/overlays/v2/_assets/logos/processed/WAGYR_strip.png
--   KNOWLEDGE/brand-assets/logos/processed/WAGYR_strip.png
--
-- sort_order = 5 places WAGYR after the existing 5 partners
-- (gameevo=0, gamepride=1, esn=2, trace=3, oas=4).
--
-- Idempotent — ON CONFLICT (partner_key) WHERE deleted_at IS NULL DO
-- NOTHING. Falls back to any admin user, then any user, as the
-- `set_by` actor (mirrors the 2026-06-20 seed pattern).

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
    raise notice 'overlay_partner_logos WAGYR seed: no users yet — skipping (runtime upload will create the row on first admin save)';
    return;
  end if;

  insert into public.overlay_partner_logos
    (partner_key, label, alt, display_label, file_url, file_size_bytes,
     dimension_w_px, dimension_h_px, sort_order, set_by)
  values
    ('wagyr', 'WAGYR', 'WAGYR', 'WAGYR',
     '/overlays/v2/_assets/logos/processed/WAGYR_strip.png',
     5003, 600, 300, 5, v_set_by)
  on conflict (partner_key) where deleted_at is null do nothing;
end$$;
