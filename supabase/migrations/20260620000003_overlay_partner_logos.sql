-- Overlay Design Page v2 — Wave 2 Stage 1 (3/8)
-- ------------------------------------------------------------------
-- `overlay_partner_logos` — global roster of partner logos shared
-- across every overlay that displays the partner strip. Admins manage
-- order via `sort_order`; per-overlay enable/sort overrides live in
-- `overlay_partner_logo_overrides` (migration 4).
--
-- Dimension columns enforce the 600×300 ±10% contract; SVG uploads
-- bypass the check with default 600×300 markers per spec §10.6.
-- file_size_bytes is stored for forensics + admin display.
--
-- RLS deny-direct; writes route through
-- `apps/web/src/server/overlays/partners/logos.ts` gated on
-- `overlay.design.manage`. Audit attached via `attach_audit`.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.3
-- ------------------------------------------------------------------

create table if not exists public.overlay_partner_logos (
  id                 uuid primary key default gen_random_uuid(),
  partner_key        text not null,
  label              text not null,
  alt                text not null,
  file_url           text not null,
  file_size_bytes    int not null check (file_size_bytes > 0),
  dimension_w_px     int not null,
  dimension_h_px     int not null,
  sort_order         int not null default 0,
  set_by             uuid not null references public.users (id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create unique index if not exists overlay_partner_logos_partner_key_unique
  on public.overlay_partner_logos (partner_key)
  where deleted_at is null;

create index if not exists overlay_partner_logos_sort_idx
  on public.overlay_partner_logos (sort_order)
  where deleted_at is null;

select public.attach_audit('public.overlay_partner_logos');

alter table public.overlay_partner_logos enable row level security;

drop policy if exists overlay_partner_logos_no_direct on public.overlay_partner_logos;
create policy overlay_partner_logos_no_direct
  on public.overlay_partner_logos
  for all
  using (false)
  with check (false);
