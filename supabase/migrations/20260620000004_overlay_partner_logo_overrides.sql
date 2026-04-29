-- Overlay Design Page v2 — Wave 2 Stage 1 (4/8)
-- ------------------------------------------------------------------
-- `overlay_partner_logo_overrides` — per-(overlay_key, variant_id, partner_key)
-- enable/disable + per-overlay sort override. Most overlays show all
-- registered partners; this table lets an admin hide a logo on a single
-- overlay (e.g. an org-conflict during specific match days) without
-- touching the global roster.
--
-- `sort_override` NULL = inherit global `overlay_partner_logos.sort_order`.
-- A non-null value sorts that partner ahead/behind on this overlay only.
--
-- RLS deny-direct; writes route through
-- `apps/web/src/server/overlays/partners/logos.ts` gated on
-- `overlay.design.manage`. Audit attached via `attach_audit`.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.4
-- ------------------------------------------------------------------

create table if not exists public.overlay_partner_logo_overrides (
  id                 uuid primary key default gen_random_uuid(),
  overlay_key        text not null,
  variant_id         text not null default 'default',
  partner_key        text not null,
  visible            boolean not null default true,
  sort_override      int null,
  set_by             uuid not null references public.users (id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create unique index if not exists overlay_partner_logo_overrides_unique_active
  on public.overlay_partner_logo_overrides (overlay_key, variant_id, partner_key)
  where deleted_at is null;

create index if not exists overlay_partner_logo_overrides_lookup_idx
  on public.overlay_partner_logo_overrides (overlay_key, variant_id)
  where deleted_at is null;

select public.attach_audit('public.overlay_partner_logo_overrides');

alter table public.overlay_partner_logo_overrides enable row level security;

drop policy if exists overlay_partner_logo_overrides_no_direct on public.overlay_partner_logo_overrides;
create policy overlay_partner_logo_overrides_no_direct
  on public.overlay_partner_logo_overrides
  for all
  using (false)
  with check (false);
