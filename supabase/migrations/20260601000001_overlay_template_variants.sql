-- Overlay Design System Phase 1 (1/4)
-- ------------------------------------------------------------------
-- `overlay_template_variants` — gallery of HTML template variants per
-- overlay_key. The `default` variant is seeded for all 16 routable
-- overlay keys (matches ALLOWED_KEYS in
-- apps/web/src/app/(overlay)/overlay/v2/[key]/page.tsx). Engineering
-- authors a new HTML at templates/<variant_id>/index.html and inserts
-- a row here; admin picks which variant is active via the design tab.
-- A partial unique index enforces "one active variant per overlay_key"
-- among non-soft-deleted rows.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §3.1
-- ------------------------------------------------------------------

create table public.overlay_template_variants (
  id              uuid primary key default gen_random_uuid(),
  overlay_key     text not null,
  variant_id      text not null,
  label           text not null,
  description     text,
  html_path       text not null,
  thumbnail_path  text,
  active          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (overlay_key, variant_id)
);

create unique index overlay_template_variants_active_unique
  on public.overlay_template_variants (overlay_key)
  where active = true and deleted_at is null;

create index overlay_template_variants_overlay_key_idx
  on public.overlay_template_variants (overlay_key)
  where deleted_at is null;

select public.attach_audit('public.overlay_template_variants');

-- Service-role only; admin reads come through server modules with the
-- `overlay.design.manage` (writes) and `broadcast.match_control` (reads)
-- perm gates. Direct client access denied.
alter table public.overlay_template_variants enable row level security;

create policy overlay_template_variants_no_direct
  on public.overlay_template_variants
  for all
  using (false)
  with check (false);

-- Seed: one `default` variant per existing overlay key. Each row points
-- at the current `apps/web/public/overlays/v2/<key>/index.html` so the
-- system is no-op on first deploy. `active=true` because each overlay
-- only has one variant at this point.
insert into public.overlay_template_variants
  (overlay_key, variant_id, label, html_path, active)
values
  ('01-brb',                  'default', '01-brb',                  'apps/web/public/overlays/v2/01-brb/index.html',                  true),
  ('02-timer',                'default', '02-timer',                'apps/web/public/overlays/v2/02-timer/index.html',                true),
  ('04-h2h-2',                'default', '04-h2h-2',                'apps/web/public/overlays/v2/04-h2h-2/index.html',                true),
  ('05-h2h-3',                'default', '05-h2h-3',                'apps/web/public/overlays/v2/05-h2h-3/index.html',                true),
  ('06-h2h-5',                'default', '06-h2h-5',                'apps/web/public/overlays/v2/06-h2h-5/index.html',                true),
  ('07-leaderboard',          'default', '07-leaderboard',          'apps/web/public/overlays/v2/07-leaderboard/index.html',          true),
  ('08-lower-third',          'default', '08-lower-third',          'apps/web/public/overlays/v2/08-lower-third/index.html',          true),
  ('09-secondary-score-bug',  'default', '09-secondary-score-bug',  'apps/web/public/overlays/v2/09-secondary-score-bug/index.html',  true),
  ('10-up-next-bug',          'default', '10-up-next-bug',          'apps/web/public/overlays/v2/10-up-next-bug/index.html',          true),
  ('11-match-scores-day',     'default', '11-match-scores-day',     'apps/web/public/overlays/v2/11-match-scores-day/index.html',     true),
  ('12-starting-soon',        'default', '12-starting-soon',        'apps/web/public/overlays/v2/12-starting-soon/index.html',        true),
  ('13-stream-ended',         'default', '13-stream-ended',         'apps/web/public/overlays/v2/13-stream-ended/index.html',         true),
  ('14-top-scorers',          'default', '14-top-scorers',          'apps/web/public/overlays/v2/14-top-scorers/index.html',          true),
  ('15-orgs',                 'default', '15-orgs',                 'apps/web/public/overlays/v2/15-orgs/index.html',                 true),
  ('16-coaches',              'default', '16-coaches',              'apps/web/public/overlays/v2/16-coaches/index.html',              true),
  ('17-penalties',            'default', '17-penalties',            'apps/web/public/overlays/v2/17-penalties/index.html',            true)
on conflict (overlay_key, variant_id) do nothing;
