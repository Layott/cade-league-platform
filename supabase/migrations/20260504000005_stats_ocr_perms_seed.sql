-- Plan 14 — seed stats.* permissions into role_permissions.
--
-- Admin already owns '*' wildcard and therefore passes all stats.* checks at
-- runtime; we do NOT explicit-grant admin rows (keeps the wildcard contract
-- clean — one row per admin entry).
-- Moderator gets upload + review. Delete + OCR re-run are admin-only
-- (destructive / cost-sensitive). Idempotent via ON CONFLICT.
insert into public.role_permissions (role, permission) values
  ('moderator', 'stats.screenshot.upload'),
  ('moderator', 'stats.screenshot.review')
on conflict (role, permission) do nothing;
