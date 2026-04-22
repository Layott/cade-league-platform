# Plan 34 — User CRUD (Phase 1A polish)

**Status:** in-flight
**Author:** Claude (delegated by adenipebi@gmail.com)
**Date:** 2026-04-22
**Origin HEAD:** `0f96a9b`

---

## 1. Goal

Give an admin a complete user-administration surface inside `/admin/users`:

- Create new users (with email + display name, optional gamer tag / jersey
  number / password / roles).
- Edit a user's profile (display_name, gamer_tag, jersey_number).
- Reset a user's password (admin-set temporary password — user resets on
  next login).
- Soft-delete a user (preserves `auth.users` row + audit history).
- Restore a soft-deleted user from `/admin/trash/users`.

All write paths run through the Postgres audit trigger so the existing
`audit_events` log captures every change with the actor's user id.

## 2. Current gap

After Plan 9 the `/admin/users` console only renders the user list and lets
the admin assign / remove `user_roles` rows. There is **no** UI for any of
the five operations above. Server modules covering those mutations also do
not exist (`server/users/` is missing — only `server/roles/` is present).

## 3. Server module surface (`apps/web/src/server/users/`)

New module with co-located unit tests. All fns take a `SupabaseClient`
(injected to keep them mockable) and an `Actor` for permission gating.

| Function | Perm | Behaviour |
|---|---|---|
| `createUser(sb, actor, input)` | `users.create` | Creates `auth.users` via `sb.auth.admin.createUser({ email, password ?? defaultDevPassword, email_confirm: true })`. The Plan 1 trigger `handle_new_auth_user` mirrors a row into `public.users`. We then `UPDATE public.users` to set display_name + (optionally) phone — and if `gamerTag` / `jerseyNumber` are present we INSERT a matching `players` row. If `roles` provided, INSERT `user_roles`. Returns `{ id }` (public.users id). |
| `updateUser(sb, actor, input)` | `users.edit` | Updates `display_name`, optionally `phone`, on `public.users`. If `gamerTag` / `jerseyNumber` provided, upserts the matching `players` row. |
| `resetUserPassword(sb, actor, input)` | `users.edit` | Looks up `supabase_auth_id` then calls `sb.auth.admin.updateUserById(supabase_auth_id, { password: newPassword })`. |
| `softDeleteUser(sb, actor, id)` | `users.delete` | Sets `users.deleted_at = now()`. Soft-deletes every `user_roles` row for the user. Does **not** touch `auth.users` (audit / restore preserved). |
| `restoreUser(sb, actor, id)` | `users.delete` | Clears `users.deleted_at`. Restores `user_roles` rows that were soft-deleted at the same instant (best-effort by timestamp window — falls back to "do not restore roles automatically" if instant doesn't match). |

`schemas.ts` sibling exposes Zod schemas for each input: `createUserSchema`,
`updateUserSchema`, `resetUserPasswordSchema`, `softDeleteUserSchema`,
`restoreUserSchema`.

## 4. Permissions

Add four new permission strings:

- `users.create` — admin only
- `users.edit` — admin only (already enforced; just add to seed)
- `users.delete` — admin only
- `users.read` — admin, loc, idc

Migration `20260507000010_user_crud_perms_seed.sql` inserts these rows
idempotently. `apps/web/src/perms.ts` admin row already covers via `*`
wildcard, so no PERMS map change is required for admin.

## 5. UI changes

1. `/admin/users/page.tsx` — add **Add user** primary button linking to
   `/admin/users/new`.
2. `/admin/users/new/page.tsx` — server component, gate via
   `requirePermAsync(sb, actor, 'users.create')`. Form fields: email,
   display_name, gamer_tag (opt), jersey_number (opt), password (opt — if
   blank, use `dev-temp-2026` and we surface a notice that the user must
   reset it on first login), multi-select roles. Submits to a sibling
   `actions.ts` `createUserAction`. Redirects to `/admin/users/[id]` on
   success.
3. `/admin/users/[id]/page.tsx` — extend with three new sections:
   - **Edit profile** — inline form (display_name, gamer_tag,
     jersey_number) → `updateUserAction`.
   - **Reset password** — inline form with new-password input →
     `resetPasswordAction`.
   - **Delete user** — DangerButton triggers a `<details>` confirmation
     panel with a confirm button → `softDeleteUserAction` → redirects to
     `/admin/users`.
4. `/admin/trash/users` already exists via the generic
   `/admin/trash/[entity]` route + the `users` entry in
   `server/trash/entities.ts`. Verify the **Restore** button on that page
   already calls the trash `restoreAction`, which clears `deleted_at` —
   no UI change required here.

All forms use existing primitives (`SectionHeader`, `FormField`,
`PrimaryButton`, `SecondaryButton`, `DangerButton`, `inputClass`,
`selectClass`).

## 6. Password handling

- The default placeholder password is `dev-temp-2026`. When `createUser`
  falls back to it, we log a warning at the server-action level
  (`console.warn("[users.create] using default dev password ..."`)) and,
  if `process.env.NODE_ENV === "production"`, also emit a `[email:stub]`
  recommendation to send a reset link via Resend.
- Reset-password form takes the new password from the admin (8 chars min)
  and writes it via `sb.auth.admin.updateUserById`. The user is told via
  in-page success message.

## 7. Audit

All writes go through the service-role client; the existing
`audit_row_change()` trigger captures each `INSERT` / `UPDATE` / soft-delete
on `users`, `user_roles`, and `players`.

We do not add hand-rolled `audit_events` inserts (CLAUDE.md non-negotiable).

## 8. Tests

### Unit (≥ 10 new)

`server/users/index.test.ts`:

1. `createUser` requires `users.create`.
2. `createUser` calls `auth.admin.createUser` with `email_confirm: true`.
3. `createUser` updates display_name + jersey_number on the mirrored row.
4. `createUser` inserts user_roles for every role passed.
5. `createUser` falls back to `dev-temp-2026` when password missing.
6. `updateUser` requires `users.edit`.
7. `updateUser` writes only the fields supplied.
8. `resetUserPassword` requires `users.edit` + calls
   `auth.admin.updateUserById`.
9. `softDeleteUser` requires `users.delete` + sets deleted_at on
   `users` and on every `user_roles` row.
10. `softDeleteUser` does NOT call `auth.admin.deleteUser`.
11. `restoreUser` clears deleted_at.

`server/users/schemas.test.ts`:

12. createUserSchema rejects bad email.
13. createUserSchema accepts minimal input (email + displayName).
14. updateUserSchema requires id.
15. resetUserPasswordSchema enforces 8-char minimum.

### E2E

`apps/web/tests/e2e/users-crud.spec.ts`:

1. Admin logs in.
2. Click **Add user** → fill fields → submit → assert redirect to
   `/admin/users/<id>` and the profile shows the entered values.
3. Edit display_name → save → assert.
4. Soft-delete → confirm → assert user disappears from list, appears in
   `/admin/trash/users`.
5. Restore via trash UI → assert reappears in list.
6. Cleanup: hard-delete the throwaway via service-role at end.

## 9. Migrations

- `20260507000010_user_crud_perms_seed.sql` — inserts 7 rows
  (`users.create×admin`, `users.edit×admin`, `users.delete×admin`,
  `users.read×{admin,loc,idc}`). Idempotent `ON CONFLICT DO NOTHING`.
- Verify `users.deleted_at` already exists (Plan 1, migration
  `20260421000001_users.sql` line 15) — no migration required.

## 10. Numbered tasks

1. Write spec (this file). ✓
2. `server/users/schemas.ts` + `schemas.test.ts`.
3. `server/users/index.ts` + `index.test.ts`.
4. `migrations/20260507000010_user_crud_perms_seed.sql`.
5. Update `apps/web/src/app/admin/users/page.tsx` — add Add-user button.
6. New `apps/web/src/app/admin/users/new/page.tsx` + sibling
   `actions.ts`.
7. Extend `apps/web/src/app/admin/users/[id]/page.tsx` — edit-profile,
   reset-password, soft-delete sections.
8. Update sibling `apps/web/src/app/admin/users/actions.ts` — add
   `updateUserAction`, `resetPasswordAction`, `softDeleteUserAction`.
9. Verify `/admin/trash/users` already restores the user (existing
   `entities.ts` covers it; existing `restoreAction` clears deleted_at).
10. Write E2E `tests/e2e/users-crud.spec.ts`.
11. Run lint, unit tests, build. Commit + push.

## 11. Verification

- `npm run lint` — clean.
- `npm run test` — all green; ≥ 10 new unit tests added.
- `npm run build` — clean.
- Manual curl-the-page on dev:3030 — `/admin/users`, `/admin/users/new`,
  `/admin/users/[id]`, `/admin/trash/users` all return 200 (after admin
  cookie). No runtime errors.
- E2E spec runs green.
