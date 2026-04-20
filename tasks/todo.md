# Tasks — Active Work

Active plan: (none — Plan 1 complete; Plan 2 next)

Update this file as work progresses per parent CLAUDE.md workflow.

## In Progress
(none)

## Done
- Spec: `docs/superpowers/specs/2026-04-20-phase-1a-design.md`
- Product doc v0.2 with decisions log
- Plan 0 — Foundations complete (adapted to Supabase cloud)
- Plan 1 — Auth + Roles + Sessions complete (2026-04-20)

## Review

### Plan 1 complete — 2026-04-20

All 16 plan tasks executed. RLS fix migration (007) added inline during Task 14 after E2E caught the issue (user_roles blocked middleware from reading own roles).

Verification:

| Command | Result |
|---------|--------|
| `npm run test` | 16 passed (3 time + 5 perms + 3 device + 2 actor + 3 sessions) |
| `npm run lint` | clean |
| `npm run build` | 5 routes compiled |
| `npm --workspace apps/web run e2e` | 4 passed (1 smoke + 3 login) |
| `npm run db:push` | 7 migrations in cloud (0 pending) |
| `npm run audit:smoke` | green (from Plan 0) |

Cloud audit_events sample after Plan 1 execution:
```
entity_type | action | count
-------------+--------+------
sessions    | insert | 2
user_roles  | insert | 1
users       | insert | 2
users       | update | 2
```

Plan 1 commits (git log --oneline since Plan 0):
- feat(db): public.users table mirroring auth.users + audit attached
- feat(db): user_roles table (admin/moderator/player) + audit attached
- feat(db): sessions table with device fingerprint + audit attached
- feat(db): auth_events table for login/device/session security events
- feat(db): auth.users → public.users mirror trigger
- feat(db): RLS on users + user_roles (self-read, server-managed)
- feat(auth): deviceFingerprint helper (SHA-256 of UA + /16 IP + lang)
- feat(auth): getActorFromSession + widen Actor type to include userId
- feat(email): Resend transport with stdout stub when key absent
- feat(auth): recordLogin creates session + logs event + alerts admins on new device
- feat(auth): middleware gate redirects unauthenticated + 403s non-admin
- feat(web): /admin shell layout + landing page
- feat(auth): /login page + server action + /logout route with event logging
- feat(auth): allow users to read own roles + E2E login suite (4 tests pass)
- feat(admin): session history table + revoke action

### Remote

Pushed to https://github.com/Layott/cade-league-platform (private).

### Seeded users (dev)

- `admin@cade.local` / `dev-admin-2026` → role=admin
- `seed-test@cade.local` / `dev-only-password-xyz` → no roles (trigger-created mirror only)

### Next steps

- Plan 2 — Season + Players + Seed (hard-coded Elite 2025-2026 season, player roster from user, public `/players` grid).
- Before Plan 2 coding: get the 13-player roster (names, gamer tags, PSN IDs).
- Optional parallel track for a second Claude terminal: polish public landing page design; draft Plan 2 spec scaffold.
