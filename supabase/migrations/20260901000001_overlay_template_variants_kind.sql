-- Overlay Builder Wave 1A — Task 2 (1/2).
-- ------------------------------------------------------------------
-- Add `kind` column to `overlay_template_variants` so the SSR overlay
-- route can distinguish between static-HTML variants (existing 27
-- built-in overlays, served from /overlays/v2/<key>/index.html) and
-- dynamic compiled-at-request-time variants (user-authored designs
-- under `user-<slug>` keys, rendered by /overlay/v2/user/[slug]).
--
-- Backfill is implicit via DEFAULT 'static' — every existing row
-- becomes kind='static' on column add. The CHECK constraint locks
-- the value space to ('static','dynamic') for forward safety.
--
-- No data migration step needed — additive only.
--
-- Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §3.7
-- ------------------------------------------------------------------

alter table public.overlay_template_variants
  add column kind text not null default 'static'
    check (kind in ('static','dynamic'));

comment on column public.overlay_template_variants.kind is
  'static = points at /overlays/v2/<key>/index.html on disk; '
  'dynamic = compiled at request time by /overlay/v2/user/[slug] route. '
  'See docs/superpowers/specs/2026-05-17-overlay-builder-design.md §3.7.';
