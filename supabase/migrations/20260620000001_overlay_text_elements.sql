-- Overlay Design Page v2 — Wave 2 Stage 1 (1/8)
-- ------------------------------------------------------------------
-- `overlay_text_elements` — per-(overlay_key, variant_id, element_id)
-- text content + typography overrides. Each row is either an OVERRIDE
-- of an existing HTML element matched by `data-element-id` (origin='seed')
-- OR a runtime-injected element added by an admin (origin='runtime').
--
-- All typography fields are nullable: a row's mere presence does NOT
-- override every prop — only populated fields flow into the per-element
-- CSS. This is the only way "user changed only the color, kept the
-- font" works without snapshotting HTML defaults into the DB.
--
-- RLS deny-direct; writes route through
-- `apps/web/src/server/overlays/text/elements.ts` gated on
-- `overlay.design.manage`. Audit attached via `attach_audit`.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.1
-- ------------------------------------------------------------------

create table if not exists public.overlay_text_elements (
  id              uuid primary key default gen_random_uuid(),
  overlay_key     text not null,
  variant_id      text not null default 'default',
  element_id      text not null,
  origin          text not null default 'seed'
                  check (origin in ('seed','runtime')),
  kind            text not null default 'caption'
                  check (kind in (
                    'heading','subheading','eyebrow','title',
                    'subtitle','caption','number','label','body','image','layout'
                  )),
  visible         boolean not null default true,
  content         text not null default '',
  font_family     text null,
  font_weight     int null check (font_weight is null or font_weight between 100 and 900),
  font_size_px    int null check (font_size_px is null or font_size_px between 8 and 400),
  letter_spacing  numeric null check (letter_spacing is null or letter_spacing between -0.1 and 1.0),
  line_height     numeric null check (line_height is null or line_height between 0.6 and 3.0),
  color           text null,
  alignment       text null check (alignment is null or alignment in ('left','center','right','justify')),
  opacity_pct     int null check (opacity_pct is null or opacity_pct between 0 and 100),
  position_x_px   int null,
  position_y_px   int null,
  z_index         int null check (z_index is null or z_index between 0 and 40),
  sort_order      int not null default 0,
  set_by          uuid not null references public.users (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Partial unique index: re-create-with-same-id after soft-delete works.
create unique index if not exists overlay_text_elements_unique_active
  on public.overlay_text_elements (overlay_key, variant_id, element_id)
  where deleted_at is null;

create index if not exists overlay_text_elements_lookup_idx
  on public.overlay_text_elements (overlay_key, variant_id)
  where deleted_at is null;

create index if not exists overlay_text_elements_set_by_idx
  on public.overlay_text_elements (set_by, updated_at desc)
  where deleted_at is null;

select public.attach_audit('public.overlay_text_elements');

alter table public.overlay_text_elements enable row level security;

drop policy if exists overlay_text_elements_no_direct on public.overlay_text_elements;
create policy overlay_text_elements_no_direct
  on public.overlay_text_elements
  for all
  using (false)
  with check (false);
