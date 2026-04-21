# Plan 9 — Phase 1B Part A: Full 12-role matrix + DB-backed permissions + admin role editor

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-21
**Supersedes:** §6 "Permissions (Phase 1A)" of `docs/superpowers/specs/2026-04-20-phase-1a-design.md` (hard-coded TS map). Unlocks: PRODUCT_STRUCTURE.md §3 Phase 1B bullet 1 ("Full 12-role permissions matrix") + bullet 2 ("Migration from hard-coded perms to `RolePermission` DB table + admin editor").
**Target deployment:** local-first dev, then `npm run db:push` + Vercel deploy.

---

## 1. Goals + Success Criteria

### 1.1 Goals

1. Expand `user_roles.role` from 3 values (admin/moderator/player) to 12 (admin, loc, idc, referee, technical, production, design, moderator, coach, team_manager, player, viewer). Viewer is stored explicitly in `role_permissions` but still implicit at runtime (unauthenticated user gets the viewer row's perms unioned with `PUBLIC_PERMS`).
2. Create `role_permissions (role, permission, granted_at, granted_by)` table — no soft delete (toggle is the semantic, audit-logged via trigger), no RLS (non-PII config data). Attach `audit_row_change()` trigger so every toggle lands in `audit_events`.
3. Seed `role_permissions` from the current hard-coded `src/perms.ts` map in the migration itself — zero behaviour change on deploy.
4. Rewrite `hasPerm(actor, action)` to read from `role_permissions` via a service-role query with a 30-second process-local LRU cache keyed by `role`. Cache is invalidated on any mutation through the admin editor. Signature stays `hasPerm(actor, action): boolean` (now wrapped in a thin sync-over-cached helper; call sites become async where they were not already async).
5. Admin role editor at `/admin/roles` — grid of roles × permissions, checkbox per cell, save-all button, optimistic UI. Only `admin` role can edit. Every toggle writes `role_permissions` rows which trigger `audit_events` rows.
6. Admin role-assignment UI at `/admin/users` — list all `users` + attached `user_roles` rows; multi-select role assignment per user (add/remove). Replaces the "seed admin by hand" flow from Plan 1.
7. Keep `src/perms.ts` as the TypeScript type union + default seed constant (source of truth for new deploys). Runtime reads DB.

### 1.2 Success Criteria (testable)

1. **Zero-regression viewer path.** An unauthenticated user hits `/`, `/standings`, `/fixtures`, `/players`, `/players/[id]`, `/announcements`, `/punishments` and gets 200 on every route. No route that worked on Plan 8 returns 403 after Plan 9 deploys.
2. **Live permission change.** An `admin` logs in, opens `/admin/roles`, toggles `announcements.publish` OFF for `moderator`, saves. Within 30 seconds (cache TTL), a user holding only the `moderator` role hits POST `/admin/announcements/[id]/publish` and gets 403. The admin toggles it ON, saves — within 30s the moderator's call succeeds (or immediately if the admin editor broadcast-invalidates the cache process-globally).
3. **Default-deny new roles.** After migration, `design` has zero rows in `role_permissions`. A user with only the `design` role gets `false` from `hasPerm(actor, <any action>)` except `*.read.public` actions (which are served by `PUBLIC_PERMS` const, always-on).
4. **Audit coverage.** Every checkbox toggle in `/admin/roles` and every role-assignment change in `/admin/users` produces exactly one `audit_events` row with `entity_type ∈ {role_permissions, user_roles}`, correct `actor_user_id`, and a `before_json`/`after_json` reflecting the change.
5. **Idempotency.** Running the seed INSERT against a freshly-migrated DB and then running it again (dev reset) produces the same set of rows — the migration uses `ON CONFLICT (role, permission) DO NOTHING`.
6. **Cache correctness under concurrency.** If admin A toggles perm X ON and admin B toggles perm X OFF within the same 30s window, the final DB state matches whichever write won (last-write-wins on `role_permissions` PK collision is impossible since the row is `(role, permission)` PK — the "OFF" write is a DELETE; re-"ON" is an INSERT; ordering is handled by the editor save transaction wrapping the diff). See §8 Risks.
7. **No hard-coded-map bypass.** Grep confirms no production code path imports `PERMS` from `src/perms.ts` for runtime checks — only the migration seed and tests import it.

---

## 2. Data Model Changes

### 2.1 Migration: expand `user_roles.role` enum

Current schema (migration `20260421000002_user_roles.sql`) uses a `CHECK (role IN ('admin','moderator','player'))` constraint, not a Postgres `ENUM` type. This is simpler to widen — we drop and re-add the check.

**New migration `20260428000001_user_roles_expand.sql`:**

```sql
-- Widen user_roles.role to the 12-value Phase 1B matrix.
-- The column uses a CHECK constraint (not a native ENUM), so no pg_enum surgery.
alter table public.user_roles
  drop constraint if exists user_roles_role_check;

alter table public.user_roles
  add constraint user_roles_role_check check (
    role in (
      'admin',
      'loc',
      'idc',
      'referee',
      'technical',
      'production',
      'design',
      'moderator',
      'coach',
      'team_manager',
      'player',
      'viewer'
    )
  );
```

Rationale: Plan 1 chose `text + check` explicitly (see `20260421000002_user_roles.sql`). Keeping `text + check` means `ALTER TYPE ... ADD VALUE` (which cannot run inside a transaction in some Postgres configs) is a non-issue. If a future migration wants a true ENUM, it is a separate exercise.

### 2.2 Migration: `role_permissions` table

**New migration `20260428000002_role_permissions.sql`:**

```sql
-- role_permissions stores granted permission strings per role.
-- Non-PII config data → no RLS. Business enforcement lives in hasPerm().
-- No deleted_at: a revoked permission is a DELETE (audit trigger captures it).
create table public.role_permissions (
  role        text not null,
  permission  text not null,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.users (id) on delete set null,
  primary key (role, permission),
  constraint role_permissions_role_check check (
    role in (
      'admin','loc','idc','referee','technical','production','design',
      'moderator','coach','team_manager','player','viewer'
    )
  ),
  constraint role_permissions_permission_format
    check (permission ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_*]+)+$')
);

create index role_permissions_role_idx on public.role_permissions (role);

select public.attach_audit('public.role_permissions');
```

No RLS policies — `role_permissions` is not PII and business access is enforced in the API layer via `hasPerm()`, consistent with CLAUDE.md §4.

### 2.3 Migration: seed from current `src/perms.ts` (zero-behaviour-change)

**New migration `20260428000003_role_permissions_seed.sql`:**

```sql
-- Seed role_permissions from the Phase 1A hard-coded map in apps/web/src/perms.ts.
-- Idempotent: ON CONFLICT DO NOTHING so re-running is a no-op.
-- Viewer gets zero rows (its perms are served by PUBLIC_PERMS const at runtime).
-- Admin gets the literal '*' wildcard, matching current perms.ts behaviour.
insert into public.role_permissions (role, permission) values
  -- admin (wildcard)
  ('admin', '*'),

  -- moderator
  ('moderator', 'announcements.*'),
  ('moderator', 'punishments.issue'),
  ('moderator', 'punishments.edit'),
  ('moderator', 'punishments.read'),
  ('moderator', 'attendance.mark'),
  ('moderator', 'attendance.edit'),
  ('moderator', 'matches.read'),
  ('moderator', 'standings.read'),
  ('moderator', 'audit.read'),

  -- player
  ('player', 'matches.read'),
  ('player', 'standings.read'),
  ('player', 'announcements.read.own'),
  ('player', 'profile.edit.own')

on conflict (role, permission) do nothing;

-- All other roles (loc, idc, referee, technical, production, design,
-- coach, team_manager, viewer) deliberately start with ZERO rows.
-- Admin uses the editor to grant them as the league actually needs them.
```

### 2.4 Migration: attach audit (already in §2.2) — sanity verification

Attachment already happens in the table migration via `select public.attach_audit('public.role_permissions')`. No separate migration needed. Verification query (post-push):

```sql
select tgname from pg_trigger
 where tgrelid = 'public.role_permissions'::regclass
   and tgname like 'audit_%';
-- expect: audit_public_role_permissions
```

### 2.5 Migration numbering summary

| # | File | Purpose |
|---|------|---------|
| 1 | `20260428000001_user_roles_expand.sql` | Widen role check to 12 values |
| 2 | `20260428000002_role_permissions.sql` | Create table + audit trigger |
| 3 | `20260428000003_role_permissions_seed.sql` | Seed from Phase 1A map |

Following the existing convention (`YYYYMMDDNNNN`). Plan 8 did not add migrations, last applied was `20260427000001_attendance_marks.sql`. The `2026-04-28` date is a monotonic bump past the highest-applied migration; Supabase only cares about ordering.

---

## 3. Server Modules

### 3.1 Files to create

| Path (absolute from `apps/web/src/`) | Purpose |
|---|---|
| `server/roles/schemas.ts` | Zod: `togglePermissionSchema`, `assignRoleSchema`, `removeRoleSchema`, `bulkSaveMatrixSchema` |
| `server/roles/permissions.ts` | `listPermissionsForRole(sb, role)`, `togglePermission(sb, role, permission, actor)`, `listAllPermissions(sb)`, `bulkSaveMatrix(sb, diff, actor)` |
| `server/roles/permissions.test.ts` | unit tests for all four permissions fns (mocked sb) |
| `server/roles/users.ts` | `listUsersWithRoles(sb)`, `assignRole(sb, userId, role, actor)`, `removeRole(sb, userId, role, actor)` |
| `server/roles/users.test.ts` | unit tests for assign/remove/list |
| `server/roles/cache.ts` | Process-local LRU cache: `getRolePerms(role)`, `invalidate(role?)` (no arg = invalidate all) |
| `server/roles/cache.test.ts` | TTL behaviour + invalidation tests |
| `server/roles/index.ts` | re-export surface |
| `lib/perms-db.ts` | `hasPermAsync(sb, actor, action)`, `requirePermAsync(sb, actor, action)` (throw PermissionError) — wraps the cache |
| `lib/perms-db.test.ts` | tests: admin wildcard still works, moderator inherits, viewer gets PUBLIC_PERMS only, empty-role default-deny, cache hit/miss |

### 3.2 Files to edit

| Path | Change |
|---|---|
| `perms.ts` | Expand `RoleName` union to the 12 roles. Keep `PERMS` constant as the *seed* doc (comment at top: "This map is the seed used by migration `20260428000003`. Runtime reads from DB via `lib/perms-db.ts`. Add a role's seed here only when scaffolding a new role."). Keep `PUBLIC_PERMS` unchanged — still served in-process for unauthenticated speed. Keep `Actor` type unchanged. Keep the sync `hasPerm(actor, action)` as a *fallback* for edge cases where no `sb` is available (e.g. during SSR of a fully public page), but prefix it with `// prefer hasPermAsync from lib/perms-db.ts`. |
| `perms.test.ts` | Rename to `perms.seed.test.ts`. Keep the tests — they assert the *seed map*. Add one new test: "seed map is a subset of `ROLE_NAMES` and all roles in `ROLE_NAMES` are represented in the union". |
| `app/api/**/*` route handlers that call `requirePerm` | Swap to `requirePermAsync(sb, actor, action)`. All route handlers are already `async`. One-line change per call site. |
| `middleware.ts` | If it calls `hasPerm`, swap to `hasPermAsync` using the service-role client from `lib/supabase-service.ts`. If it only checks role membership (via `requireRole`), no change. |
| `server/auth/actor.ts` | No change — still returns `Actor`. Role list already matches DB-stored roles. |

### 3.3 Cache design — `server/roles/cache.ts`

```ts
// Process-local cache. One instance per Node process (Next.js Server Component
// runtime + API routes share one module graph). Max 12 entries (one per role)
// so no LRU eviction logic needed — just a Map with per-entry expiry.
//
// TTL: 30 seconds. Picked so a permission toggle is visible everywhere
// within one admin's typical "save → test" cycle without hammering the DB.
//
// Invalidation: bulkSaveMatrix() and togglePermission() call invalidate()
// on the affected role(s). Cross-process (multiple Vercel regions) is handled
// by the 30s TTL — we accept up to 30s of staleness on peer nodes.

type CacheEntry = { perms: readonly string[]; expiresAt: number };
const TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

export async function getRolePerms(
  sb: SupabaseClient,
  role: string
): Promise<readonly string[]> {
  const now = Date.now();
  const hit = cache.get(role);
  if (hit && hit.expiresAt > now) return hit.perms;

  const { data, error } = await sb
    .from("role_permissions")
    .select("permission")
    .eq("role", role);
  if (error) throw new Error(`role perms fetch failed: ${error.message}`);
  const perms = (data ?? []).map((r) => r.permission as string);
  cache.set(role, { perms, expiresAt: now + TTL_MS });
  return perms;
}

export function invalidate(role?: string): void {
  if (!role) cache.clear();
  else cache.delete(role);
}

// Test-only: expose current size + force expire
export const __test = { size: () => cache.size, clearAll: () => cache.clear() };
```

### 3.4 `lib/perms-db.ts` — async `hasPerm`

```ts
export async function hasPermAsync(
  sb: SupabaseClient,
  actor: Actor,
  action: string
): Promise<boolean> {
  // Public perms served in-process — unauthenticated public pages don't hit DB.
  if (PUBLIC_PERMS.some((r) => matchesPerm(r, action))) return true;

  for (const role of actor.roles) {
    const rules = await getRolePerms(sb, role);
    if (rules.some((r) => matchesPerm(r, action))) return true;
  }
  return false;
}

export async function requirePermAsync(
  sb: SupabaseClient,
  actor: Actor,
  action: string
): Promise<void> {
  if (!(await hasPermAsync(sb, actor, action))) {
    throw new PermissionError(`missing permission: ${action}`);
  }
}
```

`matchesPerm` is re-exported from `perms.ts` (the glob-match helper is identical). `PermissionError` is whatever the existing codebase uses (check `src/server/errors.ts` during implementation; reuse, do not reinvent).

### 3.5 Module boundaries

Following the pattern set by `server/announcements/`:

- `server/roles/index.ts` exports only: `listPermissionsForRole`, `listAllPermissions`, `togglePermission`, `bulkSaveMatrix`, `listUsersWithRoles`, `assignRole`, `removeRole`, `invalidateRoleCache`.
- Route handlers (under `app/api/admin/roles/**`) are thin — they parse input with the Zod schemas, call the server module, return JSON.

---

## 4. UI

### 4.1 New routes

| Route | File | Purpose |
|---|---|---|
| `/admin/roles` | `app/admin/roles/page.tsx` | Matrix editor: rows = 12 roles, cols = full permission universe; checkbox cells; `Save changes` primary button; `Reset` secondary. |
| `/admin/users` | `app/admin/users/page.tsx` | User list with current roles; per-user role-picker dropdown + add/remove action. |
| `/admin/users/[id]` | `app/admin/users/[id]/page.tsx` | Per-user detail: email, display_name, all current `user_roles` rows, add/remove roles, login history link. |

### 4.2 API routes (server actions or route handlers)

Prefer Next.js Server Actions (already used by `/admin/announcements/new`). If an action cannot be a server action (e.g. needs a request body > 1MB — N/A here), fall back to a POST route handler.

| Route | Verb | Purpose |
|---|---|---|
| `app/admin/roles/actions.ts` | `saveMatrix(diff)` server action | Accept array of `{role, permission, grant: true\|false}`; validate with Zod; run `bulkSaveMatrix`; `invalidate()`; `revalidatePath("/admin/roles")`. |
| `app/admin/users/actions.ts` | `assignRole(userId, role)`, `removeRole(userId, role)` server actions | Validate with Zod; call `server/roles/users.ts`; revalidate. |

### 4.3 Subnav update

Edit `components/admin/AdminSubnav.tsx` — extend `TABS`:

```ts
const TABS = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/match-days", label: "Match days" },
  { href: "/admin/punishments", label: "Punishments" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/roles", label: "Roles" },       // NEW
  { href: "/admin/users", label: "Users" },       // NEW
  { href: "/admin/trash", label: "Trash" },
  { href: "/admin/security/sessions", label: "Sessions" },
];
```

### 4.4 `/admin/roles` page layout

- `PageHeader` (eyebrow "ACCESS CONTROL", h1 "Role permissions").
- `SectionHeader` explaining: "Toggle a cell to grant or revoke. Saves atomically. Propagates within 30 seconds across all servers."
- `<form action={saveMatrix}>` containing a `<DataTable>` where:
  - `columns` = fixed `{ key: "role", label: "Role" }` + one column per permission in `listAllPermissions()` result (union of all granted + all known-from-seed perms), label set to the permission string in JetBrains Mono font.
  - `rows` = 12 role rows.
  - `render` of each cell = `<input type="checkbox" name="matrix" value={role}:{permission} defaultChecked={isGranted} />`.
- Footer: `<PrimaryButton>Save changes</PrimaryButton> <SecondaryButton type="reset">Reset</SecondaryButton>`.
- Optimistic UI: client component wraps the form; on submit, immediately updates the local state, then the action result re-syncs on revalidation.
- Only `admin` can open this page. The page's server component calls `requirePermAsync(sb, actor, 'roles.edit')` at the top. The seed grants `admin` the `*` wildcard, so admin passes automatically.

### 4.5 `/admin/users` page layout

- `PageHeader` (eyebrow "PEOPLE & ACCESS", h1 "Users & roles").
- `<DataTable>` with columns:
  - `Email` (from `users.email`)
  - `Display name`
  - `Roles` — comma-joined `<StatusPill>` per role (one pill per role, tone derived from role — admin=signal green, idc/loc=amber, player=chalk, viewer=muted).
  - `Last login` (from `users.last_login_at`, formatted WAT).
  - `Actions` — `<SecondaryButton>Manage</SecondaryButton>` → `/admin/users/[id]`.
- Row click also links to `/admin/users/[id]`.

### 4.6 `/admin/users/[id]` detail

- Header: user's email + display name.
- Section "Roles": chip list of current roles; each chip has a `×` to remove (calls `removeRole` action); below, a `<select>` of un-assigned roles + `Add role` primary button (calls `assignRole`).
- Section "Sessions" — link to existing `/admin/security/sessions?userId=...` (reuse Plan 1 work, no new code).
- Section "Audit trail" — last 20 `audit_events` rows where `entity_id = userId OR actor_user_id = userId`, using existing dashboard query helper (copy pattern, do not refactor yet).

### 4.7 Design conventions (non-negotiable)

- Use **only** the admin primitives from `components/admin/*`. No raw `<table>`, `<button>`, or `<input>` tags — go through `DataTable`, `PrimaryButton`/`SecondaryButton`/`DangerButton`, `FormField` + `inputClass`.
- Use `StatusPill` for role chips. Extend its `tone` prop map if the existing colour set does not cover all 12 roles (add tones for `loc`, `idc`, `referee`, `technical`, `production`, `design`, `coach`, `team_manager`). Add the colour map in one place — `StatusPill.tsx`.
- Use JetBrains Mono for permission strings (they're identifiers — they should look like code). Class: `font-mono text-xs`.
- Empty state (`DataTable` `emptyLabel` prop) reads in brand voice, e.g. "No roles granted yet. Use the editor above to wire up access."

---

## 5. Tests

### 5.1 Unit tests (Vitest, next to code, mocked Supabase)

Target: **≥ 15 new unit tests.**

| File | Tests |
|---|---|
| `server/roles/cache.test.ts` | (1) cache hit within TTL; (2) cache miss after TTL expiry; (3) invalidate(role) clears one entry; (4) invalidate() with no arg clears all. |
| `server/roles/permissions.test.ts` | (5) `listAllPermissions` dedupes across roles; (6) `togglePermission` grants a new row; (7) `togglePermission` revokes an existing row; (8) `togglePermission` is idempotent on re-grant; (9) `bulkSaveMatrix` writes multiple diffs in one tx; (10) `bulkSaveMatrix` invalidates cache for each affected role. |
| `server/roles/users.test.ts` | (11) `assignRole` upserts user_roles row; (12) `assignRole` is idempotent (no duplicate row); (13) `removeRole` soft-deletes the user_roles row (sets `deleted_at`); (14) `listUsersWithRoles` joins via `user_id`. |
| `lib/perms-db.test.ts` | (15) `hasPermAsync` returns true for admin wildcard via DB; (16) returns true for player with `matches.read`; (17) returns false for empty role (`design`); (18) returns true for viewer public-perm via `PUBLIC_PERMS` without hitting DB; (19) multi-role actor unions perms; (20) cache bypass on second call (second call does not re-query DB within TTL — assert with spy on `sb.from`). |
| `perms.seed.test.ts` | (21) all 12 roles appear in `ROLE_NAMES`; (22) `PUBLIC_PERMS` unchanged from Plan 1A. (Renamed from `perms.test.ts`; kept for documentation of the seed contract.) |

Total: **22 new unit tests** (comfortably ≥ 15).

### 5.2 E2E (Playwright)

New spec `apps/web/tests/e2e/admin-roles.spec.ts`:

1. **Toggle flow.** Login as `admin@cade.local` → navigate `/admin/roles` → assert matrix renders → uncheck `moderator` × `announcements.publish` → click Save → reload page → assert that cell is unchecked. Then re-check + save + assert checked again. (Covers round-trip through DB + cache.)
2. **Role assignment.** Login as admin → navigate `/admin/users` → find the seeded `moderator@cade.local` → open detail → add role `idc` → assert role chip appears → remove it → assert chip gone. Verify `audit_events` via DB query (spec uses service-role client for assertion).
3. **Default-deny for new role.** Create a throwaway user `design-test@cade.local` (use the seed pattern from Plan 1 E2E). Assign only `design`. Assert user can hit `/standings` (public) but gets 403 at `/admin/punishments/new`. Tear down user after.

Existing E2E specs may reference the old 3-role set — audit `apps/web/tests/e2e/*.spec.ts` for any `role: "admin" | "moderator" | "player"` type imports and widen.

### 5.3 Migration smoke test

Extend `supabase/tests/audit_smoke.sql` (invoked by `npm run audit:smoke`) with:

```sql
-- role_permissions audit smoke
insert into public.role_permissions (role, permission) values ('viewer', 'smoke.test');
delete from public.role_permissions where role = 'viewer' and permission = 'smoke.test';
-- expect 2 audit_events rows (insert + delete) for entity_type='role_permissions'
select count(*) from public.audit_events where entity_type = 'role_permissions'; -- >= 2
```

---

## 6. Numbered Task List

Grouped by phase, matching Plan 8 cadence (10 tasks, logical-commit granularity).

### Migrations

- [ ] 1. Write + apply `20260428000001_user_roles_expand.sql` (widen role check to 12 values). Verify via `supabase db query` that the constraint is present.
- [ ] 2. Write + apply `20260428000002_role_permissions.sql` (table + audit trigger). Verify `select public.attach_audit` result + `pg_trigger` has `audit_public_role_permissions`.
- [ ] 3. Write + apply `20260428000003_role_permissions_seed.sql`. Verify row counts: admin=1 (`*`), moderator=9, player=4, everything else=0.
- [ ] 4. Extend `supabase/tests/audit_smoke.sql` with `role_permissions` insert+delete assertion; run `npm run audit:smoke` green.

### Server modules

- [ ] 5. Expand `RoleName` union in `perms.ts` to 12 roles. Add header comment clarifying the file is now the *seed* not runtime. Keep `hasPerm` for pure-sync fallback. Rename `perms.test.ts` → `perms.seed.test.ts` + add "roles covered" assertion.
- [ ] 6. Create `server/roles/schemas.ts` with Zod schemas + types.
- [ ] 7. Create `server/roles/cache.ts` + `cache.test.ts` (TDD: 4 tests first).
- [ ] 8. Create `server/roles/permissions.ts` + `permissions.test.ts` (TDD: 6 tests first; exports `listAllPermissions`, `listPermissionsForRole`, `togglePermission`, `bulkSaveMatrix`).
- [ ] 9. Create `server/roles/users.ts` + `users.test.ts` (TDD: 4 tests first; exports `listUsersWithRoles`, `assignRole`, `removeRole`).
- [ ] 10. Create `server/roles/index.ts` (re-export surface).
- [ ] 11. Create `lib/perms-db.ts` + `lib/perms-db.test.ts` (TDD: 6 tests). Export `hasPermAsync`, `requirePermAsync`.
- [ ] 12. Swap every call to `requirePerm`/`hasPerm` in `app/api/**` and route/page files to `requirePermAsync`/`hasPermAsync` (pass service-role `sb`). One commit per folder to keep diffs reviewable.

### UI

- [ ] 13. Extend `AdminSubnav` TABS to include Roles + Users. Extend `StatusPill` tone map with 8 new role tones.
- [ ] 14. Build `/admin/roles` server component + matrix table + `saveMatrix` server action. Wire optimistic UI (client wrapper).
- [ ] 15. Build `/admin/users` list page + `/admin/users/[id]` detail page + `assignRole`/`removeRole` server actions.
- [ ] 16. Add gate: first lines of both pages call `requirePermAsync(sb, actor, 'roles.edit')` / `users.edit` (seed `admin` wildcard covers).

### Tests + verification

- [ ] 17. Write E2E spec `admin-roles.spec.ts` (3 scenarios from §5.2).
- [ ] 18. Audit existing E2E specs for hard-coded role literals; widen to the 12-role union where typed. Patch `apps/web/tests/e2e/login.spec.ts` if it imports the old `RoleName`.
- [ ] 19. Run full verification gate (`npm run test`, `npm run lint`, `npm run build`, `npm --workspace apps/web run e2e`, `npm run audit:smoke`). All green.
- [ ] 20. Commit in slices (one commit per task group: migrations → server → UI → tests). Push. Update this plan's review section in `tasks/todo.md`.

---

## 7. Acceptance Criteria + Verification Checklist

| Gate | Command | Pass condition |
|---|---|---|
| Unit | `npm run test` | ≥ 107 passing (current 85 + 22 new); zero failing |
| Lint | `npm run lint` | clean |
| Build | `npm run build` | 29+ routes compiled (27 current + `/admin/roles` + `/admin/users` + `/admin/users/[id]`) |
| E2E | `npm --workspace apps/web run e2e` | all existing (22) + 3 new specs pass |
| Migrations | `npm run db:push` | 30 of 30 migrations applied (27 current + 3 new) |
| Audit smoke | `npm run audit:smoke` | green including new `role_permissions` assertion |
| Success criteria §1.2 | Manual browser walkthrough | All 7 demonstrated |
| Audit rows | `select count(*) from audit_events where entity_type = 'role_permissions'` | = 14 (seed-inserted rows) + N-toggle rows |

Plan 9 is NOT complete until every row in this table passes.

---

## 8. Risks / Open Questions

1. **Cross-process cache staleness.** Vercel runs multiple Node instances per region. A toggle in instance A invalidates A's cache only; instance B serves stale perms until its 30s TTL expires. Accepted: 30s worst-case staleness. Mitigation if we later need stronger: Postgres `LISTEN/NOTIFY` channel `role_perms_changed` → each Node subscribes via a shared connection → invalidate on notify. Deferred until real-world staleness bites.
2. **Concurrent toggles by two admins.** Two admins editing the same cell simultaneously: last-submit wins. `bulkSaveMatrix` runs as `DELETE … WHERE (role,permission) IN (revoked); INSERT … ON CONFLICT DO NOTHING (granted)` in a single transaction. If A grants + B revokes in overlapping txs, DB locks on the row, second tx waits, eventual state is whichever committed last. Acceptable for an admin-only tool. Audit log captures both.
3. **Non-admin self-grant.** The `/admin/roles` page requires `roles.edit` perm. Seed grants `admin` the `*` wildcard, so only admin passes. Any non-admin who lands on the page gets a 403. The `saveMatrix` server action double-checks `requirePermAsync(sb, actor, 'roles.edit')` server-side before writing — do not trust the page gate alone.
4. **Enum `ADD VALUE` concern (moot for us).** The spec notes Postgres cannot `ALTER TYPE ... ADD VALUE` inside a transaction on some configs. We sidestep this entirely by using a `CHECK` constraint, not an ENUM. No risk.
5. **Existing E2E fixture users.** Plan 1 seeded users with roles admin / moderator / player. Those seeds still work because the 3 old values are in the new 12-value set. No re-seed needed.
6. **Wildcard `*` semantics.** The glob matcher (`matchesPerm`) treats `*` as "matches anything." Admin's single row `('admin','*')` still grants everything via the existing glob logic in `perms.ts`. DO NOT split admin into per-permission rows — keep the wildcard.
7. **Wildcard edit in the matrix UI.** If `admin × *` is displayed as a checkbox and an admin unchecks it, they lock themselves out. Mitigation: the `*` column in the editor UI is rendered *read-only* + tooltip "admin wildcard is locked — uncheck specific permissions on other roles instead." The `saveMatrix` action also hard-rejects any diff that would delete `('admin','*')` (server-side).
8. **Performance.** Every authenticated request now does `SELECT permission FROM role_permissions WHERE role = $1` per role the actor holds, cached 30s. For the Elite 13-player league this is trivially small. If scaled to 1000s of users, consider one query fetching all perms for all of actor's roles + `IN (...)`.

---

## 9. Out of Scope

- Per-user custom permissions (always role-based in Phase 1B; maps cleanly through `user_roles`).
- Per-season role scoping (deferred to Phase 2 — a `UserRole.season_id` column is *documented* in PRODUCT_STRUCTURE §4.1 but not built).
- Role *creation* (adding a 13th role). The `CHECK` constraint fixes the role set. A future migration widens it. UI does not allow adding brand-new roles.
- Permission *creation*. The permission universe is whatever strings exist in the seed + whatever admins have granted. UI does not have a "define a new permission" action — you grant an arbitrary string via the toggle only if the string already exists in at least one role's row. Adding a brand-new permission requires a code change (the `requirePermAsync` call site introduces it).
- Cross-tab real-time sync of matrix edits (Supabase Realtime). Admin-only editor, low concurrency. Deferred.
- Cache invalidation via Postgres LISTEN/NOTIFY. Deferred per §8.1.
- Paystack, caution-fee ledger, squad submission, Friday change window — all explicitly out of Plan 9 (still Phase 2 / dropped per CLAUDE.md update).

---

## 10. References

- CLAUDE.md §4 "Architectural Non-Negotiables" (items 3, 4, 6 for audit trigger + RLS + soft-delete rules)
- PRODUCT_STRUCTURE.md §3 Phase 1B bullets 1-2, §4.1 entity list, §5 role matrix
- `docs/superpowers/specs/2026-04-20-phase-1a-design.md` §6 Permissions (this plan supersedes)
- `supabase/migrations/20260420000003_audit_trigger.sql` (`attach_audit` helper)
- `supabase/migrations/20260421000002_user_roles.sql` (role CHECK pattern)
- `apps/web/src/perms.ts` + `perms.test.ts` (source map)
- `apps/web/src/components/admin/*` (UI primitives — do not recreate)
