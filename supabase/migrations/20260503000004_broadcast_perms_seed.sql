-- Plan 12 — broadcast permission seed.
-- admin already holds '*' wildcard (see 20260428000003) so broadcast.* is
-- implicitly covered. Production gets broadcast.trigger (not manage).
-- Idempotent with ON CONFLICT DO NOTHING so re-running is a no-op.
insert into public.role_permissions (role, permission) values
  ('production', 'broadcast.trigger')
on conflict (role, permission) do nothing;
