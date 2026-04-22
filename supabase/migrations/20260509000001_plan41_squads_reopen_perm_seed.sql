-- Plan 41 — seed the new `squads.reopen` permission used by the admin
-- "Reopen submission" button on /admin/squads/[id]. Admin wildcard already
-- matches, but seed it explicitly so the permission is discoverable in the
-- role_permissions table and to keep future role-grid rendering honest.
-- Idempotent: ON CONFLICT DO NOTHING lets re-runs no-op.

insert into public.role_permissions (role, permission) values
  ('admin', 'squads.reopen')
on conflict (role, permission) do nothing;
