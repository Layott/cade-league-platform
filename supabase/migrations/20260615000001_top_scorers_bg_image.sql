-- Bug 3 (2026-04-28) — extend bg-image support to 14-top-scorers
-- ------------------------------------------------------------------
-- Phase A (migration 20260612000001) seeded the `bg-image` token for
-- eight full-canvas overlays. User reported that 14-top-scorers (the
-- Golden Pad podium) is also a full-canvas surface — it paints the
-- ELITE S2 stadium BG over the entire 1920x1080 frame — but the upload
-- modal didn't render in `/admin/broadcast/v2/design` because the key
-- wasn't in the `BG_IMAGE_SUPPORTED_KEYS` list (defaults.ts) or the
-- DB seed.
--
-- This migration mirrors the Phase A pattern for that one key:
--   - Empty string token_value = "use HTML fallback" so the resolver
--     hands through and the iframe falls back to the hard-coded
--     ELITE S2 BG image baked into the static HTML.
--   - `set_by` is the first admin user; same fallback ladder as Phase A.
--   - Idempotent — ON CONFLICT DO NOTHING so re-running this migration
--     after seeded data exists is a no-op.
--
-- Companion code change: `BG_IMAGE_SUPPORTED_KEYS` in
-- apps/web/src/server/overlays/design/defaults.ts now includes
-- "14-top-scorers". The HTML at
-- KNOWLEDGE/brand-assets/elements/v2/14-top-scorers/index.html (and
-- its public mirror) gains the cade-token-bootstrap script + a
-- `var(--overlay-bg-image, ...)` declaration on `.bg-image`.
-- ------------------------------------------------------------------

do $$
declare
  v_set_by uuid;
begin
  select u.id into v_set_by
  from public.users u
  join public.user_roles ur on ur.user_id = u.id and ur.role = 'admin' and ur.deleted_at is null
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
    raise notice 'overlay_design_tokens 14-top-scorers bg-image seed: no users yet — skipping (runtime saveTokensAction will create on first admin save)';
    return;
  end if;

  insert into public.overlay_design_tokens
    (overlay_key, variant_id, token_key, token_value, token_type, set_by)
  values
    ('14-top-scorers', 'default', 'bg-image', '', 'image', v_set_by)
  on conflict (overlay_key, variant_id, token_key) do nothing;
end$$;
