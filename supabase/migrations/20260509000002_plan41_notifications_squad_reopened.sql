-- Plan 41 §4 — add non-announcement notification support.
--
-- Before Plan 41, every notifications row was tied 1:1 to an announcement
-- (announcement_id NOT NULL). Plan 41 introduces notifications that are not
-- announcement-backed — starting with `squad_reopened` sent to a player when
-- an admin reopens their squad submission. This migration:
--
--   1. Adds a `type` text column with a CHECK constraint covering the allowed
--      values. Starter allowlist: 'announcement' (for pre-existing rows) and
--      'squad_reopened' (Plan 41). Future plans extend by dropping + recreating
--      the CHECK with the added value.
--   2. Adds `title` + `body` text columns so non-announcement notifications
--      carry their own human-readable payload (announcement-tied rows still
--      resolve title/body via the announcements FK and may leave these null).
--   3. Relaxes `announcement_id` to nullable so non-announcement rows are
--      valid. A table-level CHECK preserves the invariant that announcement
--      rows DO have an announcement_id and non-announcement rows do NOT.
--   4. Backfills existing rows to type='announcement'.
--
-- Idempotent: guarded by `IF NOT EXISTS` on each add and `DO $$` blocks for
-- the CHECK recreate so re-runs are safe.

-- 1. type column (nullable during backfill, then set NOT NULL + CHECK).
alter table public.notifications
  add column if not exists type text;

update public.notifications
  set type = 'announcement'
  where type is null;

alter table public.notifications
  alter column type set not null;

-- Drop any prior check constraint on type so we can recreate with the
-- current allowlist. Named constraint keeps future migrations easy.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('announcement', 'squad_reopened'));

-- 2. title + body for non-announcement payloads.
alter table public.notifications
  add column if not exists title text;

alter table public.notifications
  add column if not exists body text;

-- 3. Relax announcement_id to nullable + add invariant.
alter table public.notifications
  alter column announcement_id drop not null;

alter table public.notifications
  drop constraint if exists notifications_announcement_presence_check;

alter table public.notifications
  add constraint notifications_announcement_presence_check
  check (
    (type = 'announcement' and announcement_id is not null)
    or (type <> 'announcement' and announcement_id is null)
  );
