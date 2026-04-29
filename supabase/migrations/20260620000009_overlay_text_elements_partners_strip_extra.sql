-- Overlay Design Page v2 — Wave 2 Stage 3 (1/1)
-- ------------------------------------------------------------------
-- Augment the seed catalog from migration 20260620000007 with the
-- `partners-strip` element_id for two overlays the original seed
-- omitted: `06-h2h-5` and `17-penalties`. Both have a `<footer
-- class="partners">` container in their HTML and now (Stage 3) carry
-- `data-element-id="partners-strip"` so the partner-strip editor can
-- target them.
--
-- `10-up-next-bug` does NOT have a partner strip in its HTML (it's a
-- compact "next match" badge), so we don't seed it.
--
-- Idempotent — ON CONFLICT DO NOTHING so re-running a partial deploy
-- is safe.
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
    raise notice 'overlay_text_elements_partners_strip_extra: no users found, skipping seed';
    return;
  end if;

  insert into public.overlay_text_elements
    (overlay_key, variant_id, element_id, origin, kind, content, set_by)
  values
    ('06-h2h-5',     'default', 'partners-strip', 'seed', 'layout', '', v_set_by),
    ('17-penalties', 'default', 'partners-strip', 'seed', 'layout', '', v_set_by)
  on conflict (overlay_key, variant_id, element_id) do nothing;
end$$;
