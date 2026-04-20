# Plan 7 — Soft Delete Trash UI + Public Homepage Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out Phase 1A with two orthogonal pieces:

- **Part A — Admin Trash UI:** A single admin page (`/admin/trash`) that lists soft-deleted rows across every mutable entity introduced in Plans 1-6 and lets admins restore them. The existing audit trigger captures restore actions automatically.
- **Part B — Public Homepage polish:** Replace the scaffold `/` page with a real landing page that pulls live data from standings, fixtures, and announcements. Tighten `/standings`, `/fixtures`, `/players` to be presentable for first public share.

**Architecture:**

- Trash UI uses tabs per entity type, each rendered by a server component reading `deleted_at IS NOT NULL`. A single `restore(entityType, id, actorUserId)` Server Action maps entity strings to whitelisted tables via an explicit switch — never string-interpolated SQL. Purge button is rendered disabled in Phase 1A with a tooltip noting the 30-day purge is deferred.
- Public pages are Server Components only (`export const revalidate = 60` ISR). All queries filter `deleted_at IS NULL` (including nested joins — match_days with deleted match_days are hidden even if referenced).
- Aesthetically plain Tailwind; no shadcn/Radix. The goal is "clean and data-first", not "marketing splash".

**Tech Stack:** Next.js 15 App Router Server Components + Server Actions, Supabase SSR client, Tailwind, existing `hasPerm` + `getActorFromSession` helpers, existing audit trigger infra.

**Prerequisites:**

- Plans 1-6 complete. Tables referenced here (`users`, `players`, `match_days`, `matches`, `match_results`, `punishments` i.e. `disciplinary_actions`, `announcements`, `seasons`) exist with `deleted_at` columns and audit triggers attached.
- `getServerSupabase()` helper from Plan 1 available.
- `hasPerm` + Actor resolution from Plan 1 available.
- `perms.ts` already grants `trash.*` to admin per design spec §6.
- Seed data from Plan 0 includes at least 1 season, a few match days, a few fixtures, announcements, standings rows.

**Shippable at end of Plan 7:**

- Admin visits `/admin/trash` → sees tabs for each entity, each showing soft-deleted rows with Restore button.
- Admin clicks Restore → row `deleted_at` set back to NULL, audit event logged automatically, UI revalidates.
- Purge button present but disabled with hover tooltip "30-day purge deferred to Phase 1B".
- Non-admin visiting `/admin/trash` → 403 via existing middleware.
- Public `/` shows hero + next match day card + top-3 standings + latest 3 announcements, with graceful empty states if any data missing.
- Public `/standings`, `/fixtures`, `/players` have clean, presentable layouts.
- All public pages cache 60s (ISR).
- E2E: delete a player → disappears from /players → restore via /admin/trash → reappears.

---

## File Structure (delta over Plans 1-6)

Created by this plan:

```
apps/web/src/
├── app/
│   ├── admin/
│   │   └── trash/
│   │       ├── page.tsx                       # Server Component — tab shell + redirect to first tab
│   │       ├── layout.tsx                     # Trash tab nav
│   │       ├── [entity]/
│   │       │   ├── page.tsx                   # Per-entity table of soft-deleted rows
│   │       │   └── actions.ts                 # restoreEntity Server Action
│   │       └── _components/
│   │           ├── TrashTabs.tsx              # Tab link row (Server Component)
│   │           ├── RestoreButton.tsx          # <form> wrapper around Server Action
│   │           └── PurgeButtonStub.tsx        # Disabled button with tooltip
│   ├── (public)/
│   │   ├── page.tsx                           # REPLACED: new homepage
│   │   ├── standings/page.tsx                 # REPLACED/POLISHED
│   │   ├── fixtures/page.tsx                  # REPLACED/POLISHED
│   │   ├── players/page.tsx                   # REPLACED/POLISHED
│   │   └── _components/
│   │       ├── Hero.tsx
│   │       ├── UpcomingMatchDayCard.tsx
│   │       ├── TopOfTableMini.tsx
│   │       ├── LatestAnnouncements.tsx
│   │       ├── EmptyState.tsx
│   │       ├── StandingsTable.tsx
│   │       ├── FixtureList.tsx
│   │       └── PlayerGrid.tsx
├── server/
│   └── trash/
│       ├── entities.ts                        # TRASH_ENTITIES whitelist + column defs
│       ├── list.ts                            # listDeleted(entityType)
│       ├── list.test.ts
│       ├── restore.ts                         # restore(entityType, id, actorUserId)
│       └── restore.test.ts

apps/web/tests/e2e/
├── trash-restore.spec.ts                      # delete → hidden → restore → visible
└── public-homepage.spec.ts                    # homepage empty-state + populated render
```

Modified:

- `apps/web/src/perms.ts` — verify `trash.read` + `trash.restore` entries under admin. Add explicit keys if only `trash.*` glob exists (tests reference exact permission strings).

Note: the route group `(public)` does not appear in the URL — pages under `app/(public)/page.tsx` serve at `/`. This matches Plan 1's decision to use `app/admin/` physically for staff and `(public)` as a layout-only grouping for public pages.

---

# Part A — Admin Trash UI (Tasks 1-7)

## Task 1: Entity whitelist + column definitions

**Files:**
- Create: `apps/web/src/server/trash/entities.ts`

- [ ] **Step 1: Define the whitelist module**

This file is the single source of truth for which entity strings are valid. Every call into `listDeleted` / `restore` funnels through here. NEVER interpolate the incoming entityType into SQL — always map through this switch.

Contents:

```ts
/**
 * Whitelisted entity types the Trash UI can read/restore.
 * Key = URL slug + permission sub-resource.
 * Value.table = exact Postgres table name under public.
 *
 * IMPORTANT: entityType is user input from the URL. Only use it as a key into
 * this record. NEVER interpolate it into SQL. The table name comes from this
 * record and is a constant string literal.
 */
export const TRASH_ENTITIES = {
  users: {
    table: "users",
    label: "Users",
    columns: [
      { key: "email", label: "Email" },
      { key: "display_name", label: "Display name" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, email, display_name, deleted_at",
  },
  players: {
    table: "players",
    label: "Players",
    columns: [
      { key: "gamer_tag", label: "Gamer tag" },
      { key: "psn_id", label: "PSN" },
      { key: "jersey_number", label: "#" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, gamer_tag, psn_id, jersey_number, deleted_at",
  },
  match_days: {
    table: "match_days",
    label: "Match days",
    columns: [
      { key: "match_date", label: "Date" },
      { key: "venue_name", label: "Venue" },
      { key: "status", label: "Status" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, match_date, venue_name, status, deleted_at",
  },
  matches: {
    table: "matches",
    label: "Matches",
    columns: [
      { key: "scheduled_time", label: "Time" },
      { key: "home_player_id", label: "Home" },
      { key: "away_player_id", label: "Away" },
      { key: "status", label: "Status" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols:
      "id, scheduled_time, home_player_id, away_player_id, status, deleted_at",
  },
  match_results: {
    table: "match_results",
    label: "Results",
    columns: [
      { key: "match_id", label: "Match" },
      { key: "home_score", label: "H" },
      { key: "away_score", label: "A" },
      { key: "result_type", label: "Type" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols:
      "id, match_id, home_score, away_score, result_type, deleted_at",
  },
  punishments: {
    // Per design spec §3.5, punishments live in disciplinary_actions.
    table: "disciplinary_actions",
    label: "Punishments",
    columns: [
      { key: "sanction_type", label: "Type" },
      { key: "magnitude", label: "Magnitude" },
      { key: "effective_from", label: "From" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols:
      "id, sanction_type, magnitude, effective_from, deleted_at",
  },
  announcements: {
    table: "announcements",
    label: "Announcements",
    columns: [
      { key: "title", label: "Title" },
      { key: "priority", label: "Priority" },
      { key: "published_at", label: "Published" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, title, priority, published_at, deleted_at",
  },
  seasons: {
    table: "seasons",
    label: "Seasons",
    columns: [
      { key: "year_range", label: "Year" },
      { key: "status", label: "Status" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, year_range, status, deleted_at",
  },
} as const;

export type TrashEntityType = keyof typeof TRASH_ENTITIES;

export function isTrashEntityType(s: string): s is TrashEntityType {
  return Object.prototype.hasOwnProperty.call(TRASH_ENTITIES, s);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/server/trash/entities.ts
git commit -m "feat(trash): whitelist 8 entity types for soft-delete trash UI"
```

---

## Task 2: `listDeleted` — TDD

**Files:**
- Create: `apps/web/src/server/trash/list.ts`
- Create: `apps/web/src/server/trash/list.test.ts`

- [ ] **Step 1: Write failing test**

Contents of `list.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { listDeleted } from "./list";

function mkSb(rows: Array<Record<string, unknown>>) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        not: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: rows, error: null }),
        })),
      })),
      _capturedTable: table,
    })),
  };
}

describe("listDeleted", () => {
  it("throws on unknown entity type (guards against string interpolation)", async () => {
    const sb = mkSb([]);
    await expect(
      // @ts-expect-error — deliberately bad input
      listDeleted(sb as never, "users; drop table users;--")
    ).rejects.toThrow(/unknown entity/i);
  });

  it("queries the mapped table for a valid entity", async () => {
    const sb = mkSb([{ id: "p1", gamer_tag: "Keanu", deleted_at: "2026-04-26" }]);
    const rows = await listDeleted(sb as never, "players");
    expect(sb.from).toHaveBeenCalledWith("players");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gamer_tag: "Keanu" });
  });

  it("maps 'punishments' slug to disciplinary_actions table", async () => {
    const sb = mkSb([]);
    await listDeleted(sb as never, "punishments");
    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `list.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRASH_ENTITIES, isTrashEntityType, type TrashEntityType } from "./entities";

export async function listDeleted(
  sb: SupabaseClient,
  entityType: string
): Promise<Array<Record<string, unknown>>> {
  if (!isTrashEntityType(entityType)) {
    throw new Error(`unknown entity type: ${entityType}`);
  }
  const def = TRASH_ENTITIES[entityType as TrashEntityType];
  const { data, error } = await sb
    .from(def.table)
    .select(def.selectCols)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/trash/list.ts apps/web/src/server/trash/list.test.ts
git commit -m "feat(trash): listDeleted(entityType) with whitelist guard"
```

---

## Task 3: `restore` — TDD

**Files:**
- Create: `apps/web/src/server/trash/restore.ts`
- Create: `apps/web/src/server/trash/restore.test.ts`

- [ ] **Step 1: Write failing test**

Contents:

```ts
import { describe, it, expect, vi } from "vitest";
import { restore } from "./restore";

function mkSb() {
  const updateMock = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null, data: [{ id: "x" }] }),
  }));
  return {
    from: vi.fn(() => ({ update: updateMock })),
    updateMock,
  };
}

describe("restore", () => {
  it("throws on unknown entity type", async () => {
    const sb = mkSb();
    await expect(
      // @ts-expect-error
      restore(sb as never, "not_a_table", "id-1", "actor-1")
    ).rejects.toThrow(/unknown entity/i);
  });

  it("throws on empty id", async () => {
    const sb = mkSb();
    await expect(
      restore(sb as never, "players", "", "actor-1")
    ).rejects.toThrow(/id required/i);
  });

  it("updates mapped table setting deleted_at to null", async () => {
    const sb = mkSb();
    await restore(sb as never, "punishments", "pu-1", "actor-1");
    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
    expect(sb.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: null })
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `restore.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRASH_ENTITIES, isTrashEntityType, type TrashEntityType } from "./entities";

export async function restore(
  sb: SupabaseClient,
  entityType: string,
  id: string,
  _actorUserId: string
): Promise<void> {
  if (!isTrashEntityType(entityType)) {
    throw new Error(`unknown entity type: ${entityType}`);
  }
  if (!id || id.trim() === "") {
    throw new Error("id required");
  }
  const def = TRASH_ENTITIES[entityType as TrashEntityType];
  // The audit trigger captures actor via current_setting('app.current_user_id').
  // That setting is established by the server action caller (see Task 5).
  const { error } = await sb
    .from(def.table)
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/trash/restore.ts apps/web/src/server/trash/restore.test.ts
git commit -m "feat(trash): restore(entityType, id) with whitelist + empty-id guard"
```

---

## Task 4: Trash layout + tab nav

**Files:**
- Create: `apps/web/src/app/admin/trash/layout.tsx`
- Create: `apps/web/src/app/admin/trash/page.tsx`
- Create: `apps/web/src/app/admin/trash/_components/TrashTabs.tsx`

- [ ] **Step 1: Write `TrashTabs.tsx`**

Contents:

```tsx
import Link from "next/link";
import { TRASH_ENTITIES } from "@/server/trash/entities";

export function TrashTabs({ active }: { active?: string }) {
  return (
    <nav className="flex gap-1 border-b overflow-x-auto text-sm">
      {Object.entries(TRASH_ENTITIES).map(([key, def]) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={`/admin/trash/${key}`}
            className={
              "px-3 py-2 border-b-2 whitespace-nowrap " +
              (isActive
                ? "border-black font-semibold"
                : "border-transparent text-gray-600 hover:text-black")
            }
          >
            {def.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write `layout.tsx`**

Contents:

```tsx
import { ReactNode } from "react";

export default function TrashLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-bold">Trash</h2>
        <p className="text-gray-600 text-sm">
          Soft-deleted rows across the system. Restore to revert. Purge hardens
          after 30 days (deferred to Phase 1B).
        </p>
      </header>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Write `/admin/trash/page.tsx` (index redirects to first tab)**

Contents:

```tsx
import { redirect } from "next/navigation";

export default function TrashIndex() {
  redirect("/admin/trash/users");
}
```

- [ ] **Step 4: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/admin/trash
git commit -m "feat(admin): trash layout + tab nav shell"
```

---

## Task 5: Per-entity Trash page + Restore Server Action

**Files:**
- Create: `apps/web/src/app/admin/trash/[entity]/page.tsx`
- Create: `apps/web/src/app/admin/trash/[entity]/actions.ts`
- Create: `apps/web/src/app/admin/trash/_components/RestoreButton.tsx`
- Create: `apps/web/src/app/admin/trash/_components/PurgeButtonStub.tsx`

- [ ] **Step 1: Write `actions.ts`**

Contents:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActorFromSession } from "@/server/auth/actor";
import { hasPerm } from "@/perms";
import { restore } from "@/server/trash/restore";
import { isTrashEntityType } from "@/server/trash/entities";

export async function restoreEntity(formData: FormData) {
  const entityType = String(formData.get("entityType") ?? "");
  const id = String(formData.get("id") ?? "");

  if (!isTrashEntityType(entityType)) notFound();
  if (!id) throw new Error("id required");

  const sb = await getServerSupabase();
  const actor = await getActorFromSession(sb);
  if (!actor || !hasPerm(actor, "trash.restore")) {
    throw new Error("forbidden");
  }

  await restore(sb, entityType, id, actor.userId ?? "system");
  revalidatePath(`/admin/trash/${entityType}`);
  // Also revalidate likely public pages that may now re-include the row.
  revalidatePath("/");
  revalidatePath("/players");
  revalidatePath("/standings");
  revalidatePath("/fixtures");
}
```

- [ ] **Step 2: Write `RestoreButton.tsx`**

Contents:

```tsx
import { restoreEntity } from "../[entity]/actions";

export function RestoreButton({
  entityType,
  id,
}: {
  entityType: string;
  id: string;
}) {
  return (
    <form action={restoreEntity}>
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="id" value={id} />
      <button className="text-blue-600 underline text-sm" type="submit">
        Restore
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write `PurgeButtonStub.tsx`**

Contents:

```tsx
export function PurgeButtonStub() {
  return (
    <button
      type="button"
      disabled
      title="30-day purge deferred to Phase 1B"
      className="text-gray-400 text-sm cursor-not-allowed"
    >
      Purge
    </button>
  );
}
```

- [ ] **Step 4: Write per-entity `page.tsx`**

Contents of `apps/web/src/app/admin/trash/[entity]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActorFromSession } from "@/server/auth/actor";
import { hasPerm } from "@/perms";
import { listDeleted } from "@/server/trash/list";
import { TRASH_ENTITIES, isTrashEntityType } from "@/server/trash/entities";
import { TrashTabs } from "../_components/TrashTabs";
import { RestoreButton } from "../_components/RestoreButton";
import { PurgeButtonStub } from "../_components/PurgeButtonStub";
import { formatWat } from "@/lib/time";

export default async function TrashEntityPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;
  if (!isTrashEntityType(entity)) notFound();

  const sb = await getServerSupabase();
  const actor = await getActorFromSession(sb);
  if (!actor || !hasPerm(actor, "trash.read")) {
    return <p className="text-red-600">Forbidden.</p>;
  }

  const def = TRASH_ENTITIES[entity];
  const rows = await listDeleted(sb, entity);

  return (
    <div className="space-y-4">
      <TrashTabs active={entity} />
      {rows.length === 0 ? (
        <p className="text-gray-500 text-sm py-6">
          Nothing deleted in <b>{def.label}</b>.
        </p>
      ) : (
        <table className="w-full text-sm border" data-testid="trash-table">
          <thead className="bg-slate-100">
            <tr>
              {def.columns.map((c) => (
                <th key={c.key} className="text-left p-2">
                  {c.label}
                </th>
              ))}
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.id)} className="border-t">
                {def.columns.map((c) => (
                  <td key={c.key} className="p-2">
                    {c.key === "deleted_at" && row[c.key]
                      ? formatWat(String(row[c.key]), "yyyy-MM-dd HH:mm")
                      : String(row[c.key] ?? "—")}
                  </td>
                ))}
                <td className="p-2 flex gap-3">
                  <RestoreButton entityType={entity} id={String(row.id)} />
                  <PurgeButtonStub />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles; 8 new dynamic routes registered under `/admin/trash/[entity]`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/trash
git commit -m "feat(admin): per-entity trash table + Restore action + Purge stub"
```

---

## Task 6: Permission check wiring verification

**Files:**
- Modify (verify only): `apps/web/src/perms.ts`

- [ ] **Step 1: Verify `perms.ts` grants admin `trash.read` + `trash.restore`**

The design spec §6 grants admin `'trash.*'`. Confirm `hasPerm` glob-matches `'trash.read'` and `'trash.restore'` against `'trash.*'`. If not, add explicit entries.

```bash
grep -n "trash" apps/web/src/perms.ts
```

Expected: `'trash.*'` under `admin`. If the `hasPerm` implementation requires exact-match (glob not supported), add explicit:

```ts
admin: [
  // existing entries …
  'trash.read', 'trash.restore',
]
```

- [ ] **Step 2: Add unit test pin for the two perms**

Open `apps/web/src/perms.test.ts` and add two assertions at the bottom of the admin block:

```ts
expect(hasPerm({ userId: null, roles: ["admin"] }, "trash.read")).toBe(true);
expect(hasPerm({ userId: null, roles: ["admin"] }, "trash.restore")).toBe(true);
expect(hasPerm({ userId: null, roles: ["moderator"] }, "trash.restore")).toBe(false);
```

- [ ] **Step 3: Run tests**

```bash
npm --workspace apps/web run test
```

Expected: all previous tests still green, +3 new assertions pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/perms.ts apps/web/src/perms.test.ts
git commit -m "test(perms): pin trash.read + trash.restore admin-only"
```

---

## Task 7: E2E — delete, hide, restore, reappear

**Files:**
- Create: `apps/web/tests/e2e/trash-restore.spec.ts`

- [ ] **Step 1: Write E2E**

Contents:

```ts
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

async function login(page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test("admin soft-deletes player → gone from /players → restore from trash → visible again", async ({ page }) => {
  await login(page);

  // Pick a known seeded player (assume first visible card on /admin/players).
  await page.goto("/admin/players");
  const firstPlayerRow = page.getByTestId("player-row").first();
  const tag = await firstPlayerRow.getAttribute("data-gamer-tag");
  expect(tag).toBeTruthy();
  await firstPlayerRow.getByRole("button", { name: /delete/i }).click();
  await page.getByRole("button", { name: /confirm/i }).click();

  // Public page no longer shows the player (ISR cache bust via revalidatePath in delete action)
  await page.goto("/players");
  await expect(page.getByText(tag!, { exact: false })).toHaveCount(0);

  // Trash contains the row — restore it.
  await page.goto("/admin/trash/players");
  const trashRow = page.getByRole("row", { name: new RegExp(tag!) });
  await expect(trashRow).toBeVisible();
  await trashRow.getByRole("button", { name: /restore/i }).click();

  // After restore, the row disappears from the Trash list.
  await expect(page.getByRole("row", { name: new RegExp(tag!) })).toHaveCount(0);

  // Player reappears on the public page.
  await page.goto("/players");
  await expect(page.getByText(tag!, { exact: false })).toBeVisible();
});

test("non-admin is blocked from /admin/trash (middleware 403 or redirect)", async ({ page, context }) => {
  await context.clearCookies();
  const res = await page.goto("/admin/trash/users");
  // Either a redirect to /login or a 403.
  expect(res?.status() === 403 || page.url().includes("/login")).toBeTruthy();
});
```

Note: the first test assumes Plan 3 (Players CRUD) wired a delete button + a `data-gamer-tag` attribute on `player-row`. If that plan's markup differs, adapt selectors in this spec before landing.

- [ ] **Step 2: Run E2E**

```bash
npm --workspace apps/web run e2e -- --grep "trash"
```

Expected: both tests green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/trash-restore.spec.ts
git commit -m "test(e2e): trash soft-delete → restore roundtrip on players"
```

---

# Part B — Public Homepage + Pages Polish (Tasks 8-13)

## Task 8: Homepage data accessors (reuse or thin-wrap)

**Files:**
- Create: `apps/web/src/server/homepage/data.ts`
- Create: `apps/web/src/server/homepage/data.test.ts`

The homepage reads from 4 places: current season, next match day, top standings, latest announcements. Most accessors exist from earlier plans; this module is a thin, cached orchestrator returning one combined shape.

- [ ] **Step 1: Write tests for the orchestrator**

Contents of `data.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getHomepageData } from "./data";

function mkSb(overrides: {
  season?: unknown;
  nextMatchDay?: unknown;
  fixtureCount?: number;
  standings?: unknown[];
  announcements?: unknown[];
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "seasons") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: overrides.season ?? null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "match_days") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                gte: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: overrides.nextMatchDay ?? null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "matches") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                // count mode
                then: undefined,
                count: overrides.fixtureCount ?? 0,
              }),
            }),
          }),
        };
      }
      if (table === "standings") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  order: () => ({
                    order: () => ({
                      limit: async () => ({ data: overrides.standings ?? [] }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "announcements") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  not: () => ({
                    order: () => ({
                      limit: async () => ({ data: overrides.announcements ?? [] }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("getHomepageData", () => {
  it("returns a fully-shaped object with empty arrays when no data", async () => {
    const sb = mkSb({});
    const data = await getHomepageData(sb as never);
    expect(data.season).toBeNull();
    expect(data.nextMatchDay).toBeNull();
    expect(data.topStandings).toEqual([]);
    expect(data.latestAnnouncements).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement `data.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type HomepageData = {
  season: { id: string; year_range: string; status: string } | null;
  nextMatchDay: {
    id: string;
    match_date: string;
    arrival_cutoff_time: string;
    venue_name: string | null;
    fixtureCount: number;
  } | null;
  topStandings: Array<{
    player_id: string;
    display_name: string;
    gamer_tag: string;
    points: number;
    goal_difference: number;
  }>;
  latestAnnouncements: Array<{
    id: string;
    title: string;
    priority: string;
    published_at: string;
  }>;
};

export async function getHomepageData(sb: SupabaseClient): Promise<HomepageData> {
  // Season: currently active (status='active') soft-delete filtered, most recent.
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range, status")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Next match day: earliest scheduled match_day from today forward.
  const today = new Date().toISOString().slice(0, 10);
  const { data: md } = await sb
    .from("match_days")
    .select("id, match_date, arrival_cutoff_time, venue_name")
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .gte("match_date", today)
    .order("match_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  let nextMatchDay: HomepageData["nextMatchDay"] = null;
  if (md) {
    const { count } = await sb
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("match_day_id", md.id)
      .is("deleted_at", null);
    nextMatchDay = { ...md, fixtureCount: count ?? 0 };
  }

  // Top of table — rely on standings view including a joined player display name.
  // If Plan 4 doesn't expose that join, adjust to two queries.
  const { data: topStandings } = season
    ? await sb
        .from("standings_public") // see note: if view missing, swap to standings + join
        .select("player_id, display_name, gamer_tag, points, goal_difference")
        .eq("season_id", season.id)
        .is("deleted_at", null)
        .order("points", { ascending: false })
        .order("goal_difference", { ascending: false })
        .order("goals_for", { ascending: false })
        .limit(3)
    : { data: [] };

  // Latest public announcements.
  const { data: announcements } = await sb
    .from("announcements")
    .select("id, title, priority, published_at")
    .eq("is_public", true)
    .is("deleted_at", null)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(3);

  return {
    season: season ?? null,
    nextMatchDay,
    topStandings: (topStandings ?? []) as HomepageData["topStandings"],
    latestAnnouncements: (announcements ?? []) as HomepageData["latestAnnouncements"],
  };
}
```

Note on `standings_public`: if Plan 4 did not ship a view, replace with a two-query fetch (standings rows + players lookup by id) or a Postgres JOIN via Supabase's embedded select syntax: `.select("player_id, points, goal_difference, players!inner(display_name, gamer_tag)")`. Pick whichever matches Plan 4's actual schema at implementation time.

- [ ] **Step 3: Run tests**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/server/homepage
git commit -m "feat(homepage): getHomepageData orchestrator with empty-state defaults"
```

---

## Task 9: Hero + homepage components

**Files:**
- Create: `apps/web/src/app/(public)/_components/Hero.tsx`
- Create: `apps/web/src/app/(public)/_components/UpcomingMatchDayCard.tsx`
- Create: `apps/web/src/app/(public)/_components/TopOfTableMini.tsx`
- Create: `apps/web/src/app/(public)/_components/LatestAnnouncements.tsx`
- Create: `apps/web/src/app/(public)/_components/EmptyState.tsx`

All Server Components, no "use client".

- [ ] **Step 1: `EmptyState.tsx`**

```tsx
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="border border-dashed rounded-md p-6 text-center text-gray-500 text-sm">
      {message}
    </div>
  );
}
```

- [ ] **Step 2: `Hero.tsx`**

```tsx
export function Hero({ seasonYearRange }: { seasonYearRange: string | null }) {
  return (
    <section className="py-10 border-b">
      <h1 className="text-4xl font-black tracking-tight">CADE League</h1>
      <p className="mt-2 text-lg text-gray-600">
        {seasonYearRange ? (
          <>
            Division 1 Elite · <span className="font-semibold">{seasonYearRange}</span>
          </>
        ) : (
          <>Season TBD</>
        )}
      </p>
    </section>
  );
}
```

- [ ] **Step 3: `UpcomingMatchDayCard.tsx`**

```tsx
import { formatWat } from "@/lib/time";
import { EmptyState } from "./EmptyState";

type Props = {
  matchDay: {
    match_date: string;
    arrival_cutoff_time: string;
    venue_name: string | null;
    fixtureCount: number;
  } | null;
};

export function UpcomingMatchDayCard({ matchDay }: Props) {
  if (!matchDay) return <EmptyState message="No upcoming match day scheduled." />;
  return (
    <div className="border rounded-md p-5 bg-white">
      <div className="text-xs uppercase tracking-wide text-gray-500">Next match day</div>
      <div className="mt-1 text-2xl font-bold">
        {formatWat(matchDay.match_date, "EEE, dd MMM")}
      </div>
      <dl className="mt-3 grid grid-cols-3 text-sm gap-2">
        <div>
          <dt className="text-gray-500">Arrival by</dt>
          <dd className="font-medium">{matchDay.arrival_cutoff_time}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Venue</dt>
          <dd className="font-medium">{matchDay.venue_name ?? "TBD"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Fixtures</dt>
          <dd className="font-medium">{matchDay.fixtureCount}</dd>
        </div>
      </dl>
    </div>
  );
}
```

- [ ] **Step 4: `TopOfTableMini.tsx`**

```tsx
import Link from "next/link";
import { EmptyState } from "./EmptyState";

type Row = {
  player_id: string;
  display_name: string;
  gamer_tag: string;
  points: number;
  goal_difference: number;
};

export function TopOfTableMini({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return <EmptyState message="Standings will appear after the first match day." />;
  return (
    <div className="border rounded-md bg-white">
      <div className="flex justify-between items-center p-4 border-b">
        <h3 className="font-bold">Top of the table</h3>
        <Link href="/standings" className="text-sm text-blue-600 underline">
          Full standings →
        </Link>
      </div>
      <ol className="divide-y">
        {rows.map((r, i) => (
          <li key={r.player_id} className="flex items-center justify-between p-3">
            <span className="flex items-center gap-3">
              <span className="w-6 font-bold">{i + 1}</span>
              <span className="font-medium">{r.gamer_tag}</span>
              <span className="text-gray-500 text-sm">({r.display_name})</span>
            </span>
            <span className="text-sm tabular-nums">
              {r.points} pts · GD {r.goal_difference >= 0 ? "+" : ""}{r.goal_difference}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 5: `LatestAnnouncements.tsx`**

```tsx
import Link from "next/link";
import { formatWat } from "@/lib/time";
import { EmptyState } from "./EmptyState";

type A = { id: string; title: string; priority: string; published_at: string };

export function LatestAnnouncements({ items }: { items: A[] }) {
  if (items.length === 0) return <EmptyState message="No announcements yet." />;
  return (
    <div className="border rounded-md bg-white">
      <div className="flex justify-between items-center p-4 border-b">
        <h3 className="font-bold">Latest announcements</h3>
        <Link href="/announcements" className="text-sm text-blue-600 underline">
          All →
        </Link>
      </div>
      <ul className="divide-y">
        {items.map((a) => (
          <li key={a.id} className="p-3 flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-gray-500">
                {formatWat(a.published_at, "dd MMM yyyy · HH:mm")}
              </div>
            </div>
            {a.priority !== "info" ? (
              <span className="text-xs uppercase rounded px-2 py-0.5 bg-amber-100 text-amber-800">
                {a.priority}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/(public)/_components
git commit -m "feat(public): homepage components (hero, match-day card, mini standings, announcements)"
```

---

## Task 10: New public homepage `/`

**Files:**
- Modify: `apps/web/src/app/(public)/page.tsx` (replace existing scaffold)

- [ ] **Step 1: Replace the page**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { getHomepageData } from "@/server/homepage/data";
import { Hero } from "./_components/Hero";
import { UpcomingMatchDayCard } from "./_components/UpcomingMatchDayCard";
import { TopOfTableMini } from "./_components/TopOfTableMini";
import { LatestAnnouncements } from "./_components/LatestAnnouncements";

export const revalidate = 60;

export default async function HomePage() {
  const sb = await getServerSupabase();
  const data = await getHomepageData(sb);

  return (
    <div className="max-w-5xl mx-auto px-6 pb-16">
      <Hero seasonYearRange={data.season?.year_range ?? null} />
      <div className="grid md:grid-cols-2 gap-6 mt-8" data-testid="home-grid">
        <UpcomingMatchDayCard matchDay={data.nextMatchDay} />
        <TopOfTableMini rows={data.topStandings} />
        <div className="md:col-span-2">
          <LatestAnnouncements items={data.latestAnnouncements} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm --workspace apps/web run build
```

Expected: compiles. The log shows `/` as ISR with 60s revalidation.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(public)/page.tsx
git commit -m "feat(public): real homepage with season, next match day, top3, announcements"
```

---

## Task 11: `/standings` clean layout

**Files:**
- Modify: `apps/web/src/app/(public)/standings/page.tsx`
- Create: `apps/web/src/app/(public)/_components/StandingsTable.tsx`

- [ ] **Step 1: `StandingsTable.tsx`**

```tsx
type Row = {
  rank: number;
  player_id: string;
  gamer_tag: string;
  display_name: string;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  punishment_points_deducted: number;
};

export function StandingsTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return <p className="text-gray-500 text-sm">No results yet this season.</p>;
  }
  return (
    <table className="w-full text-sm border" data-testid="standings-table">
      <thead className="bg-slate-100">
        <tr>
          <th className="text-left p-2">#</th>
          <th className="text-left p-2">Player</th>
          <th className="p-2">P</th>
          <th className="p-2">W</th>
          <th className="p-2">D</th>
          <th className="p-2">L</th>
          <th className="p-2">GF</th>
          <th className="p-2">GA</th>
          <th className="p-2">GD</th>
          <th className="p-2">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.player_id} className="border-t">
            <td className="p-2 font-bold">{r.rank}</td>
            <td className="p-2">
              <div className="font-medium">{r.gamer_tag}</div>
              <div className="text-xs text-gray-500">{r.display_name}</div>
            </td>
            <td className="p-2 text-center tabular-nums">{r.matches_played}</td>
            <td className="p-2 text-center tabular-nums">{r.wins}</td>
            <td className="p-2 text-center tabular-nums">{r.draws}</td>
            <td className="p-2 text-center tabular-nums">{r.losses}</td>
            <td className="p-2 text-center tabular-nums">{r.goals_for}</td>
            <td className="p-2 text-center tabular-nums">{r.goals_against}</td>
            <td className="p-2 text-center tabular-nums">
              {r.goal_difference >= 0 ? "+" : ""}{r.goal_difference}
            </td>
            <td className="p-2 text-center tabular-nums font-bold">
              {r.points}
              {r.punishment_points_deducted > 0 ? (
                <span className="ml-1 text-xs text-red-600" title="Punishment deductions">
                  (−{r.punishment_points_deducted})
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Replace `standings/page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { StandingsTable } from "../_components/StandingsTable";

export const revalidate = 60;

export default async function StandingsPage() {
  const sb = await getServerSupabase();

  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const rows = season
    ? (await sb
        .from("standings")
        .select(
          "player_id, matches_played, wins, draws, losses, goals_for, goals_against, goal_difference, points, punishment_points_deducted, players!inner(gamer_tag, users(display_name))"
        )
        .eq("season_id", season.id)
        .is("deleted_at", null)
        .order("points", { ascending: false })
        .order("goal_difference", { ascending: false })
        .order("goals_for", { ascending: false })).data ?? []
    : [];

  const ranked = rows.map((r: any, i: number) => ({
    rank: i + 1,
    player_id: r.player_id,
    gamer_tag: r.players?.gamer_tag ?? "—",
    display_name: r.players?.users?.display_name ?? "",
    matches_played: r.matches_played,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    goals_for: r.goals_for,
    goals_against: r.goals_against,
    goal_difference: r.goal_difference,
    points: r.points,
    punishment_points_deducted: r.punishment_points_deducted ?? 0,
  }));

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-4">
      <header>
        <h1 className="text-3xl font-bold">Standings</h1>
        <p className="text-gray-600 text-sm">
          {season?.year_range ?? "No active season"} · Ordered by points, then goal difference, then goals for.
        </p>
      </header>
      <StandingsTable rows={ranked} />
    </div>
  );
}
```

Note on the nested select: if Plan 4's Supabase query syntax differs, swap to whatever shape Plan 4 already uses. Goal here is column layout + tiebreaker order, not a new query pattern.

- [ ] **Step 3: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/(public)/standings apps/web/src/app/(public)/_components/StandingsTable.tsx
git commit -m "feat(public): standings table with tiebreaker ordering + punishment badge"
```

---

## Task 12: `/fixtures` grouped by match day

**Files:**
- Modify: `apps/web/src/app/(public)/fixtures/page.tsx`
- Create: `apps/web/src/app/(public)/_components/FixtureList.tsx`

- [ ] **Step 1: `FixtureList.tsx`**

```tsx
import { formatWat } from "@/lib/time";

type Fixture = {
  id: string;
  scheduled_time: string | null;
  home_tag: string;
  away_tag: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
};

type Group = {
  match_day_id: string;
  match_date: string;
  venue_name: string | null;
  fixtures: Fixture[];
};

export function FixtureList({ groups }: { groups: Group[] }) {
  if (groups.length === 0) {
    return <p className="text-gray-500 text-sm">No fixtures scheduled.</p>;
  }
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.match_day_id}>
          <header className="border-b pb-2 mb-3">
            <h2 className="text-lg font-bold">
              {formatWat(g.match_date, "EEE, dd MMM yyyy")}
            </h2>
            {g.venue_name ? (
              <p className="text-sm text-gray-500">{g.venue_name}</p>
            ) : null}
          </header>
          <ul className="divide-y border rounded-md bg-white">
            {g.fixtures.map((f) => (
              <li key={f.id} className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="font-medium">{f.home_tag}</span>
                  <span className="text-gray-400">vs</span>
                  <span className="font-medium">{f.away_tag}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {f.home_score !== null && f.away_score !== null ? (
                    <span className="tabular-nums font-bold">
                      {f.home_score} – {f.away_score}
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      {f.scheduled_time ?? "TBD"}
                    </span>
                  )}
                  <span className="text-xs uppercase rounded px-2 py-0.5 bg-slate-100">
                    {f.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Replace `fixtures/page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { FixtureList } from "../_components/FixtureList";

export const revalidate = 60;

export default async function FixturesPage() {
  const sb = await getServerSupabase();

  const { data: matchDays } = await sb
    .from("match_days")
    .select(
      `id, match_date, venue_name,
       matches!inner(
         id, scheduled_time, status, home_player_id, away_player_id,
         home:home_player_id(gamer_tag),
         away:away_player_id(gamer_tag),
         match_results(home_score, away_score)
       )`
    )
    .is("deleted_at", null)
    .order("match_date", { ascending: true });

  const groups = (matchDays ?? []).map((md: any) => ({
    match_day_id: md.id,
    match_date: md.match_date,
    venue_name: md.venue_name,
    fixtures: (md.matches ?? []).map((m: any) => ({
      id: m.id,
      scheduled_time: m.scheduled_time,
      home_tag: m.home?.gamer_tag ?? "?",
      away_tag: m.away?.gamer_tag ?? "?",
      status: m.status,
      home_score: m.match_results?.[0]?.home_score ?? null,
      away_score: m.match_results?.[0]?.away_score ?? null,
    })),
  }));

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Fixtures</h1>
        <p className="text-gray-600 text-sm">All match days this season.</p>
      </header>
      <FixtureList groups={groups} />
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/(public)/fixtures apps/web/src/app/(public)/_components/FixtureList.tsx
git commit -m "feat(public): fixtures page grouped by match day with result + status badge"
```

---

## Task 13: `/players` grid with placeholder avatars

**Files:**
- Modify: `apps/web/src/app/(public)/players/page.tsx`
- Create: `apps/web/src/app/(public)/_components/PlayerGrid.tsx`

- [ ] **Step 1: `PlayerGrid.tsx`**

```tsx
import Link from "next/link";

type Player = {
  id: string;
  gamer_tag: string;
  display_name: string;
  jersey_number: number | null;
  photo_url: string | null;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export function PlayerGrid({ players }: { players: Player[] }) {
  if (players.length === 0) {
    return <p className="text-gray-500 text-sm">No players registered.</p>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {players.map((p) => (
        <Link
          key={p.id}
          href={`/players/${p.id}`}
          className="border rounded-md p-4 bg-white hover:shadow transition"
          data-testid="player-card"
          data-gamer-tag={p.gamer_tag}
        >
          <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold mx-auto">
            {p.photo_url ? (
              // Next/Image omitted to keep avatars tiny + avoid remote loader config in Phase 1A.
              <img
                src={p.photo_url}
                alt=""
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              initials(p.display_name || p.gamer_tag)
            )}
          </div>
          <div className="text-center mt-3">
            <div className="font-bold">{p.gamer_tag}</div>
            <div className="text-xs text-gray-500">
              {p.display_name}
              {p.jersey_number ? ` · #${p.jersey_number}` : ""}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Replace `players/page.tsx`**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { PlayerGrid } from "../_components/PlayerGrid";

export const revalidate = 60;

export default async function PlayersPage() {
  const sb = await getServerSupabase();

  const { data } = await sb
    .from("players")
    .select("id, gamer_tag, jersey_number, photo_url, users(display_name)")
    .is("deleted_at", null)
    .order("jersey_number", { ascending: true, nullsFirst: false });

  const players = (data ?? []).map((p: any) => ({
    id: p.id,
    gamer_tag: p.gamer_tag,
    display_name: p.users?.display_name ?? "",
    jersey_number: p.jersey_number,
    photo_url: p.photo_url,
  }));

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Players</h1>
        <p className="text-gray-600 text-sm">{players.length} registered</p>
      </header>
      <PlayerGrid players={players} />
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/(public)/players apps/web/src/app/(public)/_components/PlayerGrid.tsx
git commit -m "feat(public): players grid with initials avatars + jersey ordering"
```

---

## Task 14: E2E — public homepage render (populated + empty fallback)

**Files:**
- Create: `apps/web/tests/e2e/public-homepage.spec.ts`

- [ ] **Step 1: Write E2E**

Contents:

```ts
import { test, expect } from "@playwright/test";

test("homepage renders all four sections with seeded data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CADE League" })).toBeVisible();
  await expect(page.getByTestId("home-grid")).toBeVisible();
  // Each section exists (either with data or empty-state message).
  await expect(page.getByText(/Next match day|No upcoming match day/)).toBeVisible();
  await expect(page.getByText(/Top of the table|Standings will appear/)).toBeVisible();
  await expect(page.getByText(/Latest announcements|No announcements yet/)).toBeVisible();
});

test("standings page renders table or empty state", async ({ page }) => {
  await page.goto("/standings");
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
});

test("fixtures page renders", async ({ page }) => {
  await page.goto("/fixtures");
  await expect(page.getByRole("heading", { name: "Fixtures" })).toBeVisible();
});

test("players page renders with at least one card when seeded", async ({ page }) => {
  await page.goto("/players");
  await expect(page.getByRole("heading", { name: "Players" })).toBeVisible();
  // With Plan 0 seed (13 players), at least 1 card is visible.
  await expect(page.getByTestId("player-card").first()).toBeVisible();
});
```

- [ ] **Step 2: Run E2E**

```bash
npm --workspace apps/web run e2e -- --grep "homepage|standings page|fixtures page|players page"
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/public-homepage.spec.ts
git commit -m "test(e2e): public homepage + standings + fixtures + players smoke"
```

---

## Task 15: Final verification

- [ ] **Step 1: Unit tests**

```bash
npm --workspace apps/web run test
```

Expected: all prior tests + `listDeleted` (3) + `restore` (3) + `getHomepageData` (1) + 3 new perms pins = all green.

- [ ] **Step 2: Lint + build**

```bash
npm run lint && npm run build
```

Expected: both clean. Log should show every page under `app/(public)/*` with `Revalidate: 60` and every page under `app/admin/trash/*` as dynamic.

- [ ] **Step 3: E2E full**

```bash
npm --workspace apps/web run e2e
```

Expected: all prior tests + 2 trash + 4 public = all green.

- [ ] **Step 4: Manual smoke — Trash audit trail**

Soft-delete a player via `/admin/players`, restore via `/admin/trash/players`, then:

```bash
npx --yes supabase db query "select action, entity_type, before_json->>'deleted_at' as was_deleted, after_json->>'deleted_at' as now_deleted from public.audit_events where entity_type='players' order by created_at desc limit 4" --linked --output table
```

Expected: two rows — one with `was_deleted=null, now_deleted=<ts>` (delete) and one with `was_deleted=<ts>, now_deleted=null` (restore).

- [ ] **Step 5: Update `tasks/todo.md`**

Append:

```markdown
## Done
- Plan 7 — Trash UI + Public Homepage Polish complete (2026-04-XX). All 15 tasks green.
  - /admin/trash with 8 entity tabs, Restore working, Purge stubbed disabled
  - restore() whitelist guard + tests
  - New homepage with hero + next match day + top3 + announcements
  - /standings, /fixtures, /players polished
  - ISR 60s on all public pages
  - E2E: trash roundtrip + public homepage smoke
```

- [ ] **Step 6: Commit verification**

```bash
git add tasks/todo.md
git commit -m "docs(tasks): Plan 7 complete"
```

---

## Out of Scope for Plan 7

- **Hard-delete / purge logic.** Purge button is a disabled stub. Phase 1B will add a cron job + UI confirmation modal for rows older than 30 days past `deleted_at`.
- **Bulk restore.** Phase 1A restores one row at a time. A multi-select checkbox + bulk-restore toolbar can come later if admin workflow demands it.
- **Trash search / filter.** Lists are capped at "whatever was deleted" — in practice <100 rows in Phase 1A. Search UI deferred.
- **Player profile page polish (`/players/[id]`).** Already exists from Plan 3; this plan doesn't touch it. If the current profile layout is also stale, open a follow-up plan.
- **Announcements index page (`/announcements`).** The homepage links to it; assume Plan 5 already ships a functional version. If not, this plan doesn't fix it.
- **Client interactivity on public pages.** No filters, no live updates. ISR 60s is the interactivity.
- **SEO metadata** (OpenGraph tags, sitemap, robots.txt) — deferred to a dedicated "public launch prep" plan.
- **Dark mode / theming.** Tailwind base with default light scheme only.

---

## Review / Acceptance Criteria

Plan 7 is done when:

1. `git log --oneline` shows ~15 commits (one per task).
2. `npm run test` green including 3 `listDeleted`, 3 `restore`, 1 `getHomepageData`, 3 perms pins new.
3. `npm run e2e` green including 2 trash + 4 public new.
4. Visiting `/admin/trash` as admin shows all 8 entity tabs and a Restore button per soft-deleted row. Purge button present but disabled with tooltip "30-day purge deferred to Phase 1B".
5. Attempt to visit `/admin/trash` unauthenticated redirects to `/login` or returns 403.
6. Soft-deleting a player via admin UI removes it from `/players`. Restoring from `/admin/trash/players` reinstates it. `audit_events` captures both transitions.
7. Visiting `/` shows a hero with season year, a next match day card (or empty state), top-3 standings (or empty state), and up-to-3 latest public announcements (or empty state).
8. Each public page has `export const revalidate = 60` and `npm run build` log confirms ISR.
9. All public-page queries filter `deleted_at IS NULL` (grep confirms no public page query omits the filter).
10. No `"use client"` directive appears in any public page or component added by this plan.
