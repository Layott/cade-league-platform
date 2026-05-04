-- Plan 54 — Broadcast Social Media (Wave 1A, migration 3/6).
--
-- Attach the standard audit trigger to `social_render_jobs`. Runs as
-- its own migration (after the CREATE TABLE in 20260801000001) so
-- `attach_audit()` resolves the freshly created relation cleanly.
--
-- `social_render_templates` is config-only and skipped — its mutation
-- audit lives in the Server Action audit context, not row-level.
--
-- Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §4

select public.attach_audit('public.social_render_jobs');
