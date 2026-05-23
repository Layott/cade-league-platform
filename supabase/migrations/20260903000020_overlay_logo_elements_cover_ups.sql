-- Overlay design system — seed CADE + ESOCCER logos on cover-up overlays.
-- ------------------------------------------------------------------
-- Cover-up overlays 21-29 carry CADE Esports + ESOCCER Pro League
-- logos in the top-center `.brand-strip`. Source HTMLs now tag those
-- `<img>` elements with `data-element-id="logo-cade"` / `logo-pro` so
-- admins can move / resize / hide / animate them from
-- /admin/broadcast/v2/design (Text panel + Animations picker).
--
-- Seeded as `kind='sponsor-logo-floating'` with ALL fields NULL —
-- byte-identical render until an admin tunes a knob.
--
-- Idempotent — `ON CONFLICT (overlay_key, variant_id, element_id)
-- WHERE deleted_at IS NULL DO NOTHING`.

do $$
declare
  v_set_by uuid;
  v_overlay text;
  v_overlays text[] := array[
    '21-streaks',
    '22-power-rankings',
    '23-org-standings',
    '24-biggest-margins',
    '25-did-you-know',
    '26-card-meta',
    '27-schedule',
    '28-punditry',
    '29-goalfests'
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
    raise notice 'overlay cover-up logo seed: no users yet — skipping';
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
