-- Plan 42 — seed `broadcast.match_control` permission.
-- Admin already holds `*` wildcard → matches implicitly, but we seed it
-- explicitly so the role_permissions table stays self-documenting for the
-- future role-grid UI (same pattern as Plan 37 + Plan 41 seeds).
-- Production gets it so a dedicated producer (without full broadcast.manage)
-- can run the match-flow panel during live streams.
-- Idempotent: ON CONFLICT DO NOTHING lets re-runs no-op.

insert into public.role_permissions (role, permission) values
  ('admin', 'broadcast.match_control'),
  ('production', 'broadcast.match_control')
on conflict (role, permission) do nothing;
