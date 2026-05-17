-- Overlay Builder Wave 1A — Task 3 (2/2).
-- ------------------------------------------------------------------
-- Six new tables under the `overlay_user_*` namespace for the visual
-- drag-drop overlay builder. All mutable tables get the canonical
-- (created_at, updated_at, created_by, deleted_at) tuple plus
-- `attach_audit()` for the audit-event ledger. The history table is
-- append-only (mutation triggers raise, mirroring `audit_events`
-- and `overlay_design_history`).
--
-- RLS is service-role only on every table; server modules gate writes
-- on `overlay.design.manage` via `hasPermAsync()` per CLAUDE.md §2.
-- No PUBLIC policy is created — the same pattern as
-- `overlay_template_variants` and `overlay_design_tokens`.
--
-- Storage bucket `overlay-user-assets` is private; signed URLs are
-- minted server-side for editor previews. Published designs that need
-- public asset access proxy through a route that checks
-- design.status='published'.
--
-- Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §3
-- ------------------------------------------------------------------

-- ----- 0. Shared helper -------------------------------------------
-- `set_updated_at()` does not exist in any prior migration (verified
-- via grep). Define it here as a reusable helper that future
-- migrations can also call. Idempotent via `create or replace`.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----- 1. overlay_user_designs ------------------------------------
create table public.overlay_user_designs (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null,
  title          text not null,
  description    text,
  mode           text not null check (mode in ('single','sequence')),
  status         text not null default 'draft'
                   check (status in ('draft','published')),
  canvas_width   int  not null default 1920,
  canvas_height  int  not null default 1080,
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create unique index overlay_user_designs_slug_unique
  on public.overlay_user_designs (slug)
  where deleted_at is null;

create index overlay_user_designs_published_idx
  on public.overlay_user_designs (status)
  where status = 'published' and deleted_at is null;

create trigger overlay_user_designs_set_updated_at
  before update on public.overlay_user_designs
  for each row execute function public.set_updated_at();

select public.attach_audit('public.overlay_user_designs');

alter table public.overlay_user_designs enable row level security;

create policy overlay_user_designs_no_direct
  on public.overlay_user_designs
  for all
  using (false)
  with check (false);

-- ----- 2. overlay_user_design_scenes ------------------------------
create table public.overlay_user_design_scenes (
  id              uuid primary key default gen_random_uuid(),
  design_id       uuid not null
                    references public.overlay_user_designs (id)
                    on delete cascade,
  order_index     int  not null,
  name            text,
  duration_ms     int  not null default 5000,
  transition_in   text not null default 'fade'
                    check (transition_in in (
                      'cut','fade','slide-left','slide-right',
                      'slide-up','slide-down')),
  transition_out  text not null default 'fade'
                    check (transition_out in (
                      'cut','fade','slide-left','slide-right',
                      'slide-up','slide-down')),
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create unique index overlay_user_design_scenes_order_unique
  on public.overlay_user_design_scenes (design_id, order_index)
  where deleted_at is null;

create index overlay_user_design_scenes_design_idx
  on public.overlay_user_design_scenes (design_id)
  where deleted_at is null;

create trigger overlay_user_design_scenes_set_updated_at
  before update on public.overlay_user_design_scenes
  for each row execute function public.set_updated_at();

select public.attach_audit('public.overlay_user_design_scenes');

alter table public.overlay_user_design_scenes enable row level security;

create policy overlay_user_design_scenes_no_direct
  on public.overlay_user_design_scenes
  for all
  using (false)
  with check (false);

-- ----- 3. overlay_user_design_elements ----------------------------
create table public.overlay_user_design_elements (
  id               uuid primary key default gen_random_uuid(),
  scene_id         uuid not null
                     references public.overlay_user_design_scenes (id)
                     on delete cascade,
  parent_group_id  uuid references public.overlay_user_design_elements (id)
                     on delete cascade,
  element_type     text not null check (element_type in (
                     'rect','ellipse','line','polygon','path',
                     'text','image','psd-layer','data-slot','group')),
  z_index          int  not null,
  locked           bool not null default false,
  visible          bool not null default true,
  transform        jsonb not null default '{}'::jsonb,
  style            jsonb not null default '{}'::jsonb,
  content          jsonb,
  binding          jsonb,
  animation        jsonb,
  created_by       uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index overlay_user_design_elements_scene_zindex_idx
  on public.overlay_user_design_elements (scene_id, z_index)
  where deleted_at is null;

create index overlay_user_design_elements_parent_group_idx
  on public.overlay_user_design_elements (parent_group_id)
  where deleted_at is null;

create trigger overlay_user_design_elements_set_updated_at
  before update on public.overlay_user_design_elements
  for each row execute function public.set_updated_at();

select public.attach_audit('public.overlay_user_design_elements');

alter table public.overlay_user_design_elements enable row level security;

create policy overlay_user_design_elements_no_direct
  on public.overlay_user_design_elements
  for all
  using (false)
  with check (false);

-- ----- 4. overlay_user_assets -------------------------------------
create table public.overlay_user_assets (
  id                     uuid primary key default gen_random_uuid(),
  asset_type             text not null check (asset_type in (
                           'image','psd','font')),
  file_path              text not null,
  mime_type              text not null,
  original_filename      text not null,
  width                  int,
  height                 int,
  size_bytes             bigint not null,
  owner_user_id          uuid references public.users (id) on delete set null,
  psd_layer_index        int,
  psd_parent_asset_id    uuid references public.overlay_user_assets (id)
                           on delete cascade,
  flat_png_asset_id      uuid references public.overlay_user_assets (id)
                           on delete set null,
  created_by             uuid references public.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create index overlay_user_assets_type_idx
  on public.overlay_user_assets (asset_type)
  where deleted_at is null;

create index overlay_user_assets_psd_parent_idx
  on public.overlay_user_assets (psd_parent_asset_id)
  where deleted_at is null;

create trigger overlay_user_assets_set_updated_at
  before update on public.overlay_user_assets
  for each row execute function public.set_updated_at();

select public.attach_audit('public.overlay_user_assets');

alter table public.overlay_user_assets enable row level security;

create policy overlay_user_assets_no_direct
  on public.overlay_user_assets
  for all
  using (false)
  with check (false);

-- ----- 5. overlay_user_design_fonts -------------------------------
create table public.overlay_user_design_fonts (
  id              uuid primary key default gen_random_uuid(),
  family_name     text not null,
  weight          int  not null default 400,
  style           text not null default 'normal'
                    check (style in ('normal','italic')),
  format          text not null
                    check (format in ('ttf','otf','woff','woff2')),
  asset_id        uuid not null references public.overlay_user_assets (id)
                    on delete restrict,
  woff2_asset_id  uuid references public.overlay_user_assets (id)
                    on delete set null,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create unique index overlay_user_design_fonts_unique_family
  on public.overlay_user_design_fonts (family_name, weight, style)
  where deleted_at is null;

create trigger overlay_user_design_fonts_set_updated_at
  before update on public.overlay_user_design_fonts
  for each row execute function public.set_updated_at();

select public.attach_audit('public.overlay_user_design_fonts');

alter table public.overlay_user_design_fonts enable row level security;

create policy overlay_user_design_fonts_no_direct
  on public.overlay_user_design_fonts
  for all
  using (false)
  with check (false);

-- ----- 6. overlay_user_design_history (append-only) ---------------
create table public.overlay_user_design_history (
  id           uuid primary key default gen_random_uuid(),
  design_id    uuid not null,  -- intentionally NO FK: snapshots survive
                               -- soft-delete of parent design
  snapshot     jsonb not null,
  note         text,
  revert_of    uuid references public.overlay_user_design_history (id)
                 on delete set null,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index overlay_user_design_history_design_idx
  on public.overlay_user_design_history (design_id, created_at desc)
  where deleted_at is null;

-- Append-only enforcement — reuse the existing
-- overlay_design_history_block_mutation() function per CLAUDE.md §15.
-- The function takes no arguments and raises on TG_OP, so it works
-- identically for any table it is attached to.
drop trigger if exists overlay_user_design_history_no_update
  on public.overlay_user_design_history;
create trigger overlay_user_design_history_no_update
  before update on public.overlay_user_design_history
  for each row execute function public.overlay_design_history_block_mutation();

drop trigger if exists overlay_user_design_history_no_delete
  on public.overlay_user_design_history;
create trigger overlay_user_design_history_no_delete
  before delete on public.overlay_user_design_history
  for each row execute function public.overlay_design_history_block_mutation();

select public.attach_audit('public.overlay_user_design_history');

alter table public.overlay_user_design_history enable row level security;

create policy overlay_user_design_history_no_direct
  on public.overlay_user_design_history
  for all
  using (false)
  with check (false);

-- ----- 7. Storage bucket + idempotent policies --------------------
-- Private bucket; reads + writes mediated by server-side signed URLs
-- (service role). Mirrors player-photos bucket pattern from
-- 20260701000013, minus the public-read policy (overlay-user-assets
-- is private — published-asset access is proxied through a route
-- that checks design.status='published').
insert into storage.buckets (id, name, public)
values ('overlay-user-assets', 'overlay-user-assets', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'overlay_user_assets_service_select'
  ) then
    create policy overlay_user_assets_service_select
      on storage.objects
      for select
      to service_role
      using (bucket_id = 'overlay-user-assets');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'overlay_user_assets_service_insert'
  ) then
    create policy overlay_user_assets_service_insert
      on storage.objects
      for insert
      to service_role
      with check (bucket_id = 'overlay-user-assets');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'overlay_user_assets_service_update'
  ) then
    create policy overlay_user_assets_service_update
      on storage.objects
      for update
      to service_role
      using (bucket_id = 'overlay-user-assets')
      with check (bucket_id = 'overlay-user-assets');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'overlay_user_assets_service_delete'
  ) then
    create policy overlay_user_assets_service_delete
      on storage.objects
      for delete
      to service_role
      using (bucket_id = 'overlay-user-assets');
  end if;
end$$;
