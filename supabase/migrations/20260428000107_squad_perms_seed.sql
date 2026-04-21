-- Plan 10 — add squads.* permissions to the DB-backed role_permissions table.
-- Admin already has '*' wildcard; no entry needed.
--
-- Wiring per Plan 10 §7 (Plan 9 naming):
--   referee, loc  → squads.validate + squads.change_authorize
--   player        → squads.submit.own
--   admin         → (already wildcard)
--
-- Idempotent: ON CONFLICT DO NOTHING lets re-runs no-op.
insert into public.role_permissions (role, permission) values
  ('referee', 'squads.validate'),
  ('referee', 'squads.change_authorize'),
  ('loc', 'squads.validate'),
  ('loc', 'squads.change_authorize'),
  ('player', 'squads.submit.own')
on conflict (role, permission) do nothing;
