-- 2026-04-24 — End-to-end notification system.
--
-- Extends the existing `notifications` table (originally announcement-only,
-- expanded by Plan 41 to add squad_reopened) to cover every player-visible
-- state change the product tracks: dispute rulings, appeal rulings, squad
-- approve/reject, punishment issue/revoke, match void/unvoid, Friday-window
-- open/close, plus a `generic` escape hatch for future kinds.
--
-- Additions:
--   1. `href` text — deep-link the notification points at (e.g. /player/disputes/<id>).
--   2. `metadata` jsonb — free-form payload; default '{}'.
--   3. `email_sent_at` timestamptz — non-null once the email transport succeeded.
--   4. Widen the `notifications_type_check` allowlist.
--   5. Explicit RLS policy scoping SELECT to the caller's own user_id.
--
-- The table has no attach_audit because it's delivery state, not business
-- data (same rationale as the original migration at 20260426000002).
-- Idempotent: every step is guarded so re-running is safe.

-- 1. href — nullable; notifications without a deep-link (e.g. purely
-- informational) leave this NULL.
alter table public.notifications
  add column if not exists href text;

-- 2. metadata — free-form jsonb; defaults to the empty object so existing
-- rows satisfy NOT NULL.
alter table public.notifications
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- 3. email_sent_at — stamped by the server-module after a successful
-- Resend send. NULL means "in-app only" OR "email failed, in-app still good".
alter table public.notifications
  add column if not exists email_sent_at timestamptz;

-- 4. Widen the type CHECK. Drop the prior constraint (if any) then recreate
-- with the full allowlist. Announcement + squad_reopened are retained so
-- existing rows stay valid; the new kinds cover the 2026-04-24 brief.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'announcement',
    'squad_reopened',
    'dispute_ruled',
    'appeal_ruled',
    'squad_approved',
    'squad_rejected',
    'punishment_issued',
    'punishment_revoked',
    'match_voided',
    'match_unvoided',
    'friday_window_open',
    'friday_window_closed',
    'generic'
  ));

-- The announcement_id invariant already exists from Plan 41: announcement
-- rows require announcement_id, everything else requires announcement_id =
-- NULL. We leave that constraint alone.

-- 5. RLS — enable + self-select policy. The table is inserted into by
-- server-side code using the service-role client (bypasses RLS), so we
-- only need to gate the authenticated-client SELECT path. UPDATE (for
-- read_at stamping) also flows through server code via service-role, so
-- no UPDATE policy is required for correctness — a missing one would
-- simply deny writes from the user-scoped client, which is desirable.
alter table public.notifications enable row level security;

-- Drop existing policy (if any) to allow re-running this migration.
drop policy if exists notifications_self_select on public.notifications;

create policy notifications_self_select
  on public.notifications
  for select
  to authenticated
  using (
    user_id = (
      select id from public.users
      where supabase_auth_id = auth.uid()
      limit 1
    )
  );

-- Maintain the fast-path index for the unread bell count. Original index
-- from 20260426000002 already covers (user_id, created_at desc) WHERE
-- deleted_at IS NULL AND read_at IS NULL — no change needed.
