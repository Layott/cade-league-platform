-- Plan 51 — perm seeds for the new tournament + broadcast v2 surfaces.
--
-- These rows mirror the runtime grants in apps/web/src/perms.ts so the
-- DB-backed perms layer (hasPermAsync) honors them. Idempotent via
-- ON CONFLICT (role, permission) DO NOTHING.
--
-- NOTE: this project uses a single `role_permissions(role, permission)`
-- table (no separate `permissions` registry table). Permission strings
-- must satisfy the regex CHECK on role_permissions.permission:
--   permission = '*' OR permission ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_*]+)+$'
-- All keys below conform.

insert into public.role_permissions (role, permission) values
  -- admin (also covered by '*' wildcard, but seeded explicitly so the
  -- role_permissions table stays self-documenting for the /admin/roles
  -- editor).
  ('admin', 'tournament.read'),
  ('admin', 'tournament.score_entry'),
  ('admin', 'tournament.walkover_confirm'),
  ('admin', 'tournament.tiebreaker_config'),
  ('admin', 'tournament.export'),
  ('admin', 'broadcast.v2.read'),
  ('admin', 'broadcast.v2.trigger'),

  -- loc — read tournament data + export reports.
  ('loc', 'tournament.read'),
  ('loc', 'tournament.export'),

  -- idc — read tournament data + export reports.
  ('idc', 'tournament.read'),
  ('idc', 'tournament.export'),

  -- technical — read tournament + drive overlays through broadcast v2.
  ('technical', 'tournament.read'),
  ('technical', 'broadcast.v2.read'),
  ('technical', 'broadcast.v2.trigger'),

  -- production — overlay control room.
  ('production', 'broadcast.v2.read'),
  ('production', 'broadcast.v2.trigger'),

  -- design — read overlays for review/QA.
  ('design', 'broadcast.v2.read'),

  -- referee — counter-confirm walkovers initiated by admin.
  ('referee', 'tournament.walkover_confirm')
on conflict (role, permission) do nothing;
