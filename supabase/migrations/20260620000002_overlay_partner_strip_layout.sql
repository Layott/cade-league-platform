-- Overlay Design Page v2 — Wave 2 Stage 1 (2/8)
-- ------------------------------------------------------------------
-- `overlay_partner_strip_layout` — per-(overlay_key, variant_id) layout
-- of the partner-logo strip container (anchor / position / orientation
-- / scale / spacing / justification / z-index). Mutable upsert; admins
-- frequently nudge these.
--
-- The bootstrap (apps/web/public/overlays/v2/<key>/index.html inline
-- script) translates the `anchor` value into CSS `top|bottom|left|right`
-- offsets paired with the position deltas.
--
-- RLS deny-direct; writes route through
-- `apps/web/src/server/overlays/partners/strip.ts` gated on
-- `overlay.design.manage`. Audit attached via `attach_audit`.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.2
-- ------------------------------------------------------------------

create table if not exists public.overlay_partner_strip_layout (
  id              uuid primary key default gen_random_uuid(),
  overlay_key     text not null,
  variant_id      text not null default 'default',
  visible         boolean not null default true,
  position_x_px   int not null default 0,
  position_y_px   int not null default 1020,
  anchor          text not null default 'bottom-center'
                  check (anchor in (
                    'top-left','top-center','top-right',
                    'middle-left','middle-center','middle-right',
                    'bottom-left','bottom-center','bottom-right'
                  )),
  orientation     text not null default 'horizontal'
                  check (orientation in ('horizontal','vertical')),
  scale_pct       int not null default 100 check (scale_pct between 50 and 200),
  item_spacing_px int not null default 64 check (item_spacing_px between 0 and 256),
  justification   text not null default 'center'
                  check (justification in ('start','center','end','space-between')),
  z_index         int not null default 12 check (z_index between 0 and 40),
  set_by          uuid not null references public.users (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create unique index if not exists overlay_partner_strip_layout_unique_active
  on public.overlay_partner_strip_layout (overlay_key, variant_id)
  where deleted_at is null;

create index if not exists overlay_partner_strip_layout_lookup_idx
  on public.overlay_partner_strip_layout (overlay_key, variant_id)
  where deleted_at is null;

select public.attach_audit('public.overlay_partner_strip_layout');

alter table public.overlay_partner_strip_layout enable row level security;

drop policy if exists overlay_partner_strip_layout_no_direct on public.overlay_partner_strip_layout;
create policy overlay_partner_strip_layout_no_direct
  on public.overlay_partner_strip_layout
  for all
  using (false)
  with check (false);
