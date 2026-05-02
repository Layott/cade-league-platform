-- Bug 11 fix (2026-05-01) — seed the `users.unlock` permission.
--
-- Wired to the new admin "Unlock account" button on the player detail
-- page, which calls `clearLockoutForEmail` to drop the in-window
-- failed-login rows for a player who tripped the 5-min lockout.
--
-- Granted to:
--   admin — already covered by the '*' wildcard, listed for parity.
--   loc   — front-line player liaison; needs to unlock without paging admin.
--   idc   — IDC handles match-day comms; needs to unlock right before kickoff.
--
-- Idempotent: ON CONFLICT DO NOTHING so re-running is a no-op.

insert into public.role_permissions (role, permission) values
  ('admin', 'users.unlock'),
  ('loc',   'users.unlock'),
  ('idc',   'users.unlock')
on conflict (role, permission) do nothing;
