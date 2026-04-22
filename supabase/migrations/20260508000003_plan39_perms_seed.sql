-- Plan 39 C4 — seed admin-only perms for the two surfaces whose actions
-- now re-check perms (trash restore + session revoke).
-- Idempotent: ON CONFLICT DO NOTHING.

insert into public.role_permissions (role, permission) values
  ('admin', 'trash.restore'),
  ('admin', 'sessions.revoke'),
  ('admin', 'sessions.read')
on conflict (role, permission) do nothing;
