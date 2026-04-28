-- Overlay Design System Phase 1 (2/4)
-- ------------------------------------------------------------------
-- `overlay_design_tokens` — typed key/value tokens overriding the
-- hard-coded defaults in `apps/web/src/server/overlays/design/
-- defaults.ts`. The SSR overlay route resolves DB rows over defaults
-- and injects them as CSS variables (e.g. `--overlay-accent-color`).
--
-- This migration creates the table only — defaults.ts ships the
-- baseline values, so we deliberately seed ZERO rows here.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §3.2
-- ------------------------------------------------------------------

create table public.overlay_design_tokens (
  id            uuid primary key default gen_random_uuid(),
  overlay_key   text not null,
  variant_id    text not null default 'default',
  token_key     text not null,
  token_value   text not null,
  token_type    text not null check (token_type in (
                  'color','font','number','boolean','enum','string')),
  set_by        uuid not null references public.users (id) on delete restrict,
  set_at        timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (overlay_key, variant_id, token_key)
);

create index overlay_design_tokens_lookup_idx
  on public.overlay_design_tokens (overlay_key, variant_id)
  where deleted_at is null;

create index overlay_design_tokens_set_by_idx
  on public.overlay_design_tokens (set_by, set_at desc)
  where deleted_at is null;

select public.attach_audit('public.overlay_design_tokens');

-- Service-role only. Writes gate on `overlay.design.manage` perm in the
-- server module (`apps/web/src/server/overlays/design/tokens.ts`).
alter table public.overlay_design_tokens enable row level security;

create policy overlay_design_tokens_no_direct
  on public.overlay_design_tokens
  for all
  using (false)
  with check (false);

-- NO SEED ROWS. defaults.ts is the source of truth for "what the
-- overlay looks like when no DB token is set". Seeding rows here would
-- duplicate that map and create drift between code + DB.
