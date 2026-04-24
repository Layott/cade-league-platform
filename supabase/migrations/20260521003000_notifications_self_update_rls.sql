-- 2026-04-24 — Add a self-scoped UPDATE policy to `public.notifications`.
--
-- Regression context: migration `20260520002000_notifications_full.sql`
-- enabled RLS on notifications with ONLY a `notifications_self_select`
-- policy. The original rationale was "UPDATE flows through server code via
-- service-role, so no UPDATE policy is required" — but the app routes
-- (`/api/notifications/read-all`, `/api/notifications/[id]/read`) call
-- `markAllRead` / `markRead` with a user-scoped client returned from
-- `getServerSupabase()`. Under RLS with no UPDATE policy, Postgres silently
-- returns 0 affected rows: the query succeeds (no error), the client's
-- optimistic "badge=0" state flips, but a subsequent `unreadCount()` reads
-- the same rows with `read_at IS NULL` and the red badge returns.
--
-- Correct fix: grant authenticated callers UPDATE on their own rows only.
-- The predicate mirrors the SELECT policy so a user cannot mark another
-- user's notifications read. Service-role still bypasses RLS as before.
--
-- This lesson has bitten us three times now (Plan 39 C2/C3, disciplinary
-- RLS `20260520003000`, now notifications). Rule: whenever a page-level
-- caller uses `getServerSupabase()` to write to an RLS-enabled table, an
-- UPDATE (and/or INSERT) policy MUST exist or the write will silently no-op.

-- Drop the policy if a previous partial migration attempt left it around.
drop policy if exists notifications_self_update on public.notifications;

create policy notifications_self_update
  on public.notifications
  for update
  to authenticated
  using (
    user_id = (
      select id from public.users
      where supabase_auth_id = auth.uid()
      limit 1
    )
  )
  with check (
    user_id = (
      select id from public.users
      where supabase_auth_id = auth.uid()
      limit 1
    )
  );
