# Plan 1 — Auth + Roles + Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Supabase Auth to our app, create the `users` / `user_roles` / `sessions` / `auth_events` schema, enforce role-based access via middleware + server helpers, and log every login with device fingerprint (admins get email alert on new device).

**Architecture:** Supabase Auth manages credentials + JWT. Our `public.users` table mirrors `auth.users` via a trigger that copies new signups. `user_roles` holds explicit role assignments. Every login writes a row to `sessions` and an event to `auth_events`. A middleware checks JWT on every request to `(admin)/*` routes and rejects non-admin/moderator actors. `hasPerm` accepts an `Actor` assembled server-side from the authenticated user + their roles.

**Tech Stack:** Supabase Auth, `@supabase/ssr`, Next.js 15 Server Actions + middleware, Resend (optional email), existing `hasPerm` helper from Plan 0, audit trigger infrastructure from Plan 0.

**Prerequisites:**
- Plan 0 complete (migrations for `audit_events` + `audit_row_change()` already in cloud).
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
- Resend API key optional (`RESEND_API_KEY`). Without it, new-device email logs to stdout.

**Shippable at end of Plan 1:**
- An admin user can be seeded via SQL + first-time password reset flow.
- Admin can visit `/login`, sign in, get redirected to `/admin` landing.
- Non-admin hitting `/admin/*` gets 403.
- Every login writes one row to `sessions` and one to `auth_events`.
- First login from a new device for an admin triggers an email (or stdout log if Resend unset).
- Admin can view own session history and revoke other sessions.

---

## File Structure (delta over Plan 0)

Created by this plan:

```
apps/web/src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx                  # Login form
│   │   └── logout/route.ts                 # POST logout route
│   ├── (admin)/
│   │   ├── layout.tsx                       # Auth gate + admin shell
│   │   ├── page.tsx                         # Landing
│   │   └── security/
│   │       └── sessions/page.tsx            # Own + global session list
│   └── api/
│       └── auth/
│           └── callback/route.ts            # Supabase OAuth/email-link callback
├── server/
│   └── auth/
│       ├── actor.ts                         # getActor(req) → Actor | null
│       ├── actor.test.ts
│       ├── sessions.ts                      # createSession, listSessions, revokeSession
│       ├── sessions.test.ts
│       ├── device.ts                        # deviceFingerprint(headers) → string
│       ├── device.test.ts
│       └── notify.ts                        # sendNewDeviceAlert(user, session)
├── lib/
│   └── email/
│       └── resend.ts                        # send(opts); stubs to console.log if no key
├── middleware.ts                            # gates (admin)/*

supabase/migrations/
├── 20260421000001_users.sql
├── 20260421000002_user_roles.sql
├── 20260421000003_sessions.sql
├── 20260421000004_auth_events.sql
├── 20260421000005_auth_user_trigger.sql    # public.users row on auth.users insert
└── 20260421000006_rls_users.sql             # RLS policies on users + user_roles
```

Modified:
- `apps/web/src/perms.ts` — widen `Actor` to include `userId`; no behaviour change (test still green)
- `apps/web/package.json` — add `resend` dep

---

## Task 1: Migration — users table (PII host)

**Files:**
- Create: `supabase/migrations/20260421000001_users.sql`

- [ ] **Step 1: Write the migration**

Contents:

```sql
-- public.users mirrors auth.users with our own columns.
-- auth.users is managed by Supabase; we add display_name, phone, etc.
-- PII lives here → RLS policies applied in a later migration.

create table public.users (
  id                  uuid primary key default gen_random_uuid(),
  supabase_auth_id    uuid unique not null references auth.users (id) on delete cascade,
  email               citext unique not null,
  phone               text,
  display_name        text not null,
  last_login_at       timestamptz,
  failed_login_count  int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index users_deleted_at_idx  on public.users (deleted_at);
create index users_email_idx       on public.users (email) where deleted_at is null;

select public.attach_audit('public.users');
```

- [ ] **Step 2: Push + verify**

```bash
npm run db:push
```

Expected: `Applying migration 20260421000001_users.sql... Finished supabase db push.`

Verify the table exists:

```bash
npx supabase db query "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='users' order by ordinal_position" --linked --output table
```

Expected: 10 columns listed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000001_users.sql
git commit -m "feat(db): public.users table mirroring auth.users + audit attached"
```

---

## Task 2: Migration — user_roles table

**Files:**
- Create: `supabase/migrations/20260421000002_user_roles.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  role        text not null check (role in ('admin','moderator','player')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (user_id, role)
);

create index user_roles_user_idx on public.user_roles (user_id) where deleted_at is null;
create index user_roles_role_idx on public.user_roles (role)    where deleted_at is null;

select public.attach_audit('public.user_roles');
```

- [ ] **Step 2: Push + verify**

```bash
npm run db:push
npx supabase db query "select role from public.user_roles limit 0" --linked --output table
```

Expected: empty table with role column.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000002_user_roles.sql
git commit -m "feat(db): user_roles table (admin/moderator/player) + audit attached"
```

---

## Task 3: Migration — sessions table

**Files:**
- Create: `supabase/migrations/20260421000003_sessions.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
create table public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  ip_address          inet,
  user_agent          text,
  device_fingerprint  text not null,
  started_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  revoked_at          timestamptz,
  revoke_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index sessions_user_active_idx
  on public.sessions (user_id, started_at desc)
  where revoked_at is null and deleted_at is null;

create index sessions_fingerprint_idx
  on public.sessions (user_id, device_fingerprint)
  where deleted_at is null;

select public.attach_audit('public.sessions');
```

- [ ] **Step 2: Push**

```bash
npm run db:push
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000003_sessions.sql
git commit -m "feat(db): sessions table with device fingerprint + audit attached"
```

---

## Task 4: Migration — auth_events table

**Files:**
- Create: `supabase/migrations/20260421000004_auth_events.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Authentication events: login, login_failed, logout, password_reset,
-- new_device, session_revoked. Separate from audit_events because these are
-- security-centric, not CRUD audit.

create table public.auth_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users (id) on delete set null,
  event_type   text not null check (event_type in (
    'login','login_failed','logout','password_reset','new_device','session_revoked'
  )),
  ip_address   inet,
  user_agent   text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index auth_events_user_idx    on public.auth_events (user_id, created_at desc);
create index auth_events_type_idx    on public.auth_events (event_type, created_at desc);
```

Note: no `attach_audit` here — `auth_events` is itself an append-only log. Mutations on it are rare and allowed (unlike `audit_events` which is strictly append-only).

- [ ] **Step 2: Push + commit**

```bash
npm run db:push
git add supabase/migrations/20260421000004_auth_events.sql
git commit -m "feat(db): auth_events table for login/device/session security events"
```

---

## Task 5: Migration — auth.users → public.users sync trigger

**Files:**
- Create: `supabase/migrations/20260421000005_auth_user_trigger.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- When Supabase Auth creates a new auth.users row (signup / admin.createUser),
-- create a matching public.users row. Display name defaults to the email local-part
-- until the user edits their profile.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (supabase_auth_id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (supabase_auth_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
```

- [ ] **Step 2: Push**

```bash
npm run db:push
```

- [ ] **Step 3: Smoke test — create a test user via the Supabase Management API**

From the Supabase dashboard: Authentication → Users → `Add user` → `Create new user` → email `seed-test@cade.local`, password `dev-only-password`, Auto-confirm user: yes.

Then check the mirror row:

```bash
npx supabase db query "select id, email, display_name from public.users where email='seed-test@cade.local'" --linked --output table
```

Expected: one row with display_name `seed-test`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260421000005_auth_user_trigger.sql
git commit -m "feat(db): auth.users → public.users mirror trigger"
```

---

## Task 6: Migration — RLS policies on users + user_roles

**Files:**
- Create: `supabase/migrations/20260421000006_rls_users.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- RLS on PII tables only (per Phase 1A decision). Business perms live in API layer.

alter table public.users       enable row level security;
alter table public.user_roles  enable row level security;

-- A user can read their own public.users row.
create policy users_self_select
  on public.users for select
  using (supabase_auth_id = auth.uid());

-- A user can update their own non-sensitive fields.
-- (Server-side code with service role bypasses RLS for all other writes.)
create policy users_self_update
  on public.users for update
  using (supabase_auth_id = auth.uid())
  with check (supabase_auth_id = auth.uid());

-- user_roles is server-managed only. No client direct access.
-- (Server uses service role key which bypasses RLS.)
create policy user_roles_no_direct
  on public.user_roles for all
  using (false)
  with check (false);
```

- [ ] **Step 2: Push + verify**

```bash
npm run db:push
npx supabase db query "select relrowsecurity from pg_class where oid='public.users'::regclass" --linked --output table
```

Expected: `true`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000006_rls_users.sql
git commit -m "feat(db): RLS on users + user_roles (self-read, server-managed)"
```

---

## Task 7: Device fingerprint helper — TDD

**Files:**
- Create: `apps/web/src/server/auth/device.ts`
- Create: `apps/web/src/server/auth/device.test.ts`

- [ ] **Step 1: Failing test**

Contents of `device.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deviceFingerprint } from "./device";

describe("deviceFingerprint", () => {
  it("stable for same UA + IP prefix + lang", () => {
    const a = deviceFingerprint({
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
      ip: "102.89.4.17",
      acceptLanguage: "en-US,en;q=0.9",
    });
    const b = deviceFingerprint({
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
      ip: "102.89.4.219",
      acceptLanguage: "en-US,en;q=0.9",
    });
    expect(a).toBe(b);
  });

  it("differs on UA change", () => {
    const a = deviceFingerprint({
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
      ip: "102.89.4.17",
      acceptLanguage: "en-US",
    });
    const b = deviceFingerprint({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1",
      ip: "102.89.4.17",
      acceptLanguage: "en-US",
    });
    expect(a).not.toBe(b);
  });

  it("returns 64-char hex", () => {
    const fp = deviceFingerprint({
      userAgent: "x",
      ip: "1.2.3.4",
      acceptLanguage: "en",
    });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace apps/web run test
```

Expected: compile error, `./device` not found.

- [ ] **Step 3: Implement `device.ts`**

Contents:

```ts
import { createHash } from "node:crypto";

type Input = { userAgent: string; ip: string; acceptLanguage: string };

// Crude fingerprint: SHA-256 over normalized UA + IP /16 prefix + language.
// The /16 IP prefix tolerates normal ISP IP churn while still catching
// genuinely different networks.
function ipPrefix(ip: string): string {
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.0.0`;
  return ip; // IPv6 or malformed — hash the whole thing
}

export function deviceFingerprint(input: Input): string {
  const normalized = [
    input.userAgent.trim(),
    ipPrefix(input.ip.trim()),
    input.acceptLanguage.split(",")[0]?.trim() ?? "",
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 3 new tests pass (plus existing tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/auth/device.ts apps/web/src/server/auth/device.test.ts
git commit -m "feat(auth): deviceFingerprint helper (SHA-256 of UA + /16 IP + lang)"
```

---

## Task 8: Actor assembler + widened hasPerm — TDD

**Files:**
- Create: `apps/web/src/server/auth/actor.ts`
- Create: `apps/web/src/server/auth/actor.test.ts`
- Modify: `apps/web/src/perms.ts` (widen Actor)

- [ ] **Step 1: Widen Actor type in `perms.ts`**

Find:

```ts
type Actor = { roles: readonly string[] };
```

Replace with:

```ts
export type Actor = { userId: string | null; roles: readonly string[] };
```

The function body is unchanged. Tests still pass — existing tests use `{ roles: [...] }`; TypeScript will infer `userId: undefined`. Fix those tests by adding `userId: null`.

Open `apps/web/src/perms.test.ts` and update each actor literal to include `userId: null`. Example:

```ts
expect(hasPerm({ userId: null, roles: ["admin"] }, "matches.enter_score")).toBe(true);
```

Do this for all 5 tests in the file.

- [ ] **Step 2: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: still 11 tests passing (3 device + 3 time + 5 perms).

- [ ] **Step 3: Failing test for `getActorFromSession`**

Contents of `actor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getActorFromSession } from "./actor";

type SbUser = { id: string } | null;
type RoleRow = { role: string };

function mockSupabase(user: SbUser, roles: RoleRow[]) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: user ? { id: user.id } : null },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ data: roles, error: null }),
        })),
      })),
    })),
  };
}

describe("getActorFromSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when not authenticated", async () => {
    const sb = mockSupabase(null, []);
    const actor = await getActorFromSession(sb as never);
    expect(actor).toBeNull();
  });

  it("returns actor with userId + roles when authenticated", async () => {
    const sb = mockSupabase({ id: "auth-123" }, [{ role: "admin" }, { role: "player" }]);
    const actor = await getActorFromSession(sb as never, { userId: "pub-456" });
    expect(actor).toEqual({ userId: "pub-456", roles: ["admin", "player"] });
  });
});
```

- [ ] **Step 4: Run — expect FAIL (module missing)**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 5: Implement `actor.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/perms";

type GetActorOpts = {
  userId: string;   // public.users.id (already resolved by caller)
};

/**
 * Resolve the current Supabase Auth user + their active role memberships.
 * Returns null if not authenticated.
 *
 * Caller is responsible for resolving supabase_auth_id → public.users.id
 * before calling (typically via a cached lookup per-request).
 */
export async function getActorFromSession(
  supabase: SupabaseClient,
  opts?: GetActorOpts
): Promise<Actor | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  if (!opts) {
    return { userId: null, roles: [] };
  }

  const { data: rolesData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", opts.userId)
    .is("deleted_at", null);

  const roles = (rolesData ?? []).map((r: { role: string }) => r.role);
  return { userId: opts.userId, roles };
}
```

- [ ] **Step 6: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 2 new tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/perms.ts apps/web/src/perms.test.ts apps/web/src/server/auth/actor.ts apps/web/src/server/auth/actor.test.ts
git commit -m "feat(auth): getActorFromSession + widen Actor type to include userId"
```

---

## Task 9: Email transport (Resend with stdout fallback)

**Files:**
- Create: `apps/web/src/lib/email/resend.ts`
- Modify: `apps/web/package.json` (add `resend` dep)

- [ ] **Step 1: Install Resend SDK**

```bash
npm --workspace apps/web install resend
```

- [ ] **Step 2: Write `resend.ts`**

Contents:

```ts
import { Resend } from "resend";

type SendOpts = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

/**
 * Send an email via Resend. If RESEND_API_KEY is not set, log to stdout
 * so dev flows and tests don't require live API credentials.
 * Returns true if delivered (or logged in dev), false on error.
 */
export async function sendEmail(opts: SendOpts): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[email:stub]", JSON.stringify(opts, null, 2));
    return true;
  }

  const from = process.env.RESEND_FROM ?? "CADE League <noreply@cadeesports.com>";
  try {
    const client = new Resend(apiKey);
    const { error } = await client.emails.send({ from, ...opts });
    if (error) {
      console.error("[email:error]", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email:exception]", err);
    return false;
  }
}
```

- [ ] **Step 3: Verify build still passes**

```bash
npm --workspace apps/web run build
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/email apps/web/package.json apps/web/package-lock.json
git commit -m "feat(email): Resend transport with stdout stub when key absent"
```

---

## Task 10: Session record + new-device detection — TDD

**Files:**
- Create: `apps/web/src/server/auth/sessions.ts`
- Create: `apps/web/src/server/auth/sessions.test.ts`
- Create: `apps/web/src/server/auth/notify.ts`

- [ ] **Step 1: Failing test `sessions.test.ts`**

Contents:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordLogin } from "./sessions";

const mockSendEmail = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/email/resend", () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));

function mkSb({
  fingerprintSeenBefore,
  roles,
  user,
}: {
  fingerprintSeenBefore: boolean;
  roles: string[];
  user: { id: string; email: string; display_name: string };
}) {
  let insertCalls = 0;
  const select = vi.fn((table: string) => {
    // Chain helper that resolves with appropriate data depending on table+filters.
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({
              data: fingerprintSeenBefore ? [{ id: "prior" }] : [],
              error: null,
            }),
          })),
          is: vi.fn().mockResolvedValue({
            data: roles.map((r) => ({ role: r })),
            error: null,
          }),
        })),
      })),
    };
  });

  return {
    from: vi.fn((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: user, error: null }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }
      if (table === "sessions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: fingerprintSeenBefore ? [{ id: "prior" }] : [],
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: `new-session-${++insertCalls}` },
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "user_roles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({
                data: roles.map((r) => ({ role: r })),
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "auth_events") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe("recordLogin", () => {
  beforeEach(() => {
    mockSendEmail.mockClear();
  });

  it("creates session + auth_event + does NOT alert when fingerprint seen before", async () => {
    const sb = mkSb({
      fingerprintSeenBefore: true,
      roles: ["admin"],
      user: { id: "pub-1", email: "a@b", display_name: "A" },
    });
    const r = await recordLogin(sb as never, {
      publicUserId: "pub-1",
      ipAddress: "1.1.1.1",
      userAgent: "ua",
      acceptLanguage: "en",
    });
    expect(r.sessionId).toBeTruthy();
    expect(r.isNewDevice).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("alerts admin on new device", async () => {
    const sb = mkSb({
      fingerprintSeenBefore: false,
      roles: ["admin"],
      user: { id: "pub-1", email: "a@b", display_name: "A" },
    });
    const r = await recordLogin(sb as never, {
      publicUserId: "pub-1",
      ipAddress: "1.1.1.1",
      userAgent: "ua",
      acceptLanguage: "en",
    });
    expect(r.isNewDevice).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("does NOT alert non-admin on new device", async () => {
    const sb = mkSb({
      fingerprintSeenBefore: false,
      roles: ["player"],
      user: { id: "pub-1", email: "a@b", display_name: "A" },
    });
    const r = await recordLogin(sb as never, {
      publicUserId: "pub-1",
      ipAddress: "1.1.1.1",
      userAgent: "ua",
      acceptLanguage: "en",
    });
    expect(r.isNewDevice).toBe(true);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `notify.ts`**

Contents:

```ts
import { sendEmail } from "@/lib/email/resend";

type User = { email: string; display_name: string };
type Session = { ip_address: string | null; user_agent: string | null; started_at: string };

export async function sendNewDeviceAlert(user: User, session: Session): Promise<boolean> {
  const subject = "New device login on your CADE League admin account";
  const html = `
    <p>Hi ${user.display_name},</p>
    <p>A login to your CADE League admin account just happened from a device we haven't seen before.</p>
    <ul>
      <li><b>Time:</b> ${session.started_at}</li>
      <li><b>IP:</b> ${session.ip_address ?? "(unknown)"}</li>
      <li><b>Browser:</b> ${session.user_agent ?? "(unknown)"}</li>
    </ul>
    <p>If this was you, nothing to do. If not, reset your password immediately from the dashboard.</p>
  `.trim();
  const text = `New device login at ${session.started_at} from ${session.ip_address ?? "unknown IP"}.`;
  return sendEmail({ to: user.email, subject, html, text });
}
```

- [ ] **Step 3: Implement `sessions.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { deviceFingerprint } from "./device";
import { sendNewDeviceAlert } from "./notify";

export type RecordLoginInput = {
  publicUserId: string;
  ipAddress: string;
  userAgent: string;
  acceptLanguage: string;
};

export type RecordLoginResult = {
  sessionId: string;
  isNewDevice: boolean;
};

export async function recordLogin(
  sb: SupabaseClient,
  input: RecordLoginInput
): Promise<RecordLoginResult> {
  const fp = deviceFingerprint({
    userAgent: input.userAgent,
    ip: input.ipAddress,
    acceptLanguage: input.acceptLanguage,
  });

  // Look up user + roles in parallel.
  const [{ data: user }, { data: rolesRows }] = await Promise.all([
    sb.from("users").select("id, email, display_name").eq("id", input.publicUserId).single(),
    sb.from("user_roles").select("role").eq("user_id", input.publicUserId).is("deleted_at", null),
  ]);
  if (!user) throw new Error("user not found");

  // Have we seen this fingerprint for this user before?
  const { data: priorSessions } = await sb
    .from("sessions")
    .select("id")
    .eq("user_id", input.publicUserId)
    .eq("device_fingerprint", fp)
    .is("deleted_at", null)
    .limit(1);
  const isNewDevice = !priorSessions || priorSessions.length === 0;

  // Create the session row.
  const { data: session } = await sb
    .from("sessions")
    .insert({
      user_id: input.publicUserId,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      device_fingerprint: fp,
    })
    .select("id, ip_address, user_agent, started_at")
    .single();
  if (!session) throw new Error("session insert failed");

  // Log the auth event + bump last_login_at.
  await Promise.all([
    sb.from("auth_events").insert({
      user_id: input.publicUserId,
      event_type: "login",
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      metadata: { device_fingerprint: fp, is_new_device: isNewDevice },
    }),
    sb.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", input.publicUserId),
  ]);

  // Alert admins on a new device only.
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);
  if (isNewDevice && roles.includes("admin")) {
    await sb.from("auth_events").insert({
      user_id: input.publicUserId,
      event_type: "new_device",
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      metadata: { device_fingerprint: fp },
    });
    await sendNewDeviceAlert(user, {
      ip_address: session.ip_address,
      user_agent: session.user_agent,
      started_at: session.started_at,
    });
  }

  return { sessionId: session.id, isNewDevice };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 3 new tests pass. Total: 14 tests (11 prior + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/auth/sessions.ts apps/web/src/server/auth/sessions.test.ts apps/web/src/server/auth/notify.ts
git commit -m "feat(auth): recordLogin creates session + logs event + alerts admins on new device"
```

---

## Task 11: Middleware gate for (admin)/*

**Files:**
- Create: `apps/web/src/middleware.ts`

- [ ] **Step 1: Write middleware**

Contents:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const ADMIN_ROLES = new Set(["admin", "moderator"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only gate (admin)/*. The route group itself doesn't show in URL —
  // we use the physical path prefix `/admin/` set up in the layout structure
  // since Next.js strips (admin) from the URL but we named the folder /admin/.
  // Actually Next.js DOES strip route group parens, so pages under
  // src/app/(admin)/page.tsx are served at /. We need a different URL segment
  // for admin routes — see Task 12 which puts admin pages under /admin/.
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Resolve public.users.id + roles.
  const { data: pub } = await supabase
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();
  if (!pub) return NextResponse.redirect(new URL("/login", req.url));

  const { data: rolesRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);

  const allowed = roles.some((r) => ADMIN_ROLES.has(r));
  if (!allowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return res;
}

export const config = {
  matcher: ["/admin/:path*"],
};
```

- [ ] **Step 2: Typecheck**

```bash
npm --workspace apps/web run build
```

Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/middleware.ts
git commit -m "feat(auth): middleware gate redirects unauthenticated + 403s non-admin"
```

---

## Task 12: Admin landing + admin layout (physical /admin prefix)

**Files:**
- Create: `apps/web/src/app/admin/layout.tsx`
- Create: `apps/web/src/app/admin/page.tsx`

Note: we do NOT use the `(admin)` route group syntax because Next.js strips route groups from the URL. Middleware needs a URL-visible prefix to match. Plan 0's spec said route groups; we adjust here: physical `/admin` for staff UI, root `/` for public.

- [ ] **Step 1: Write admin layout**

Contents:

```tsx
import { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="font-semibold">CADE League · Admin</h1>
          <form action="/logout" method="post">
            <button className="text-sm underline" type="submit">Log out</button>
          </form>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Write admin landing**

Contents of `page.tsx`:

```tsx
export default function AdminHome() {
  return (
    <div className="space-y-4" data-testid="admin-home">
      <h2 className="text-2xl font-bold">Dashboard</h2>
      <p className="text-gray-600">Phase 1A · Auth wired. Build next: match entry.</p>
    </div>
  );
}
```

- [ ] **Step 3: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles. Two additional static routes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/admin
git commit -m "feat(web): /admin shell layout + landing page"
```

---

## Task 13: Login page + Server Action + session recording

**Files:**
- Create: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(auth)/login/actions.ts`
- Create: `apps/web/src/app/logout/route.ts`

- [ ] **Step 1: Write login page**

Contents:

```tsx
import { login } from "./actions";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form action={login} className="w-full max-w-sm space-y-4 border rounded p-6 bg-white">
        <h1 className="text-2xl font-bold">Log in</h1>
        {searchParams.error ? (
          <p className="text-red-600 text-sm" data-testid="login-error">
            {searchParams.error}
          </p>
        ) : null}
        <input type="hidden" name="next" value={searchParams.next ?? "/admin"} />
        <label className="block space-y-1">
          <span className="text-sm">Email</span>
          <input
            name="email"
            type="email"
            required
            className="w-full border rounded px-3 py-2"
            autoComplete="email"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">Password</span>
          <input
            name="password"
            type="password"
            required
            className="w-full border rounded px-3 py-2"
            autoComplete="current-password"
          />
        </label>
        <button className="w-full bg-black text-white rounded py-2" type="submit">
          Continue
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Write login Server Action**

Contents of `actions.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { recordLogin } from "@/server/auth/sessions";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  const sb = await getServerSupabase();
  const { error, data } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await sb.from("auth_events").insert({
      user_id: null,
      event_type: "login_failed",
      metadata: { email, reason: error?.message ?? "unknown" },
    });
    redirect(`/login?error=${encodeURIComponent("Invalid email or password")}`);
  }

  // Resolve public.users.id, then record the session.
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) {
    redirect(`/login?error=${encodeURIComponent("Account not provisioned")}`);
  }

  const h = await headers();
  await recordLogin(sb, {
    publicUserId: pub.id,
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0",
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
  });

  redirect(next);
}
```

- [ ] **Step 3: Write logout route**

Contents of `apps/web/src/app/logout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();

  if (data.user) {
    const { data: pub } = await sb
      .from("users")
      .select("id")
      .eq("supabase_auth_id", data.user.id)
      .single();
    if (pub) {
      await sb.from("auth_events").insert({
        user_id: pub.id,
        event_type: "logout",
      });
    }
  }

  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
```

- [ ] **Step 4: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles. Login + logout routes registered.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(auth) apps/web/src/app/logout
git commit -m "feat(auth): /login page + server action + /logout route with event logging"
```

---

## Task 14: Seed an admin user manually + E2E happy path

**Files:**
- Create: `apps/web/tests/e2e/login.spec.ts`

- [ ] **Step 1: Seed admin user**

Via Supabase dashboard:
1. Authentication → Users → Add user → `admin@cade.local`, password `dev-admin-2026`, Auto-confirm: yes.
2. The `handle_new_auth_user` trigger creates `public.users` row automatically.

Via CLI (assign admin role):

```bash
npx --yes supabase db query "insert into public.user_roles (user_id, role) select id, 'admin' from public.users where email='admin@cade.local'" --linked --output table
```

Expected: one row inserted.

- [ ] **Step 2: Write E2E `login.spec.ts`**

Contents:

```ts
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

test("admin can log in and reach /admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByTestId("admin-home")).toBeVisible();
});

test("wrong password shows error and does not navigate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("login-error")).toBeVisible();
});

test("unauthenticated visitor is redirected from /admin to /login", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 3: Run E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: 4 tests pass total (1 smoke from Plan 0 + 3 new login tests).

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e/login.spec.ts
git commit -m "test(e2e): login happy path + wrong-password + unauth redirect"
```

---

## Task 15: Admin session history page

**Files:**
- Create: `apps/web/src/app/admin/security/sessions/page.tsx`
- Create: `apps/web/src/app/admin/security/sessions/actions.ts`

- [ ] **Step 1: Write actions.ts**

Contents:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export async function revokeSession(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const reason = String(formData.get("reason") ?? "admin_revoke");
  if (!sessionId) return;

  const sb = await getServerSupabase();
  await sb
    .from("sessions")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq("id", sessionId);
  await sb.from("auth_events").insert({
    event_type: "session_revoked",
    metadata: { session_id: sessionId, reason },
  });
  revalidatePath("/admin/security/sessions");
}
```

- [ ] **Step 2: Write page.tsx**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { revokeSession } from "./actions";

export default async function SessionsPage() {
  const sb = await getServerSupabase();
  const { data: sessions } = await sb
    .from("sessions")
    .select("id, user_id, ip_address, user_agent, started_at, last_seen_at, revoked_at")
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Recent sessions</h2>
      <table className="w-full text-sm border">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">Started (WAT)</th>
            <th className="text-left p-2">User</th>
            <th className="text-left p-2">IP</th>
            <th className="text-left p-2">UA</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(sessions ?? []).map((s) => (
            <tr key={s.id} className="border-t">
              <td className="p-2">{formatWat(s.started_at, "yyyy-MM-dd HH:mm")}</td>
              <td className="p-2 font-mono text-xs">{s.user_id}</td>
              <td className="p-2">{s.ip_address ?? "—"}</td>
              <td className="p-2 truncate max-w-[240px]" title={s.user_agent ?? ""}>
                {s.user_agent ?? "—"}
              </td>
              <td className="p-2">{s.revoked_at ? "revoked" : "active"}</td>
              <td className="p-2">
                {!s.revoked_at ? (
                  <form action={revokeSession}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <button className="text-red-600 underline" type="submit">Revoke</button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Build**

```bash
npm --workspace apps/web run build
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/admin/security
git commit -m "feat(admin): session history table + revoke action"
```

---

## Task 16: Final verification

- [ ] **Step 1: All migrations applied**

```bash
npm run db:push
```

Expected: `No schemas to push` (all migrations already in cloud from prior tasks).

- [ ] **Step 2: Unit tests**

```bash
npm run test
```

Expected: 14 tests pass (3 time + 5 perms + 3 device + 3 sessions).

- [ ] **Step 3: Lint + build**

```bash
npm run lint && npm run build
```

Expected: both clean.

- [ ] **Step 4: E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: 4 tests pass (1 smoke + 3 login).

- [ ] **Step 5: Audit trigger still works on new tables**

```bash
npx --yes supabase db query "select entity_type, action, count(*) from public.audit_events where entity_type in ('users','user_roles','sessions') group by 1,2" --linked --output table
```

Expected: at least rows for `users` insert (from trigger during dashboard seed) and `user_roles` insert (from CLI seed).

- [ ] **Step 6: Update `tasks/todo.md`**

Move Plan 1 to Done, add verification notes:

```markdown
## Done
- Plan 1 — Auth + Roles + Sessions complete (2026-04-XX). All 16 tasks green.
  - 4 migration files applied to cloud
  - hasPerm bound to real user_roles via getActorFromSession
  - Middleware gates /admin/*
  - Login/logout flow with session recording + new-device alert
  - E2E green (4 tests)
```

- [ ] **Step 7: Commit verification**

```bash
git add tasks/todo.md
git commit -m "docs(tasks): Plan 1 complete"
```

---

## Out of Scope for Plan 1

- MFA (Phase 3).
- Password reset flow UI (Supabase Auth built-in works via magic link; defer custom UI).
- Admin user creation UI (Phase 1B — Plan 1 uses dashboard + SQL).
- Device fingerprint refinement (canvas/WebGL) — current SHA is deliberately crude and acceptable per spec §11.
- Role editing UI (Phase 1B — migrate from hard-coded map to DB editor).
- Player self-signup flow (players get admin-created accounts).
- Rate limiting on login endpoint (add before public launch).

---

## Review / Acceptance Criteria

Plan 1 is done when:

1. `git log --oneline` shows ~16 commits (one per task).
2. All tests green: 14 unit, 4 E2E.
3. A seeded admin can log in at `/login` → lands at `/admin` → sees dashboard.
4. Wrong password → stays on `/login` with error visible.
5. Unauthenticated visit to `/admin/*` → redirected to `/login?next=...`.
6. `public.audit_events` shows rows for `users`, `user_roles`, `sessions` inserts.
7. `public.auth_events` shows one `login` row per real login, one `new_device` row when applicable, `logout` + `session_revoked` rows as triggered.
8. Seeded admin with a fresh UA (incognito window) triggers stdout log of a new-device email (or real email if `RESEND_API_KEY` present).
