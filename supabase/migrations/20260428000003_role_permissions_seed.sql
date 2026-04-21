-- Seed role_permissions from the Phase 1A hard-coded map in apps/web/src/perms.ts.
-- Idempotent: ON CONFLICT DO NOTHING so re-running is a no-op.
-- Viewer gets zero rows (its perms are served by PUBLIC_PERMS const at runtime).
-- Admin gets the literal '*' wildcard, matching current perms.ts behaviour.
insert into public.role_permissions (role, permission) values
  -- admin (wildcard)
  ('admin', '*'),

  -- moderator
  ('moderator', 'announcements.*'),
  ('moderator', 'punishments.issue'),
  ('moderator', 'punishments.edit'),
  ('moderator', 'punishments.read'),
  ('moderator', 'attendance.mark'),
  ('moderator', 'attendance.edit'),
  ('moderator', 'matches.read'),
  ('moderator', 'standings.read'),
  ('moderator', 'audit.read'),

  -- player
  ('player', 'matches.read'),
  ('player', 'standings.read'),
  ('player', 'announcements.read.own'),
  ('player', 'profile.edit.own')

on conflict (role, permission) do nothing;

-- All other roles (loc, idc, referee, technical, production, design,
-- coach, team_manager, viewer) deliberately start with ZERO rows.
-- Admin uses the editor to grant them as the league actually needs them.
