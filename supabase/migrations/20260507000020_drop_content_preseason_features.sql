-- Plan 33 scope drop (2026-04-22): user dropped two Plan 13 features —
-- "content obligations" + "preseason shoots". Both feature surfaces are
-- removed from the codebase (server modules + admin/player routes + perms
-- + tests + subnav entries) in the same change wave.
--
-- POLICY: soft-archive, NOT hard-drop.
--   * Cloud DB may already contain rows. Hard `DROP TABLE` would lose the
--     data and force-rebuild any FK references in audit/history.
--   * `audit_events` rows referencing these tables are preserved verbatim.
--   * The `incident_type='preseason_miss'` value on `disciplinary_cases` /
--     `disciplinary_precedents` enums is INTENTIONALLY KEPT so historical
--     warning rows stay valid. New code no longer issues this incident
--     type, but the value is permitted by the CHECK constraint.
--
-- Archived tables (rows soft-deleted, schema intact):
--   * public.content_posts          — Plan 13A migration 20260430000201
--   * public.content_sessions       — Plan 13A migration 20260430000203
--   * public.preseason_shoots       — Plan 13A migration 20260502000201
--   * public.preseason_shoot_attendance
--                                   — Plan 13A migration 20260502000202
-- Archived views (definition kept; no rows to soft-archive):
--   * public.content_obligation_status (view over content_posts)
--
-- Permissions removed from `role_permissions` (seed lives in
-- `apps/web/src/perms.ts`, also updated in this change wave):
--   * content.submit, content.verify, content.read.own
--   * preseason.manage
--
-- FUTURE HARD-DROP TEMPLATE (only if user explicitly approves data loss):
--   begin;
--     drop view  if exists public.content_obligation_status;
--     drop table if exists public.preseason_shoot_attendance;
--     drop table if exists public.preseason_shoots;
--     drop table if exists public.content_sessions;
--     drop table if exists public.content_posts;
--     -- audit_events rows for these tables remain (table_name text col,
--     -- no FK), preserving the historical record.
--   commit;

begin;

-- 1. Soft-archive content_posts
update public.content_posts
   set deleted_at = now()
 where deleted_at is null;

-- 2. Soft-archive content_sessions
update public.content_sessions
   set deleted_at = now()
 where deleted_at is null;

-- 3. Soft-archive preseason_shoot_attendance
update public.preseason_shoot_attendance
   set deleted_at = now()
 where deleted_at is null;

-- 4. Soft-archive preseason_shoots
update public.preseason_shoots
   set deleted_at = now()
 where deleted_at is null;

-- 5. Drop the runtime permission rows. Seed file (`apps/web/src/perms.ts`)
--    is updated in the same wave so a future re-seed won't reinstate them.
delete from public.role_permissions
 where permission in (
   'content.submit',
   'content.verify',
   'content.read.own',
   'preseason.manage'
 );

commit;
