-- Overlay Design System Phase A — extend token_type CHECK to allow 'image'
-- ------------------------------------------------------------------
-- Adds 'image' to the allowed `token_type` values so the design editor
-- can persist a background-image URL per overlay+variant. The image is
-- uploaded to the `overlay-bgs` storage bucket (see migration
-- 20260612000002) and the public URL is stored as the token_value.
--
-- Seeds the `bg-image` token (value = '' = use HTML fallback) for the
-- eight full-canvas overlays where a custom backdrop is supported:
--   01-brb, 04-h2h-2, 05-h2h-3, 06-h2h-5,
--   07-leaderboard, 11-match-scores-day, 12-starting-soon, 13-stream-ended
-- The other eight overlays (timer / lower-third / score-bug / up-next /
-- top-scorers / orgs / coaches / penalties) are floating UI cards on a
-- transparent canvas, so a backdrop image makes no sense for them and
-- the admin UI must NOT render the image widget for those keys.
--
-- Idempotent — the constraint rewrite is no-op when 'image' is already
-- in the list, and the seed inserts use ON CONFLICT DO NOTHING.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §3.2
-- Companion: apps/web/src/server/overlays/design/defaults.ts
-- ------------------------------------------------------------------

-- 1. Drop + recreate the CHECK constraint to add 'image'.
--    Constraint name from migration 20260601000002 is the implicit one
--    Postgres assigns; we look it up by table + check_clause to be safe.
do $$
declare
  v_constraint_name text;
begin
  select constraint_name into v_constraint_name
  from information_schema.check_constraints
  where constraint_schema = 'public'
    and check_clause like '%token_type%color%font%'
  limit 1;

  if v_constraint_name is not null then
    execute format(
      'alter table public.overlay_design_tokens drop constraint %I',
      v_constraint_name
    );
  end if;

  alter table public.overlay_design_tokens
    add constraint overlay_design_tokens_token_type_check
    check (token_type in (
      'color','font','number','boolean','enum','string','image'
    ));
end$$;

-- 2. Seed default `bg-image` rows for the eight full-canvas overlays.
--    Empty string = "use HTML fallback" — the SSR resolver hands the
--    token through to the iframe, and the iframe-side script skips
--    serializing image tokens whose value is empty (see CSS rule
--    `background-image: var(--overlay-bg-image, <html-fallback>)`).
--
--    We require a system user to satisfy the FK on `set_by`. Pick the
--    first admin row; if no admin exists yet (e.g. fresh schema before
--    seeds), pick any user; if there are still none, skip the seed
--    entirely (the table is empty, so set_by NOT NULL can't be
--    satisfied — the runtime upsert from `setDesignToken` will create
--    the row when the first admin saves).
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
    raise notice 'overlay_design_tokens bg-image seed: no users in public.users yet — skipping seed (runtime saveTokensAction will create on first admin save)';
    return;
  end if;

  insert into public.overlay_design_tokens
    (overlay_key, variant_id, token_key, token_value, token_type, set_by)
  values
    ('01-brb',              'default', 'bg-image', '', 'image', v_set_by),
    ('04-h2h-2',            'default', 'bg-image', '', 'image', v_set_by),
    ('05-h2h-3',            'default', 'bg-image', '', 'image', v_set_by),
    ('06-h2h-5',            'default', 'bg-image', '', 'image', v_set_by),
    ('07-leaderboard',      'default', 'bg-image', '', 'image', v_set_by),
    ('11-match-scores-day', 'default', 'bg-image', '', 'image', v_set_by),
    ('12-starting-soon',    'default', 'bg-image', '', 'image', v_set_by),
    ('13-stream-ended',     'default', 'bg-image', '', 'image', v_set_by)
  on conflict (overlay_key, variant_id, token_key) do nothing;
end$$;
