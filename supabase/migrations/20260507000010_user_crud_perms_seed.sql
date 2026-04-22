-- Plan 34 — User CRUD permissions seed.
-- Adds the four user-management permission strings that the admin console's
-- new add/edit/reset-password/soft-delete flows enforce via hasPermAsync.
-- Idempotent: ON CONFLICT DO NOTHING so re-running is a no-op.

insert into public.role_permissions (role, permission) values
  -- write paths: admin only
  ('admin', 'users.create'),
  ('admin', 'users.edit'),
  ('admin', 'users.delete'),

  -- read path: admin (already covered by *), plus loc + idc since they
  -- legitimately need to see the user list to do their own jobs.
  ('admin', 'users.read'),
  ('loc',   'users.read'),
  ('idc',   'users.read')

on conflict (role, permission) do nothing;
