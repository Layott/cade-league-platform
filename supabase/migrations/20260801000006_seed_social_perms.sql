-- Plan 54 — Broadcast Social Media (Wave 1A, migration 6/6).
--
-- Seed the four `social.*` permissions across the appropriate roles.
-- Admin already holds the `*` wildcard so technically these admin
-- rows are redundant for runtime checks — but we seed them
-- explicitly to keep `role_permissions` self-documenting for the
-- future role-grid UI (matching the Plan 42 / Plan 51 pattern).
--
-- Wave 2 will mirror these grants in `apps/web/src/perms.ts` so the
-- TypeScript constant stays the seed-of-truth doc. This migration is
-- the runtime source per CLAUDE.md §2.
--
-- Idempotent: ON CONFLICT DO NOTHING lets re-runs no-op.
--
-- Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §5

insert into public.role_permissions (role, permission) values
  -- social.read — view jobs + templates
  ('admin',      'social.read'),
  ('design',     'social.read'),
  ('production', 'social.read'),
  ('moderator',  'social.read'),
  -- social.render — trigger a new render
  ('admin',      'social.render'),
  ('design',     'social.render'),
  ('production', 'social.render'),
  -- social.approve — mark a job approved
  ('admin',      'social.approve'),
  ('design',     'social.approve'),
  ('production', 'social.approve'),
  -- social.delete — soft-delete a job
  ('admin',      'social.delete')
on conflict (role, permission) do nothing;
