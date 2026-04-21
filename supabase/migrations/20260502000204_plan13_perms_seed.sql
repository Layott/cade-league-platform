-- Plan 13A: role_permissions seed for orgs/disputes/appeals/content/preseason.
-- ON CONFLICT DO NOTHING so this is safe to re-run and non-destructive
-- vs. hand-edits an admin may have made via /admin/roles.
-- Admin has wildcard '*' already; no row needed.

insert into public.role_permissions (role, permission) values
  -- moderator: review disputes/appeals/content + manage pre-season
  ('moderator', 'orgs.read'),
  ('moderator', 'disputes.read'),
  ('moderator', 'disputes.rule'),
  ('moderator', 'appeals.read'),
  ('moderator', 'appeals.rule'),
  ('moderator', 'content.verify'),
  ('moderator', 'preseason.manage'),

  -- player: submit + read own
  ('player', 'disputes.submit'),
  ('player', 'disputes.read.own'),
  ('player', 'appeals.submit'),
  ('player', 'appeals.read.own'),
  ('player', 'content.submit'),
  ('player', 'content.read.own')

on conflict (role, permission) do nothing;
