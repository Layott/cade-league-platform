-- Overlay Design Page v2 — Wave 2 Stage 5 (universal element labels + kinds)
-- ------------------------------------------------------------------
-- Add a separate `display_label` column to `overlay_partner_logos` so
-- admins can rename a logo for the editor UI without altering the
-- accessibility `alt` text the static HTML renders. Existing rows have
-- their `alt` value copied into `display_label` so the first deploy is
-- a no-op; admins can rename later via the partner-logo editor.
--
-- Idempotent — `if not exists` on the column add, conditional update
-- on the backfill so re-running is safe.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.3
-- ------------------------------------------------------------------

alter table public.overlay_partner_logos
  add column if not exists display_label text;

-- Backfill: copy `alt` into `display_label` for any rows where the
-- label hasn't been set yet (so admin renames stick).
update public.overlay_partner_logos
set display_label = alt
where display_label is null
  and deleted_at is null;
