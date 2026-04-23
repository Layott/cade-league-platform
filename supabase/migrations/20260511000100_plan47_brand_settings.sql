-- Plan 47 — Site Manager branding registry.
--
-- Two tables + one public storage bucket + one admin perm seed:
--   1. `brand_settings` — singleton-ish key/value for brand colors.
--      Rows keyed by id with a stable "active" row surfaced by
--      getBrandConfig(); new rows are append-style but we only ever
--      insert one seed + updates. Audit trigger captures every change.
--   2. `brand_assets` — slotted logo registry
--      (primary.cade, partner.traceTv, partner.gamepride, etc.). A row
--      holds the storage path + display_order + visible flag; the
--      actual PNG lives in the `brand-logos` bucket (public read).
--   3. Storage bucket `brand-logos` (public read, server-role write via
--      signed upload URL using the Plan 13B pattern).
--   4. Perm seed `branding.manage` on admin role.

-- ---- (1) brand_settings ----------------------------------------------
create table public.brand_settings (
  id              serial primary key,
  primary_color   text not null default '#6bcd06',
  secondary_color text not null default '#fe036d',
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.users(id) on delete set null,
  constraint brand_settings_primary_color_chk
    check (primary_color ~* '^#[0-9a-f]{6}$'),
  constraint brand_settings_secondary_color_chk
    check (secondary_color ~* '^#[0-9a-f]{6}$')
);

-- Seed one row (the active settings). getBrandConfig() reads the row
-- with the lowest id, so this is idempotent.
insert into public.brand_settings (primary_color, secondary_color)
values ('#6bcd06', '#fe036d')
on conflict do nothing;

select public.attach_audit('public.brand_settings');

-- ---- (2) brand_assets ------------------------------------------------
create table public.brand_assets (
  id            uuid primary key default gen_random_uuid(),
  slot          text not null unique,
  storage_path  text not null,
  display_order int not null default 0,
  visible       boolean not null default true,
  label         text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.users(id) on delete set null,
  deleted_at    timestamptz,
  constraint brand_assets_slot_format
    check (slot ~ '^(primary|partner)\.[a-z][a-z0-9_]*$')
);

create index brand_assets_display_order_idx
  on public.brand_assets (display_order)
  where deleted_at is null;

select public.attach_audit('public.brand_assets');

-- ---- (3) brand-logos storage bucket ---------------------------------
-- Public-read so overlay pages + SSR nav header can embed without
-- signed-URL round trips. Writes still go through the service-role
-- signed upload pattern.
insert into storage.buckets (id, name, public)
values ('brand-logos', 'brand-logos', true)
on conflict (id) do nothing;

-- ---- (4) RLS + perm seed --------------------------------------------
alter table public.brand_settings enable row level security;
alter table public.brand_assets   enable row level security;

-- Authenticated users can read settings (navbar colour, etc.). Writes
-- require the service-role client which bypasses RLS — admin gating
-- done in the API layer via requirePermAsync('branding.manage').
create policy brand_settings_read_all on public.brand_settings
  for select to authenticated, anon
  using (true);

create policy brand_assets_read_all on public.brand_assets
  for select to authenticated, anon
  using (deleted_at is null);

insert into public.role_permissions (role, permission) values
  ('admin', 'branding.manage')
on conflict (role, permission) do nothing;
