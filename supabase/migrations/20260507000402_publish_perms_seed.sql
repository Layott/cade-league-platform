-- Plan 27 — seed the new `match_days.publish` permission.
-- Admin already wins via the '*' wildcard, but seeding it explicitly keeps
-- the role_permissions table self-documenting for the LOC role.
-- Idempotent: ON CONFLICT DO NOTHING.

insert into public.role_permissions (role, permission) values
  ('admin', 'match_days.publish'),
  ('loc',   'match_days.publish')
on conflict (role, permission) do nothing;
