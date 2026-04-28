-- Overlay Design System Phase 1 (4/4)
-- ------------------------------------------------------------------
-- Seed `overlay.design.manage` permission for the three roles allowed
-- to mutate overlay tokens / template variants / revert snapshots.
--
-- READ access for the design tab is covered by the existing
-- `broadcast.match_control` perm; no read-side seed needed here.
--
-- The `role_permissions` table uses column name `permission` (NOT the
-- spec-draft `perm`); aligning with the live schema established by
-- migration 20260428000002_role_permissions.sql.
--
-- Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §3.4
-- ------------------------------------------------------------------

insert into public.role_permissions (role, permission) values
  ('admin',      'overlay.design.manage'),
  ('design',     'overlay.design.manage'),
  ('production', 'overlay.design.manage')
on conflict (role, permission) do nothing;
