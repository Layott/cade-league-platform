# Plan 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the empty-but-runnable Next.js 15 + Supabase monorepo for the CADE League platform, with a working audit-log trigger mechanism and the lint/test baseline all later plans rely on.

**Architecture:** Single Next.js 15 (App Router) app at `apps/web/`, Supabase local stack for Postgres + Auth + Storage in dev, SQL migrations checked into `supabase/migrations/`. Audit log is a generic Postgres trigger attached to every mutable table via a helper function; API routes set `app.current_user_id` via `SET LOCAL` so the trigger can capture actor without hand-coded calls.

**Tech Stack:** Next.js 15, React 19, TypeScript 5, Tailwind CSS 3, shadcn/ui, Supabase CLI, Supabase JS client, Vitest, Playwright, ESLint, Prettier, GitHub Actions.

**Prerequisites on the dev machine:**
- Node.js ≥ 20
- Docker Desktop running (Supabase local uses Docker)
- Supabase CLI ≥ 1.200 (`npm i -g supabase`)
- Git ≥ 2.40

**Shippable at end of Plan 0:**
- `npm run dev` in `apps/web` serves a Next.js app at http://localhost:3000 showing a minimal landing page.
- `supabase start` brings up a local Postgres with migrations applied.
- Running the audit-trigger smoke test inserts/updates/deletes on `test_table` and verifies rows appear in `audit_events`.
- `npm run lint`, `npm run test`, `npm run build` all pass.

---

## File Structure (created by this plan)

```
ESOCCER/
├── .gitignore
├── .nvmrc
├── package.json                     # root (workspaces: ["apps/*"])
├── README.md
├── CLAUDE.md                        # already exists
├── apps/
│   └── web/
│       ├── package.json
│       ├── next.config.ts
│       ├── tsconfig.json
│       ├── tailwind.config.ts
│       ├── postcss.config.mjs
│       ├── .eslintrc.json
│       ├── vitest.config.ts
│       ├── playwright.config.ts
│       ├── .env.example
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx
│       │   │   └── globals.css
│       │   ├── lib/
│       │   │   ├── supabase/
│       │   │   │   ├── server.ts
│       │   │   │   └── browser.ts
│       │   │   ├── time.ts
│       │   │   └── time.test.ts
│       │   └── perms.ts
│       └── tests/
│           └── e2e/
│               └── smoke.spec.ts
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 20260420000001_init_extensions.sql
│   │   ├── 20260420000002_audit_events.sql
│   │   ├── 20260420000003_audit_trigger.sql
│   │   └── 20260420000004_audit_smoke_table.sql
│   └── tests/
│       └── audit_smoke.sql
├── scripts/
│   └── audit-smoke.sh
├── tasks/
│   ├── todo.md                       # already exists if empty
│   └── lessons.md
└── .github/
    └── workflows/
        └── ci.yml
```

---

## Task 1: Git init + base ignore + Node version

**Files:**
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `README.md`

- [ ] **Step 1: Initialize git repo**

Run from the repo root (`C:/Users/Sweez/Desktop/LAYO/CLAUDE/GAMEEVO/ESOCCER`):

```bash
git init
git branch -M main
```

Expected: `Initialized empty Git repository` + branch rename success.

- [ ] **Step 2: Write `.gitignore`**

Contents:

```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Build output
.next/
out/
dist/
build/

# Environment
.env
.env.local
.env.*.local
!.env.example

# Editors / OS
.vscode/
.idea/
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Testing
coverage/
playwright-report/
test-results/

# Supabase local state
supabase/.branches/
supabase/.temp/
supabase/.env

# Backups
backups/
*.dump

# Claude / plugin state
.claude/cache/
```

- [ ] **Step 3: Write `.nvmrc`**

Contents:

```
20
```

- [ ] **Step 4: Write minimal `README.md`**

Contents:

```markdown
# CADE League Platform

In-house platform powering CADE Esports leagues. Phase 1A in progress (Division 1 Elite 2025-2026).

See `CLAUDE.md` for contribution guidance and `docs/superpowers/specs/` for design docs.

## Dev setup

1. Install Node 20 (`nvm use`) and Docker Desktop.
2. `npm install` at repo root.
3. `npx supabase start` to bring up the local DB (requires Docker).
4. `cd apps/web && npm run dev` to serve the app.

## Scripts (root)

- `npm run dev` — start Next.js dev server
- `npm run test` — run unit tests (Vitest)
- `npm run e2e` — run Playwright end-to-end tests
- `npm run lint` — lint the monorepo
- `npm run build` — production build
```

- [ ] **Step 5: First commit**

```bash
git add .gitignore .nvmrc README.md CLAUDE.md "ESOCCER LEAGUE" docs tasks
git commit -m "chore: initial repo scaffold (gitignore, nvmrc, README, existing docs)"
```

Expected: commit succeeds with the listed paths.

---

## Task 2: Root workspace package.json

**Files:**
- Create: `package.json`

- [ ] **Step 1: Write root `package.json`**

Contents:

```json
{
  "name": "cade-league-platform",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["apps/*"],
  "scripts": {
    "dev": "npm --workspace apps/web run dev",
    "build": "npm --workspace apps/web run build",
    "start": "npm --workspace apps/web run start",
    "lint": "npm --workspace apps/web run lint",
    "test": "npm --workspace apps/web run test",
    "e2e": "npm --workspace apps/web run e2e",
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop",
    "supabase:reset": "supabase db reset",
    "audit:smoke": "bash scripts/audit-smoke.sh"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add root workspace package.json"
```

---

## Task 3: Scaffold Next.js 15 app at apps/web

**Files:**
- Run scaffolder
- Modify: `apps/web/package.json` (add scripts)
- Create: `apps/web/.env.example`

- [ ] **Step 1: Create the app via `create-next-app`**

```bash
npx create-next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack --yes
```

Expected: Next.js 15+ app scaffolded at `apps/web`. Template includes `src/app/page.tsx`, `src/app/layout.tsx`, `tailwind.config.ts`, etc.

- [ ] **Step 2: Install Supabase client + runtime deps**

```bash
npm --workspace apps/web install @supabase/supabase-js @supabase/ssr zod date-fns date-fns-tz
```

- [ ] **Step 3: Install dev deps (testing + shadcn peer deps)**

```bash
npm --workspace apps/web install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event playwright @playwright/test prettier
```

- [ ] **Step 4: Add scripts to `apps/web/package.json`**

Edit `apps/web/package.json`. The `scripts` block should end up as:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test",
  "format": "prettier --write ."
}
```

- [ ] **Step 5: Create `apps/web/.env.example`**

Contents:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<fill from `supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<fill from `supabase status`>
RESEND_API_KEY=
APP_TIMEZONE=Africa/Lagos
```

- [ ] **Step 6: Verify scaffold runs**

```bash
npm --workspace apps/web run build
```

Expected: build completes without type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "chore: scaffold Next.js 15 app at apps/web with deps"
```

---

## Task 4: Supabase local init

**Files:**
- Create: `supabase/config.toml` (via CLI)

- [ ] **Step 1: Initialize Supabase**

```bash
npx supabase init
```

Expected: creates `supabase/` directory with `config.toml`, `.gitignore` inside supabase dir, etc.

- [ ] **Step 2: Start local Supabase (requires Docker running)**

```bash
npx supabase start
```

Expected: ~1-2 min first run pulling images. Prints `API URL`, `DB URL`, `anon key`, `service_role key`. Copy these into `apps/web/.env.local` (create this file — it's gitignored).

Create `apps/web/.env.local` manually with the printed values. Do NOT commit it.

- [ ] **Step 3: Verify DB is reachable**

```bash
npx supabase status
```

Expected: shows running services, DB port 54322 by default.

- [ ] **Step 4: Commit Supabase config**

```bash
git add supabase/config.toml supabase/.gitignore
git commit -m "chore: init Supabase local stack"
```

---

## Task 5: Migration — extensions + audit_events table

**Files:**
- Create: `supabase/migrations/20260420000001_init_extensions.sql`
- Create: `supabase/migrations/20260420000002_audit_events.sql`

- [ ] **Step 1: Write `20260420000001_init_extensions.sql`**

Contents:

```sql
-- Enable extensions used across the platform.
create extension if not exists pgcrypto;     -- gen_random_uuid()
create extension if not exists pg_trgm;      -- later: fuzzy search on names
create extension if not exists citext;       -- case-insensitive emails
```

- [ ] **Step 2: Write `20260420000002_audit_events.sql`**

Contents:

```sql
-- Append-only audit log. No update/delete allowed, even by admins.

create table public.audit_events (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid,
  actor_role      text,
  action          text not null check (action in ('insert','update','delete')),
  entity_type     text not null,
  entity_id       text,
  before_json     jsonb,
  after_json      jsonb,
  ip_address      inet,
  user_agent      text,
  request_id      text,
  created_at      timestamptz not null default now()
);

create index audit_events_entity_idx  on public.audit_events (entity_type, entity_id);
create index audit_events_actor_idx   on public.audit_events (actor_user_id, created_at desc);
create index audit_events_created_idx on public.audit_events (created_at desc);

-- Block any UPDATE or DELETE on audit_events.
create or replace function public.audit_events_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only; % not allowed', tg_op;
end;
$$;

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.audit_events_block_mutation();

create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.audit_events_block_mutation();
```

- [ ] **Step 3: Apply migration**

```bash
npx supabase db reset
```

Expected: resets DB and re-applies all migrations cleanly. Prints "Finished supabase db reset." Both migrations listed.

- [ ] **Step 4: Verify block works**

```bash
npx supabase db execute --sql "insert into public.audit_events (action, entity_type) values ('insert','smoke');"
npx supabase db execute --sql "update public.audit_events set action='update' where entity_type='smoke';"
```

Expected: first succeeds, second fails with `audit_events is append-only; UPDATE not allowed`.

Clean up:

```bash
npx supabase db reset
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): add append-only audit_events table + mutation block"
```

---

## Task 6: Migration — generic audit trigger + attach helper

**Files:**
- Create: `supabase/migrations/20260420000003_audit_trigger.sql`

- [ ] **Step 1: Write `20260420000003_audit_trigger.sql`**

Contents:

```sql
-- Generic row-change audit trigger.
-- Reads app.current_user_id / app.current_user_role / app.request_id
-- set by the API layer via SET LOCAL on each request.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid;
  v_actor_role    text;
  v_request_id    text;
  v_entity_id     text;
  v_before        jsonb;
  v_after         jsonb;
begin
  v_actor_user_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
  v_actor_role    := nullif(current_setting('app.current_user_role', true), '');
  v_request_id    := nullif(current_setting('app.request_id', true), '');

  if tg_op = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(new);
    v_entity_id := coalesce((to_jsonb(new)->>'id'), null);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_entity_id := coalesce((to_jsonb(new)->>'id'), null);
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_after  := null;
    v_entity_id := coalesce((to_jsonb(old)->>'id'), null);
  end if;

  insert into public.audit_events (
    actor_user_id, actor_role, action,
    entity_type, entity_id, before_json, after_json, request_id
  ) values (
    v_actor_user_id, v_actor_role, lower(tg_op),
    tg_table_name, v_entity_id, v_before, v_after, v_request_id
  );

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

-- Helper: attach the audit trigger to a table by name.
create or replace function public.attach_audit(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_trigger_name text;
begin
  v_trigger_name := 'audit_' || replace(p_table::text, '.', '_');
  execute format(
    'drop trigger if exists %I on %s',
    v_trigger_name, p_table
  );
  execute format(
    'create trigger %I after insert or update or delete on %s for each row execute function public.audit_row_change()',
    v_trigger_name, p_table
  );
end;
$$;

-- Helper: set request context from the API layer.
create or replace function public.set_request_context(
  p_user_id   uuid,
  p_role      text,
  p_request_id text
) returns void
language plpgsql
as $$
begin
  perform set_config('app.current_user_id', coalesce(p_user_id::text, ''), true);
  perform set_config('app.current_user_role', coalesce(p_role, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
end;
$$;
```

- [ ] **Step 2: Apply + sanity check**

```bash
npx supabase db reset
```

Expected: all 3 migrations apply cleanly.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420000003_audit_trigger.sql
git commit -m "feat(db): generic audit_row_change trigger + attach_audit helper"
```

---

## Task 7: Migration — smoke-test table + assertion test

**Files:**
- Create: `supabase/migrations/20260420000004_audit_smoke_table.sql`
- Create: `supabase/tests/audit_smoke.sql`
- Create: `scripts/audit-smoke.sh`

- [ ] **Step 1: Write `20260420000004_audit_smoke_table.sql`**

Contents:

```sql
-- A throwaway table used only to verify the audit trigger works end-to-end.
-- Real feature tables live in their own migrations (Plans 1+).
create table public.audit_smoke (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  created_at timestamptz not null default now()
);

select public.attach_audit('public.audit_smoke');
```

- [ ] **Step 2: Write `supabase/tests/audit_smoke.sql`**

Contents:

```sql
-- Test script: runs in a single psql session so SET LOCAL works inside the tx.
begin;

select public.set_request_context(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'admin',
  'req-test-001'
);

insert into public.audit_smoke (label) values ('hello') returning id \gset smoke_
update public.audit_smoke set label = 'hello2' where id = :'smoke_id';
delete from public.audit_smoke where id = :'smoke_id';

-- Assertions: expect exactly 3 audit rows (insert, update, delete).
do $$
declare
  v_count int;
  v_insert_count int;
  v_update_count int;
  v_delete_count int;
begin
  select count(*) into v_count
    from public.audit_events
    where entity_type = 'audit_smoke' and request_id = 'req-test-001';
  if v_count <> 3 then
    raise exception 'expected 3 audit rows, got %', v_count;
  end if;

  select count(*) into v_insert_count
    from public.audit_events
    where entity_type = 'audit_smoke' and action = 'insert' and request_id = 'req-test-001';
  select count(*) into v_update_count
    from public.audit_events
    where entity_type = 'audit_smoke' and action = 'update' and request_id = 'req-test-001';
  select count(*) into v_delete_count
    from public.audit_events
    where entity_type = 'audit_smoke' and action = 'delete' and request_id = 'req-test-001';

  if v_insert_count <> 1 or v_update_count <> 1 or v_delete_count <> 1 then
    raise exception 'expected one of each action, got i=%, u=%, d=%',
      v_insert_count, v_update_count, v_delete_count;
  end if;
end;
$$;

rollback;
```

- [ ] **Step 3: Write `scripts/audit-smoke.sh`**

Contents:

```bash
#!/usr/bin/env bash
# Run the audit-smoke assertion test against local Supabase.
# Requires `supabase start` to have been run.

set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/audit_smoke.sql

echo "audit-smoke: OK"
```

Make executable:

```bash
chmod +x scripts/audit-smoke.sh
```

- [ ] **Step 4: Apply migration + run smoke test**

```bash
npx supabase db reset
npm run audit:smoke
```

Expected: prints `audit-smoke: OK`. If it fails, the assertion block raised an exception — fix the trigger or test, then re-run.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260420000004_audit_smoke_table.sql supabase/tests scripts package.json
git commit -m "test(db): audit trigger smoke test (insert/update/delete captured)"
```

---

## Task 8: Supabase client helpers (server + browser)

**Files:**
- Create: `apps/web/src/lib/supabase/server.ts`
- Create: `apps/web/src/lib/supabase/browser.ts`

- [ ] **Step 1: Write `server.ts`**

Contents:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Use in Server Components, Route Handlers, Server Actions.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component; cookies are read-only there.
          }
        },
      },
    }
  );
}
```

- [ ] **Step 2: Write `browser.ts`**

Contents:

```ts
import { createBrowserClient } from "@supabase/ssr";

/**
 * Client-side Supabase client. Use in Client Components only.
 */
export function getBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: Type-check**

```bash
npm --workspace apps/web run build
```

Expected: build succeeds. Ignore lint warnings about unused files for now.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/supabase
git commit -m "feat(web): supabase server + browser clients"
```

---

## Task 9: Timezone utility (WAT) + unit test

**Files:**
- Create: `apps/web/src/lib/time.ts`
- Create: `apps/web/src/lib/time.test.ts`
- Create: `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json` (already added test script in Task 3)

- [ ] **Step 1: Write `vitest.config.ts`**

Contents:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 2: Write the failing test `src/lib/time.test.ts`**

Contents:

```ts
import { describe, it, expect } from "vitest";
import { formatWat, toWatIso, APP_TIMEZONE } from "./time";

describe("time utilities", () => {
  it("APP_TIMEZONE is Africa/Lagos", () => {
    expect(APP_TIMEZONE).toBe("Africa/Lagos");
  });

  it("formatWat formats UTC to WAT (UTC+1, no DST)", () => {
    // 2026-04-20 15:00:00 UTC → 16:00 WAT
    const d = new Date("2026-04-20T15:00:00Z");
    expect(formatWat(d, "yyyy-MM-dd HH:mm")).toBe("2026-04-20 16:00");
  });

  it("toWatIso returns WAT offset", () => {
    const d = new Date("2026-04-20T15:00:00Z");
    expect(toWatIso(d)).toMatch(/^2026-04-20T16:00:00\+01:00$/);
  });
});
```

- [ ] **Step 3: Run the test — expect FAIL**

```bash
npm --workspace apps/web run test
```

Expected: test fails because `./time` does not exist.

- [ ] **Step 4: Write `src/lib/time.ts`**

Contents:

```ts
import { formatInTimeZone } from "date-fns-tz";

export const APP_TIMEZONE = "Africa/Lagos" as const;

export function formatWat(date: Date | string, pattern: string): string {
  return formatInTimeZone(date, APP_TIMEZONE, pattern);
}

export function toWatIso(date: Date | string): string {
  return formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssxxx");
}
```

- [ ] **Step 5: Run the test — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/time.ts apps/web/src/lib/time.test.ts apps/web/vitest.config.ts
git commit -m "feat(web): WAT timezone helpers + vitest setup"
```

---

## Task 10: Permissions stub (Phase 1A hard-coded map)

**Files:**
- Create: `apps/web/src/perms.ts`
- Create: `apps/web/src/perms.test.ts`

- [ ] **Step 1: Write the failing test `src/perms.test.ts`**

Contents:

```ts
import { describe, it, expect } from "vitest";
import { hasPerm } from "./perms";

describe("hasPerm", () => {
  it("admin matches a wildcard scope", () => {
    expect(hasPerm({ roles: ["admin"] }, "matches.enter_score")).toBe(true);
  });

  it("moderator can publish announcements but not edit users", () => {
    expect(hasPerm({ roles: ["moderator"] }, "announcements.publish")).toBe(true);
    expect(hasPerm({ roles: ["moderator"] }, "users.delete")).toBe(false);
  });

  it("player cannot mark attendance", () => {
    expect(hasPerm({ roles: ["player"] }, "attendance.mark")).toBe(false);
  });

  it("unauthenticated (no roles) can read public standings", () => {
    expect(hasPerm({ roles: [] }, "standings.read.public")).toBe(true);
  });

  it("multi-role user gets union of permissions", () => {
    expect(hasPerm({ roles: ["player", "moderator"] }, "punishments.issue")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm --workspace apps/web run test
```

Expected: fails, no `./perms` module.

- [ ] **Step 3: Write `src/perms.ts`**

Contents:

```ts
/**
 * Phase 1A hard-coded permission map.
 *
 * Migration path (Phase 1B): replace PERMS with a DB-backed table read cached
 * per-request. hasPerm() signature must stay identical.
 *
 * Glob rules:
 *   - "matches.*" matches any "matches.<anything>"
 *   - "*" matches everything
 *   - exact string matches exact action
 */

export type RoleName = "admin" | "moderator" | "player";

export const PERMS: Record<RoleName, readonly string[]> = {
  admin: ["*"],
  moderator: [
    "announcements.*",
    "punishments.issue",
    "punishments.edit",
    "punishments.revoke",
    "attendance.mark",
    "attendance.edit",
    "matches.read",
    "standings.read",
    "audit.read",
  ],
  player: [
    "matches.read",
    "standings.read",
    "announcements.read.own",
    "profile.edit.own",
  ],
} as const;

export const PUBLIC_PERMS: readonly string[] = [
  "matches.read.public",
  "standings.read.public",
  "announcements.read.public",
  "players.read.public",
  "fixtures.read.public",
  "punishments.read.public",
];

type Actor = { roles: readonly string[] };

function matchesPerm(rule: string, action: string): boolean {
  if (rule === "*") return true;
  if (rule === action) return true;
  if (rule.endsWith(".*")) {
    const prefix = rule.slice(0, -1); // keeps trailing dot
    return action.startsWith(prefix);
  }
  return false;
}

export function hasPerm(actor: Actor, action: string): boolean {
  if (PUBLIC_PERMS.some((r) => matchesPerm(r, action))) return true;
  for (const role of actor.roles) {
    const rules = PERMS[role as RoleName];
    if (!rules) continue;
    if (rules.some((r) => matchesPerm(r, action))) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: all 5 perms tests pass (plus the 3 time tests from Task 9 = 8 total).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/perms.ts apps/web/src/perms.test.ts
git commit -m "feat(web): Phase 1A hard-coded permission map + hasPerm helper"
```

---

## Task 11: Minimal landing page + smoke E2E

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Replace `src/app/page.tsx` with a minimal, identifiable landing**

Contents:

```tsx
export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-4">
        <h1 className="text-3xl font-bold">CADE League Platform</h1>
        <p className="text-gray-600" data-testid="stage-marker">
          Phase 1A · Foundations
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Write `apps/web/playwright.config.ts`**

Contents:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

- [ ] **Step 3: Write `tests/e2e/smoke.spec.ts`**

Contents:

```ts
import { test, expect } from "@playwright/test";

test("landing page renders and shows Phase 1A stage marker", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CADE League Platform" })).toBeVisible();
  await expect(page.getByTestId("stage-marker")).toHaveText("Phase 1A · Foundations");
});
```

- [ ] **Step 4: Install Playwright browsers (one-time)**

```bash
npx playwright install --with-deps chromium
```

Expected: installs Chromium. On Windows `--with-deps` is a no-op; just ensures the browser binary is present.

- [ ] **Step 5: Run the E2E test**

```bash
npm --workspace apps/web run e2e
```

Expected: 1 test passes. The webServer entry boots `next dev` automatically.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/playwright.config.ts apps/web/tests
git commit -m "test(web): landing page + Playwright smoke E2E"
```

---

## Task 12: Prettier + ESLint baseline

**Files:**
- Create: `apps/web/.prettierrc`
- Create: `apps/web/.prettierignore`
- Modify: `apps/web/.eslintrc.json` (added by create-next-app)

- [ ] **Step 1: Write `.prettierrc`**

Contents:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 2: Write `.prettierignore`**

Contents:

```
.next
node_modules
coverage
playwright-report
test-results
dist
build
```

- [ ] **Step 3: Verify `.eslintrc.json` extends `next/core-web-vitals`**

Open `apps/web/.eslintrc.json`. It should have been created by `create-next-app` with at minimum:

```json
{
  "extends": ["next/core-web-vitals", "next/typescript"]
}
```

If not, overwrite with the block above.

- [ ] **Step 4: Run lint**

```bash
npm --workspace apps/web run lint
```

Expected: no errors (warnings OK on scaffolded files).

- [ ] **Step 5: Commit**

```bash
git add apps/web/.prettierrc apps/web/.prettierignore apps/web/.eslintrc.json
git commit -m "chore(web): Prettier + ESLint config"
```

---

## Task 13: tasks/ workflow files

**Files:**
- Create (or ensure exist): `tasks/todo.md`
- Create: `tasks/lessons.md`

- [ ] **Step 1: Write `tasks/todo.md`**

Contents:

```markdown
# Tasks — Active Work

Active plan: `docs/superpowers/plans/2026-04-20-plan-0-foundations.md`

Update this file as work progresses per parent CLAUDE.md workflow.

## In Progress
- Plan 0 — Foundations (scaffold, Supabase, audit trigger, lint/test baseline)

## Done
- Spec: `docs/superpowers/specs/2026-04-20-phase-1a-design.md`
- Product doc updated to v0.2 with decisions log

## Review
(add per-task notes as items complete)
```

- [ ] **Step 2: Write `tasks/lessons.md`**

Contents:

```markdown
# Lessons Learned

Append patterns after any correction from the user. Keep each entry short: what I did wrong, what to do instead, why.

## Template

```
**Date:** YYYY-MM-DD
**Context:** (what was happening)
**Mistake:** (what I did)
**Correction:** (what the user said or preferred)
**Rule for future:** (concrete behavior change)
```
```

- [ ] **Step 3: Commit**

```bash
git add tasks
git commit -m "docs: seed tasks/todo.md and tasks/lessons.md"
```

---

## Task 14: CI workflow (lint + test)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

Contents:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build
```

Note: CI does not run Playwright E2E or Supabase (they need Docker). Add later when we have stable DB seeding.

- [ ] **Step 2: Commit**

```bash
git add .github
git commit -m "ci: add lint/test/build workflow"
```

---

## Task 15: Final verification run

- [ ] **Step 1: Reset DB + run audit smoke**

```bash
npx supabase db reset
npm run audit:smoke
```

Expected: `audit-smoke: OK`.

- [ ] **Step 2: Unit tests**

```bash
npm run test
```

Expected: all tests pass (time + perms = 8 tests).

- [ ] **Step 3: E2E test (requires Supabase local running, Next dev boot)**

```bash
npm run e2e
```

Expected: 1 E2E test passes.

- [ ] **Step 4: Production build**

```bash
npm run build
```

Expected: Next.js build succeeds. No type errors. No lint errors.

- [ ] **Step 5: Update `tasks/todo.md` — move Plan 0 to Done, add review notes**

Edit the file:

```markdown
## Done
- Plan 0 — Foundations complete. Next.js scaffolded, Supabase local running, audit trigger smoke green, lint+test+build+e2e all green.

## Review
- Plan 0 verified 2026-04-XX (YYYY-MM-DD). All 4 verification commands pass.
- Next: Plan 1 — Auth + Roles + Sessions.
```

- [ ] **Step 6: Commit verification note**

```bash
git add tasks/todo.md
git commit -m "docs(tasks): mark Plan 0 complete with verification results"
```

---

## Out of Scope for Plan 0

These belong to later plans — do not build here:

- User / player / role tables (Plan 1)
- Login UI, session tracking, new-device alert (Plan 1)
- Season / match / standings tables (Plans 2–3)
- Announcements, punishments, attendance (Plans 4–6)
- Resend email wiring beyond env var stub (Plan 1 wires it for new-device alert)
- Backup automation scripts (added after Plan 1 when there is real data)
- shadcn/ui component installs (pulled in per-task by later plans as components are actually used)

---

## Review / Acceptance Criteria

Plan 0 is done when:

1. `git log --oneline` shows ~14 focused commits (one per task, maybe a few extra).
2. `npm run lint && npm run test && npm run build && npm run audit:smoke` all exit 0.
3. `npx supabase db reset` re-applies all 4 migrations without error.
4. `npm run e2e` passes with the landing page visible.
5. `apps/web/.env.local` exists with local Supabase keys (not committed).
6. `tasks/todo.md` reflects Plan 0 as Done with a dated review note.
