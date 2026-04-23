-- Plan 46 — grant attendance.mark + attendance.edit to the `referee` role
-- so refs can actually write marks from the new /referee/attendance surface.
-- The middleware lets referees through /referee/*, but the server actions
-- (markAction / editAction) still require these specific permissions via
-- requirePermAsync; without this seed, every ref write would 403.
--
-- Idempotent: ON CONFLICT DO NOTHING keeps re-runs safe.

insert into public.role_permissions (role, permission) values
  ('referee', 'attendance.mark'),
  ('referee', 'attendance.edit')
on conflict (role, permission) do nothing;
