-- Register the new `19-player-squads` v2 overlay template variant + seed
-- a baseline set of `overlay_text_elements` rows so the design page can
-- be used to tune the title block / chemistry / formation copy without
-- touching the static HTML.
--
-- The static HTML at `apps/web/public/overlays/v2/19-player-squads/index.html`
-- already has hard-coded fallback copy ("MR OGA / DRAFT", "CHEMISTRY",
-- "FORMATION", "SUBS"). Seed rows here mirror those defaults so admins
-- see a populated catalog when they open `/admin/broadcast/v2/design?overlay=19-player-squads`.
--
-- Idempotent — `on conflict ... do nothing` on every insert. Safe to
-- re-run.

insert into public.overlay_template_variants
  (overlay_key, variant_id, label, html_path, active)
values
  (
    '19-player-squads',
    'default',
    '19-player-squads',
    'apps/web/public/overlays/v2/19-player-squads/index.html',
    true
  )
on conflict (overlay_key, variant_id) do nothing;

-- Seed text-element rows. `set_by` is the bootstrap admin if it exists
-- otherwise the first user with the `admin` role. Falls through silently
-- when no admin row is present (test seeds).
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
    raise notice 'No admin user found — skipping overlay_text_elements seed for 19-player-squads.';
    return;
  end if;

  insert into public.overlay_text_elements
    (overlay_key, variant_id, element_id, origin, kind, display_label,
     content, sort_order, set_by)
  values
    ('19-player-squads', 'default', 'draft-label',     'seed', 'subheading', 'Draft eyebrow',         'DRAFT',     1, admin_user_id),
    ('19-player-squads', 'default', 'chemistry-label', 'seed', 'label',      'Chemistry label',       'CHEMISTRY', 2, admin_user_id),
    ('19-player-squads', 'default', 'formation-label', 'seed', 'label',      'Formation label',       'FORMATION', 3, admin_user_id),
    ('19-player-squads', 'default', 'subs-label',      'seed', 'heading',    'Subs panel header',     'SUBS',      4, admin_user_id)
  on conflict (overlay_key, variant_id, element_id) where deleted_at is null do nothing;
end$$;
