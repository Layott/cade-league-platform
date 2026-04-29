-- Overlay Design Page v2 — Wave 2 Stage 1 (5/8)
-- ------------------------------------------------------------------
-- `overlay_element_animations` — per-(overlay_key, variant_id,
-- element_id, anim_phase) animation config. Multiple phases per
-- element are supported (entry + continuous + exit at once); the
-- bootstrap script generates `@keyframes` + chained `animation:` rules
-- accordingly.
--
-- Phase semantics:
--   entry      — runs once when body.cade-visible flips on
--   exit       — runs once when body.cade-exiting flips on
--   continuous — runs while body.cade-visible (typically infinite)
--
-- `custom_css_keyframes` is server-side sanitized via
-- `apps/web/src/server/overlays/animations/sanitize_keyframes.ts`
-- before insert/update — only an allowlisted set of CSS properties
-- are permitted, no url(), no @import, no nested rules.
--
-- Mutable (NOT append-only) — admins frequently tweak duration/easing.
-- The audit trigger captures every UPDATE in `audit_events` for
-- forensics; revert UX layered later.
--
-- RLS deny-direct; writes route through
-- `apps/web/src/server/overlays/animations/elements.ts` gated on
-- `overlay.design.manage`. Audit attached via `attach_audit`.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.5
-- ------------------------------------------------------------------

create table if not exists public.overlay_element_animations (
  id                   uuid primary key default gen_random_uuid(),
  overlay_key          text not null,
  variant_id           text not null default 'default',
  element_id           text not null,
  anim_phase           text not null
                       check (anim_phase in ('entry','exit','continuous')),
  enabled              boolean not null default true,
  anim_type            text not null
                       check (anim_type in (
                         'slide-left','slide-right','slide-up','slide-down',
                         'fade','scale','rotate','bounce','pulse',
                         'glow','shake','flip','custom-css','none'
                       )),
  duration_ms          int not null default 360
                       check (duration_ms between 50 and 5000),
  delay_ms             int not null default 0
                       check (delay_ms between 0 and 5000),
  easing               text not null default 'ease-out',
  iteration_count      text not null default '1',
  custom_css_keyframes text null,
  set_by               uuid not null references public.users (id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint overlay_element_animations_iteration_count_check
    check (
      iteration_count = 'infinite'
      or (iteration_count ~ '^\d{1,3}$' and iteration_count::int between 1 and 100)
    ),
  constraint overlay_element_animations_easing_check
    check (
      easing in ('linear','ease','ease-in','ease-out','ease-in-out','step-start','step-end')
      or easing ~ '^cubic-bezier\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*\)$'
    )
);

create unique index if not exists overlay_element_animations_unique_active
  on public.overlay_element_animations (overlay_key, variant_id, element_id, anim_phase)
  where deleted_at is null;

create index if not exists overlay_element_animations_lookup_idx
  on public.overlay_element_animations (overlay_key, variant_id)
  where deleted_at is null;

select public.attach_audit('public.overlay_element_animations');

alter table public.overlay_element_animations enable row level security;

drop policy if exists overlay_element_animations_no_direct on public.overlay_element_animations;
create policy overlay_element_animations_no_direct
  on public.overlay_element_animations
  for all
  using (false)
  with check (false);
