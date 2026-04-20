# Plan 6 — Announcements + Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship in-app + email announcements with role-based audience targeting, per-user delivery tracking, and scheduled publish. Admins compose once, pick audience (all/role/users/players-in-season), choose channels (in_app, email), and either publish now or schedule for later. A cron endpoint promotes scheduled drafts at their publish time. Authenticated users see a bell with unread count; the public sees `is_public=true` announcements on `/announcements`.

**Architecture:** `announcements` is the canonical source; `notifications` is the per-user delivery ledger (one row per recipient, tracks delivered channels + read state). A server module under `apps/web/src/server/announcements/` owns lifecycle: draft creation, audience expansion, bulk notification insert, email fan-out via the existing `sendEmail` helper from Plan 1. Scheduled publish runs via a protected `/api/cron/publish-announcements` route that polls for due drafts and invokes the same `publishNow` path. Markdown is rendered with `marked` and sanitized with `DOMPurify` for both in-app HTML and email HTML.

**Tech Stack:** Supabase (Postgres + service role server-side), Next.js 15 Server Actions + Route Handlers, `marked` (markdown → HTML), `isomorphic-dompurify` (sanitize), Resend via `sendEmail` helper at `apps/web/src/lib/email/resend.ts` (Plan 1), audit trigger infrastructure from Plan 0, `hasPerm` + `getActorFromSession` from Plan 1.

**Prerequisites:**
- Plan 0 complete (`audit_row_change()` + `attach_audit` helpers available).
- Plan 1 complete (`users`, `user_roles`, `sendEmail` helper, `getActorFromSession`, middleware gating `/admin/*`).
- Players/seasons schema available for `audience_type='players_in_season'` expansion (from the plan introducing `players` + `season_participants` — assumed merged before this plan starts; if not, the `players_in_season` branch is gated behind a feature check that returns an empty set and logs a warning).
- `CRON_SECRET` env var populated in `.env.local` and in Vercel project env.
- `RESEND_API_KEY` optional — when absent, `sendEmail` logs to stdout (`[email:stub]`) and returns `true`, which is what the E2E test relies on.

**Shippable at end of Plan 6:**
- Admin can open `/admin/announcements/new`, compose an announcement, pick an audience, check `email` + `in_app`, toggle `is_public`, and click "Publish Now" — recipients get notifications rows and (if `email` channel) a stub-logged or real email.
- Admin can alternatively click "Schedule" with a future `scheduled_publish_at`; the draft stays unpublished until the cron endpoint fires.
- `GET /api/cron/publish-announcements` with the `X-Cron-Secret` header promotes overdue drafts; without the header it returns 403.
- Admin layout shows a bell with unread count pulled server-side.
- `/announcements` (public) lists published + `is_public=true` announcements, newest first, with sanitized markdown.
- `/admin/announcements/[id]` shows a read-through rate (`X / Y read`).

---

## File Structure (delta over Plan 5)

Created by this plan:

```
apps/web/src/
├── app/
│   ├── admin/
│   │   └── announcements/
│   │       ├── page.tsx                        # List + status + audience count
│   │       ├── new/
│   │       │   ├── page.tsx                    # Compose form
│   │       │   └── actions.ts                  # createAnnouncement, publishNowAction, scheduleAction
│   │       └── [id]/
│   │           ├── page.tsx                    # Detail + delivery stats
│   │           └── actions.ts                  # publishNowAction (detail-level), markRead passthrough
│   ├── announcements/
│   │   └── page.tsx                            # Public feed of is_public + published
│   └── api/
│       ├── cron/
│       │   └── publish-announcements/
│       │       └── route.ts                    # GET, X-Cron-Secret protected
│       └── notifications/
│           └── [id]/
│               └── read/
│                   └── route.ts                # POST markRead passthrough
├── server/
│   └── announcements/
│       ├── index.ts                            # create, publishNow, schedulePublish, listForUser, markRead
│       ├── audience.ts                         # expandAudience(supabase, announcement) → userIds[]
│       ├── render.ts                           # renderMarkdownToSafeHtml(body_md) → string
│       ├── audience.test.ts
│       ├── publish.test.ts
│       ├── list.test.ts
│       ├── markRead.test.ts
│       └── render.test.ts
├── lib/
│   └── notifications/
│       └── unreadCount.ts                      # server helper used by admin layout bell

supabase/migrations/
├── 20260426000001_announcements.sql
└── 20260426000002_notifications.sql
```

Modified:
- `apps/web/src/app/admin/layout.tsx` — add bell showing unread count (server-side fetch)
- `apps/web/package.json` — add `marked`, `isomorphic-dompurify`
- `.env.example` (or similar reference file) — add `CRON_SECRET`

---

## Task 1: Migration — announcements table

**Files:**
- Create: `supabase/migrations/20260426000001_announcements.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Announcements are authored in draft state (published_at IS NULL),
-- then either (a) published immediately or (b) scheduled_publish_at set
-- and later promoted by the cron route.

create table public.announcements (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null,
  body_md                 text not null,
  priority                text not null default 'info'
                            check (priority in ('info','important','urgent')),
  audience_type           text not null
                            check (audience_type in ('all','role','users','players_in_season')),
  audience_role           text
                            check (audience_role in ('admin','moderator','player') or audience_role is null),
  audience_user_ids       uuid[],
  channels                text[] not null default array['in_app','email']::text[],
  scheduled_publish_at    timestamptz,
  published_at            timestamptz,
  published_by            uuid references public.users (id) on delete set null,
  is_public               boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,

  -- audience_role is required when audience_type='role'
  constraint audience_role_required
    check (audience_type <> 'role' or audience_role is not null),
  -- audience_user_ids is required and non-empty when audience_type='users'
  constraint audience_user_ids_required
    check (audience_type <> 'users'
           or (audience_user_ids is not null and array_length(audience_user_ids, 1) > 0))
);

create index announcements_published_idx
  on public.announcements (published_at desc)
  where deleted_at is null and published_at is not null;

create index announcements_scheduled_idx
  on public.announcements (scheduled_publish_at)
  where deleted_at is null and published_at is null and scheduled_publish_at is not null;

create index announcements_public_idx
  on public.announcements (published_at desc)
  where deleted_at is null and is_public = true and published_at is not null;

select public.attach_audit('public.announcements');
```

- [ ] **Step 2: Push + verify**

```bash
npm run db:push
npx supabase db query "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='announcements' order by ordinal_position" --linked --output table
```

Expected: 15 columns listed; `channels` has `ARRAY` type.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260426000001_announcements.sql
git commit -m "feat(db): announcements table with audience targeting + schedule + audit"
```

---

## Task 2: Migration — notifications table

**Files:**
- Create: `supabase/migrations/20260426000002_notifications.sql`

- [ ] **Step 1: Write migration**

Contents:

```sql
-- Per-user delivery ledger. One row per (announcement, user) pair.
-- No audit trigger — notifications are ephemeral delivery state,
-- not business data. The announcements row is the canonical record.

create table public.notifications (
  id                   uuid primary key default gen_random_uuid(),
  announcement_id      uuid not null references public.announcements (id) on delete cascade,
  user_id              uuid not null references public.users (id) on delete cascade,
  delivered_channels   text[] not null default array[]::text[],
  read_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (announcement_id, user_id)
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where deleted_at is null and read_at is null;

create index notifications_announcement_idx
  on public.notifications (announcement_id)
  where deleted_at is null;
```

Note: `attach_audit` is intentionally NOT called — delivery tracking is high-churn and the announcements row is the canonical audit surface.

- [ ] **Step 2: Push + commit**

```bash
npm run db:push
git add supabase/migrations/20260426000002_notifications.sql
git commit -m "feat(db): notifications table (per-user delivery ledger, no audit trigger)"
```

---

## Task 3: Install markdown + sanitize deps

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/package-lock.json` (auto)

- [ ] **Step 1: Install**

```bash
npm --workspace apps/web install marked@^14.1.3 isomorphic-dompurify@^2.18.0
```

Pinned to the caret ranges above so future `npm install` runs don't drift into a major. Exact resolved versions recorded in `package-lock.json`.

- [ ] **Step 2: Verify build still passes**

```bash
npm --workspace apps/web run build
```

Expected: no type errors. Both packages ship their own types.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json
git commit -m "chore(deps): add marked + isomorphic-dompurify for announcement rendering"
```

---

## Task 4: Markdown render helper — TDD

**Files:**
- Create: `apps/web/src/server/announcements/render.ts`
- Create: `apps/web/src/server/announcements/render.test.ts`

- [ ] **Step 1: Failing test `render.test.ts`**

Contents:

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdownToSafeHtml } from "./render";

describe("renderMarkdownToSafeHtml", () => {
  it("renders basic markdown to HTML", () => {
    const html = renderMarkdownToSafeHtml("# Hello\n\n**bold** body.");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("strips <script> tags", () => {
    const html = renderMarkdownToSafeHtml("Hi <script>alert('x')</script> bye");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips javascript: URLs in links", () => {
    const html = renderMarkdownToSafeHtml("[click](javascript:alert(1))");
    expect(html).not.toMatch(/href=["']javascript:/i);
  });

  it("keeps safe links", () => {
    const html = renderMarkdownToSafeHtml("[docs](https://example.com)");
    expect(html).toMatch(/href=["']https:\/\/example\.com["']/);
  });

  it("returns empty string on empty input", () => {
    expect(renderMarkdownToSafeHtml("")).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace apps/web run test
```

Expected: module not found.

- [ ] **Step 3: Implement `render.ts`**

Contents:

```ts
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

// Synchronous marked config — no remote fetches, no async extensions.
// DOMPurify strips <script>, event handlers, and dangerous URL schemes.
marked.setOptions({ async: false, gfm: true, breaks: true });

export function renderMarkdownToSafeHtml(bodyMd: string): string {
  if (!bodyMd) return "";
  const rawHtml = marked.parse(bodyMd) as string;
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 5 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/announcements/render.ts apps/web/src/server/announcements/render.test.ts
git commit -m "feat(announcements): markdown render helper with DOMPurify sanitization"
```

---

## Task 5: Audience expansion helper — TDD

**Files:**
- Create: `apps/web/src/server/announcements/audience.ts`
- Create: `apps/web/src/server/announcements/audience.test.ts`

- [ ] **Step 1: Failing test `audience.test.ts`**

Contents:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { expandAudience } from "./audience";

type Ann = Parameters<typeof expandAudience>[1];

function mkSb(tables: Record<string, unknown[]>) {
  return {
    from: vi.fn((table: string) => {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.in = vi.fn(() => chain);
      chain.is = vi.fn(() => Promise.resolve({ data: rows, error: null }));
      return chain;
    }),
  };
}

describe("expandAudience", () => {
  beforeEach(() => vi.resetAllMocks());

  it("audience_type='all' returns all non-deleted users", async () => {
    const sb = mkSb({
      users: [{ id: "u1" }, { id: "u2" }, { id: "u3" }],
    });
    const ann = { audience_type: "all" } as Ann;
    const ids = await expandAudience(sb as never, ann);
    expect(ids.sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("audience_type='role' joins user_roles", async () => {
    const sb = mkSb({
      user_roles: [
        { user_id: "u1", role: "admin" },
        { user_id: "u2", role: "admin" },
      ],
    });
    const ann = { audience_type: "role", audience_role: "admin" } as Ann;
    const ids = await expandAudience(sb as never, ann);
    expect(ids.sort()).toEqual(["u1", "u2"]);
  });

  it("audience_type='users' returns exact list", async () => {
    const sb = mkSb({
      users: [{ id: "u1" }, { id: "u7" }],
    });
    const ann = {
      audience_type: "users",
      audience_user_ids: ["u1", "u7", "ghost"],
    } as Ann;
    const ids = await expandAudience(sb as never, ann);
    // Filter keeps only still-existing, non-deleted users:
    expect(ids.sort()).toEqual(["u1", "u7"]);
  });

  it("audience_type='players_in_season' joins season_participants + players", async () => {
    const sb = mkSb({
      season_participants: [
        { player_id: "p1", season: { status: "active" }, player: { user_id: "u1" } },
        { player_id: "p2", season: { status: "active" }, player: { user_id: "u2" } },
      ],
    });
    const ann = { audience_type: "players_in_season" } as Ann;
    const ids = await expandAudience(sb as never, ann);
    expect(ids.sort()).toEqual(["u1", "u2"]);
  });

  it("dedupes ids", async () => {
    const sb = mkSb({ users: [{ id: "u1" }, { id: "u1" }, { id: "u2" }] });
    const ann = { audience_type: "all" } as Ann;
    const ids = await expandAudience(sb as never, ann);
    expect(ids.sort()).toEqual(["u1", "u2"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace apps/web run test
```

- [ ] **Step 3: Implement `audience.ts`**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type AnnouncementAudience = {
  audience_type: "all" | "role" | "users" | "players_in_season";
  audience_role?: string | null;
  audience_user_ids?: string[] | null;
};

/**
 * Expand an announcement's audience declaration into a concrete list
 * of public.users.id values. Always dedupes and filters out soft-deleted users.
 */
export async function expandAudience(
  sb: SupabaseClient,
  ann: AnnouncementAudience
): Promise<string[]> {
  const ids: string[] = [];

  switch (ann.audience_type) {
    case "all": {
      const { data } = await sb
        .from("users")
        .select("id")
        .is("deleted_at", null);
      for (const r of (data ?? []) as { id: string }[]) ids.push(r.id);
      break;
    }

    case "role": {
      if (!ann.audience_role) return [];
      const { data } = await sb
        .from("user_roles")
        .select("user_id")
        .eq("role", ann.audience_role)
        .is("deleted_at", null);
      for (const r of (data ?? []) as { user_id: string }[]) ids.push(r.user_id);
      break;
    }

    case "users": {
      const requested = ann.audience_user_ids ?? [];
      if (requested.length === 0) return [];
      const { data } = await sb
        .from("users")
        .select("id")
        .in("id", requested)
        .is("deleted_at", null);
      for (const r of (data ?? []) as { id: string }[]) ids.push(r.id);
      break;
    }

    case "players_in_season": {
      // season_participants → players → users.id, active seasons only.
      const { data } = await sb
        .from("season_participants")
        .select("player:players(user_id), season:seasons(status)")
        .is("deleted_at", null);
      for (const r of (data ?? []) as {
        player: { user_id: string | null } | null;
        season: { status: string } | null;
      }[]) {
        if (r.season?.status === "active" && r.player?.user_id) {
          ids.push(r.player.user_id);
        }
      }
      break;
    }
  }

  return Array.from(new Set(ids));
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace apps/web run test
```

Expected: 5 new audience tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/announcements/audience.ts apps/web/src/server/announcements/audience.test.ts
git commit -m "feat(announcements): audience expansion (all/role/users/players_in_season)"
```

---

## Task 6: Server module — `create`, `schedulePublish`, `listForUser`, `markRead`

**Files:**
- Create: `apps/web/src/server/announcements/index.ts`

- [ ] **Step 1: Write `index.ts` (publish will be filled in Task 7)**

Contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { expandAudience, type AnnouncementAudience } from "./audience";
import { renderMarkdownToSafeHtml } from "./render";
import { sendEmail } from "@/lib/email/resend";

export type CreateInput = {
  title: string;
  body_md: string;
  priority?: "info" | "important" | "urgent";
  audience_type: AnnouncementAudience["audience_type"];
  audience_role?: string | null;
  audience_user_ids?: string[] | null;
  channels?: string[];
  is_public?: boolean;
  scheduled_publish_at?: string | null;
};

export async function create(sb: SupabaseClient, input: CreateInput): Promise<{ id: string }> {
  const { data, error } = await sb
    .from("announcements")
    .insert({
      title: input.title,
      body_md: input.body_md,
      priority: input.priority ?? "info",
      audience_type: input.audience_type,
      audience_role: input.audience_role ?? null,
      audience_user_ids: input.audience_user_ids ?? null,
      channels: input.channels ?? ["in_app", "email"],
      is_public: input.is_public ?? false,
      scheduled_publish_at: input.scheduled_publish_at ?? null,
      published_at: null,
      published_by: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`announcements.create failed: ${error?.message}`);
  return { id: data.id };
}

export async function schedulePublish(
  sb: SupabaseClient,
  announcementId: string,
  publishAt: string
): Promise<void> {
  const { error } = await sb
    .from("announcements")
    .update({ scheduled_publish_at: publishAt })
    .eq("id", announcementId)
    .is("deleted_at", null);
  if (error) throw new Error(`announcements.schedulePublish failed: ${error.message}`);
}

export async function publishNow(
  sb: SupabaseClient,
  announcementId: string,
  publisherUserId: string
): Promise<{ delivered: number }> {
  // Implementation in Task 7.
  const { delivered } = await publishNowImpl(sb, announcementId, publisherUserId);
  return { delivered };
}

// Internal — exported for Task 7 test; not part of public surface.
export { publishNowImpl };

async function publishNowImpl(
  sb: SupabaseClient,
  announcementId: string,
  publisherUserId: string
): Promise<{ delivered: number }> {
  // Fetch announcement.
  const { data: ann, error: fetchErr } = await sb
    .from("announcements")
    .select(
      "id, title, body_md, channels, audience_type, audience_role, audience_user_ids, published_at"
    )
    .eq("id", announcementId)
    .is("deleted_at", null)
    .single();
  if (fetchErr || !ann) throw new Error(`announcement not found: ${announcementId}`);
  if (ann.published_at) return { delivered: 0 }; // idempotent

  // Expand audience.
  const userIds = await expandAudience(sb, ann as AnnouncementAudience);
  const channels: string[] = ann.channels ?? ["in_app", "email"];
  const wantsInApp = channels.includes("in_app");
  const wantsEmail = channels.includes("email");

  // Mark published FIRST so a concurrent cron run can't double-deliver.
  const { error: markErr } = await sb
    .from("announcements")
    .update({
      published_at: new Date().toISOString(),
      published_by: publisherUserId,
    })
    .eq("id", announcementId)
    .is("published_at", null);
  if (markErr) throw new Error(`publish mark failed: ${markErr.message}`);

  if (userIds.length === 0) return { delivered: 0 };

  // Bulk insert notifications if in_app channel selected. Even if only email
  // is chosen, we still create a notifications row so read-state + count of
  // recipients is trackable — delivered_channels reflects reality.
  const delivered: string[] = [];
  if (wantsInApp) delivered.push("in_app");
  // Email is appended per-user only on success below.
  const notifRows = userIds.map((user_id) => ({
    announcement_id: announcementId,
    user_id,
    delivered_channels: delivered.slice(),
  }));

  const { error: insErr } = await sb
    .from("notifications")
    .upsert(notifRows, { onConflict: "announcement_id,user_id", ignoreDuplicates: true });
  if (insErr) throw new Error(`notifications insert failed: ${insErr.message}`);

  // Email fan-out — one by one (small audiences; batch later if it gets slow).
  if (wantsEmail) {
    const { data: recipients } = await sb
      .from("users")
      .select("id, email, display_name")
      .in("id", userIds)
      .is("deleted_at", null);

    const html = wrapEmailHtml(ann.title, renderMarkdownToSafeHtml(ann.body_md));
    const text = `${ann.title}\n\n${stripTags(renderMarkdownToSafeHtml(ann.body_md))}\n\n— Sent by CADE League`;

    for (const r of (recipients ?? []) as { id: string; email: string }[]) {
      const ok = await sendEmail({
        to: r.email,
        subject: ann.title,
        html,
        text,
      });
      if (ok) {
        // Append 'email' to delivered_channels for this user.
        await sb
          .from("notifications")
          .update({ delivered_channels: [...delivered, "email"] })
          .eq("announcement_id", announcementId)
          .eq("user_id", r.id);
      }
    }
  }

  return { delivered: userIds.length };
}

export async function listForUser(
  sb: SupabaseClient,
  userId: string,
  opts: { limit?: number } = {}
): Promise<
  Array<{
    id: string;
    announcement_id: string;
    read_at: string | null;
    title: string;
    priority: string;
    published_at: string | null;
  }>
> {
  const limit = opts.limit ?? 50;
  const { data, error } = await sb
    .from("notifications")
    .select(
      "id, announcement_id, read_at, announcement:announcements(title, priority, published_at)"
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listForUser failed: ${error.message}`);
  return ((data ?? []) as Array<{
    id: string;
    announcement_id: string;
    read_at: string | null;
    announcement: { title: string; priority: string; published_at: string | null } | null;
  }>).map((n) => ({
    id: n.id,
    announcement_id: n.announcement_id,
    read_at: n.read_at,
    title: n.announcement?.title ?? "",
    priority: n.announcement?.priority ?? "info",
    published_at: n.announcement?.published_at ?? null,
  }));
}

export async function markRead(
  sb: SupabaseClient,
  notificationId: string,
  userId: string
): Promise<void> {
  // Only update if unread and owned by this user — idempotent + authorized.
  const { error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new Error(`markRead failed: ${error.message}`);
}

// --- local helpers ---

function wrapEmailHtml(title: string, innerHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
    <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
    <div>${innerHtml}</div>
    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0" />
    <p style="font-size:12px;color:#666">Sent by CADE League</p>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 2: Typecheck**

```bash
npm --workspace apps/web run build
```

Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/server/announcements/index.ts
git commit -m "feat(announcements): server module skeleton (create, schedule, list, markRead, publishNow)"
```

---

## Task 7: `publishNow` — TDD

**Files:**
- Create: `apps/web/src/server/announcements/publish.test.ts`

- [ ] **Step 1: Failing test**

Contents:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { publishNow } from "./index";

const mockSendEmail = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/email/resend", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

type Ann = {
  id: string;
  title: string;
  body_md: string;
  channels: string[];
  audience_type: string;
  audience_role: string | null;
  audience_user_ids: string[] | null;
  published_at: string | null;
};

function mkSb(opts: {
  announcement: Ann;
  roleMembers?: string[]; // user ids with the target role
  recipients?: { id: string; email: string; display_name: string }[];
}) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];

  const chainForTable = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.single = vi.fn(() => {
      if (table === "announcements") {
        return Promise.resolve({ data: opts.announcement, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    // terminal: user_roles.select().eq().is() resolves
    // via then-handler attached to chain itself — easier: return promise from is()
    // For this mock we rely on the final call being `.is(...)`.
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
      if (table === "user_roles") {
        resolve({
          data: (opts.roleMembers ?? []).map((uid) => ({ user_id: uid })),
          error: null,
        });
      } else if (table === "users") {
        resolve({ data: opts.recipients ?? [], error: null });
      } else {
        resolve({ data: [], error: null });
      }
    };
    chain.insert = vi.fn((rows: unknown) => {
      inserts.push({ table, rows });
      return {
        select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: "x" }, error: null }) })),
      };
    });
    chain.upsert = vi.fn((rows: unknown) => {
      inserts.push({ table, rows, upsert: true });
      return Promise.resolve({ error: null });
    });
    chain.update = vi.fn((patch: unknown) => {
      updates.push({ table, patch });
      return {
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ error: null }),
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
    });
    return chain;
  };

  return {
    _inserts: inserts,
    _updates: updates,
    from: vi.fn((table: string) => chainForTable(table)),
  };
}

describe("publishNow", () => {
  beforeEach(() => {
    mockSendEmail.mockClear();
  });

  it("with audience_type='role' admin and 3 users: inserts 3 notifications + 3 emails", async () => {
    const sb = mkSb({
      announcement: {
        id: "ann-1",
        title: "T",
        body_md: "body",
        channels: ["in_app", "email"],
        audience_type: "role",
        audience_role: "admin",
        audience_user_ids: null,
        published_at: null,
      },
      roleMembers: ["u1", "u2", "u3"],
      recipients: [
        { id: "u1", email: "a@x", display_name: "A" },
        { id: "u2", email: "b@x", display_name: "B" },
        { id: "u3", email: "c@x", display_name: "C" },
      ],
    });
    const r = await publishNow(sb as never, "ann-1", "publisher-1");
    expect(r.delivered).toBe(3);
    // 1 upsert for 3 rows into notifications:
    const notifUpserts = sb._inserts.filter(
      (i) => (i as { table: string }).table === "notifications"
    );
    expect(notifUpserts.length).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(3);
  });

  it("idempotent — already-published announcement returns delivered:0", async () => {
    const sb = mkSb({
      announcement: {
        id: "ann-1",
        title: "T",
        body_md: "body",
        channels: ["in_app", "email"],
        audience_type: "all",
        audience_role: null,
        audience_user_ids: null,
        published_at: "2026-04-20T00:00:00Z",
      },
    });
    const r = await publishNow(sb as never, "ann-1", "publisher-1");
    expect(r.delivered).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("email-only channels still creates notifications (in_app absent from delivered_channels)", async () => {
    const sb = mkSb({
      announcement: {
        id: "ann-1",
        title: "T",
        body_md: "body",
        channels: ["email"],
        audience_type: "role",
        audience_role: "admin",
        audience_user_ids: null,
        published_at: null,
      },
      roleMembers: ["u1"],
      recipients: [{ id: "u1", email: "a@x", display_name: "A" }],
    });
    const r = await publishNow(sb as never, "ann-1", "publisher-1");
    expect(r.delivered).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});
```

Note: the mock above uses the mockable-thenable pattern for `.is(...)` terminal — pragmatic for vitest, not pretty. If the maintainer prefers, `audience.ts` can be mocked directly via `vi.mock("./audience", ...)` returning the user id list, which collapses most of `mkSb`. The test still proves the observable contract (`delivered` + `mockSendEmail` call count + notification upsert shape).

- [ ] **Step 2: Run — expect PASS**

Step 6 from Task 6 already implemented publishNow. Running the tests now should pass.

```bash
npm --workspace apps/web run test
```

Expected: 3 publish tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/server/announcements/publish.test.ts
git commit -m "test(announcements): publishNow + email fan-out + idempotency"
```

---

## Task 8: `listForUser` + `markRead` — TDD

**Files:**
- Create: `apps/web/src/server/announcements/list.test.ts`
- Create: `apps/web/src/server/announcements/markRead.test.ts`

- [ ] **Step 1: Write `list.test.ts`**

Contents:

```ts
import { describe, it, expect, vi } from "vitest";
import { listForUser } from "./index";

function mkSb(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return { from: vi.fn(() => chain) };
}

describe("listForUser", () => {
  it("flattens announcement join", async () => {
    const sb = mkSb([
      {
        id: "n1",
        announcement_id: "a1",
        read_at: null,
        announcement: { title: "Hi", priority: "urgent", published_at: "2026-04-26T00:00:00Z" },
      },
    ]);
    const rows = await listForUser(sb as never, "u1");
    expect(rows).toEqual([
      {
        id: "n1",
        announcement_id: "a1",
        read_at: null,
        title: "Hi",
        priority: "urgent",
        published_at: "2026-04-26T00:00:00Z",
      },
    ]);
  });
});
```

- [ ] **Step 2: Write `markRead.test.ts`**

Contents:

```ts
import { describe, it, expect, vi } from "vitest";
import { markRead } from "./index";

function mkSb() {
  const updateCalls: unknown[] = [];
  const terminal = { error: null };
  return {
    _updateCalls: updateCalls,
    from: vi.fn(() => ({
      update: vi.fn((patch: unknown) => {
        updateCalls.push(patch);
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue(terminal),
            })),
          })),
        };
      }),
    })),
  };
}

describe("markRead", () => {
  it("sets read_at once; second call is no-op (terminal 0 rows via .is read_at null)", async () => {
    const sb = mkSb();
    await markRead(sb as never, "n1", "u1");
    await markRead(sb as never, "n1", "u1");
    expect(sb._updateCalls.length).toBe(2);
    // Both calls patched read_at — second would match zero rows in real DB.
    const patches = sb._updateCalls as Array<{ read_at: string }>;
    expect(patches[0].read_at).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm --workspace apps/web run test
```

Expected: both new tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/server/announcements/list.test.ts apps/web/src/server/announcements/markRead.test.ts
git commit -m "test(announcements): listForUser flatten + markRead idempotency"
```

---

## Task 9: Cron route handler

**Files:**
- Create: `apps/web/src/app/api/cron/publish-announcements/route.ts`

- [ ] **Step 1: Write route**

Contents:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publishNow } from "@/server/announcements";

// Polled by Vercel Cron / GitHub Actions / manual curl every ~5 minutes.
// Protected by X-Cron-Secret header matching env CRON_SECRET.
export async function GET(req: NextRequest) {
  const headerSecret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || headerSecret !== expected) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Use service role so we bypass RLS and can publish under an admin-like context.
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const now = new Date().toISOString();
  const { data: due, error } = await sb
    .from("announcements")
    .select("id")
    .lt("scheduled_publish_at", now)
    .is("published_at", null)
    .is("deleted_at", null)
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve "cron" publisher id — the first admin user, or null.
  const { data: adminRow } = await sb
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const publisherId: string = adminRow?.user_id ?? "00000000-0000-0000-0000-000000000000";

  const results: Array<{ id: string; delivered: number; error?: string }> = [];
  for (const row of (due ?? []) as { id: string }[]) {
    try {
      const { delivered } = await publishNow(sb, row.id, publisherId);
      results.push({ id: row.id, delivered });
    } catch (e) {
      results.push({ id: row.id, delivered: 0, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
```

- [ ] **Step 2: Local smoke test**

Start dev server, then:

```bash
curl -i http://localhost:3000/api/cron/publish-announcements
# → 403

curl -i -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/publish-announcements
# → 200 { "processed": 0, "results": [] }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/cron/publish-announcements
git commit -m "feat(announcements): cron route publishes scheduled drafts (X-Cron-Secret gated)"
```

---

## Task 10: Admin list page `/admin/announcements`

**Files:**
- Create: `apps/web/src/app/admin/announcements/page.tsx`

- [ ] **Step 1: Write page**

Contents:

```tsx
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";

export default async function AnnouncementsListPage() {
  const sb = await getServerSupabase();
  const { data: rows } = await sb
    .from("announcements")
    .select("id, title, priority, audience_type, published_at, scheduled_publish_at, is_public")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Announcements</h2>
        <Link href="/admin/announcements/new" className="bg-black text-white rounded px-3 py-2 text-sm">
          New
        </Link>
      </div>
      <table className="w-full text-sm border">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">Title</th>
            <th className="text-left p-2">Priority</th>
            <th className="text-left p-2">Audience</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Public</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">
                <Link href={`/admin/announcements/${r.id}`} className="underline">
                  {r.title}
                </Link>
              </td>
              <td className="p-2">{r.priority}</td>
              <td className="p-2">{r.audience_type}</td>
              <td className="p-2">
                {r.published_at
                  ? `Published ${formatWat(r.published_at, "yyyy-MM-dd HH:mm")}`
                  : r.scheduled_publish_at
                  ? `Scheduled ${formatWat(r.scheduled_publish_at, "yyyy-MM-dd HH:mm")}`
                  : "Draft"}
              </td>
              <td className="p-2">{r.is_public ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm --workspace apps/web run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin/announcements/page.tsx
git commit -m "feat(admin): announcements list page with status + audience"
```

---

## Task 11: Admin compose page + server actions

**Files:**
- Create: `apps/web/src/app/admin/announcements/new/page.tsx`
- Create: `apps/web/src/app/admin/announcements/new/actions.ts`

- [ ] **Step 1: Write `actions.ts`**

Contents:

```ts
"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { create, publishNow, schedulePublish } from "@/server/announcements";

function parseChannels(formData: FormData): string[] {
  const channels: string[] = [];
  if (formData.get("channel_in_app") === "on") channels.push("in_app");
  if (formData.get("channel_email") === "on") channels.push("email");
  return channels;
}

function parseAudience(formData: FormData): {
  audience_type: "all" | "role" | "users" | "players_in_season";
  audience_role: string | null;
  audience_user_ids: string[] | null;
} {
  const audience_type = String(formData.get("audience_type") ?? "all") as
    | "all"
    | "role"
    | "users"
    | "players_in_season";
  const audience_role = audience_type === "role" ? String(formData.get("audience_role") ?? "player") : null;
  const rawUsers = String(formData.get("audience_user_ids") ?? "").trim();
  const audience_user_ids =
    audience_type === "users"
      ? rawUsers.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      : null;
  return { audience_type, audience_role, audience_user_ids };
}

async function currentPublicUserId(sb: Awaited<ReturnType<typeof getServerSupabase>>): Promise<string | null> {
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  return pub?.id ?? null;
}

export async function submitAnnouncement(formData: FormData) {
  const sb = await getServerSupabase();
  const publisherId = await currentPublicUserId(sb);
  if (!publisherId) throw new Error("not authenticated");

  const mode = String(formData.get("mode") ?? "draft"); // 'publish_now' | 'schedule' | 'draft'
  const title = String(formData.get("title") ?? "").trim();
  const body_md = String(formData.get("body_md") ?? "");
  const priority = String(formData.get("priority") ?? "info") as "info" | "important" | "urgent";
  const is_public = formData.get("is_public") === "on";
  const channels = parseChannels(formData);
  const audience = parseAudience(formData);
  const scheduled_raw = String(formData.get("scheduled_publish_at") ?? "").trim();
  const scheduled_publish_at = scheduled_raw ? new Date(scheduled_raw).toISOString() : null;

  if (!title) throw new Error("title required");
  if (channels.length === 0) throw new Error("at least one channel required");

  const { id } = await create(sb, {
    title,
    body_md,
    priority,
    is_public,
    channels,
    scheduled_publish_at: mode === "schedule" ? scheduled_publish_at : null,
    ...audience,
  });

  if (mode === "publish_now") {
    await publishNow(sb, id, publisherId);
  } else if (mode === "schedule") {
    if (!scheduled_publish_at) throw new Error("scheduled_publish_at required for schedule mode");
    await schedulePublish(sb, id, scheduled_publish_at);
  }

  redirect(`/admin/announcements/${id}`);
}
```

- [ ] **Step 2: Write `page.tsx`**

Contents:

```tsx
import { submitAnnouncement } from "./actions";

export default function NewAnnouncementPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">New announcement</h2>
      <form action={submitAnnouncement} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm">Title</span>
          <input name="title" required className="w-full border rounded px-3 py-2" />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Body (markdown)</span>
          <textarea name="body_md" rows={10} className="w-full border rounded px-3 py-2 font-mono text-sm" />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Priority</span>
          <select name="priority" className="border rounded px-3 py-2">
            <option value="info">info</option>
            <option value="important">important</option>
            <option value="urgent">urgent</option>
          </select>
        </label>

        <fieldset className="space-y-2 border rounded p-3">
          <legend className="text-sm px-1">Audience</legend>
          <select name="audience_type" className="border rounded px-2 py-1">
            <option value="all">All users</option>
            <option value="role">Role</option>
            <option value="users">Specific users</option>
            <option value="players_in_season">Players in active season</option>
          </select>
          <input
            name="audience_role"
            placeholder="admin | moderator | player"
            className="border rounded px-2 py-1 ml-2"
          />
          <input
            name="audience_user_ids"
            placeholder="comma-separated user UUIDs (for 'users')"
            className="w-full border rounded px-2 py-1"
          />
        </fieldset>

        <fieldset className="space-y-2 border rounded p-3">
          <legend className="text-sm px-1">Channels</legend>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="channel_in_app" defaultChecked /> in_app
          </label>
          <label className="inline-flex items-center gap-2 ml-4">
            <input type="checkbox" name="channel_email" defaultChecked /> email
          </label>
        </fieldset>

        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="is_public" /> Public (show on /announcements)
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Schedule publish at (optional)</span>
          <input
            type="datetime-local"
            name="scheduled_publish_at"
            className="border rounded px-3 py-2"
          />
        </label>

        <div className="flex gap-2">
          <button name="mode" value="publish_now" className="bg-black text-white rounded px-4 py-2" type="submit">
            Publish now
          </button>
          <button name="mode" value="schedule" className="bg-slate-700 text-white rounded px-4 py-2" type="submit">
            Schedule
          </button>
          <button name="mode" value="draft" className="border rounded px-4 py-2" type="submit">
            Save draft
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/admin/announcements/new
git commit -m "feat(admin): compose announcement form with publish/schedule/draft actions"
```

---

## Task 12: Admin detail page `/admin/announcements/[id]`

**Files:**
- Create: `apps/web/src/app/admin/announcements/[id]/page.tsx`
- Create: `apps/web/src/app/admin/announcements/[id]/actions.ts`

- [ ] **Step 1: Write `actions.ts`**

Contents:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { publishNow } from "@/server/announcements";

export async function publishNowFromDetail(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user?.id ?? "")
    .single();
  if (!pub) return;
  await publishNow(sb, id, pub.id);
  revalidatePath(`/admin/announcements/${id}`);
}
```

- [ ] **Step 2: Write `page.tsx`**

Contents:

```tsx
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { renderMarkdownToSafeHtml } from "@/server/announcements/render";
import { publishNowFromDetail } from "./actions";

export default async function AnnouncementDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();

  const { data: ann } = await sb
    .from("announcements")
    .select(
      "id, title, body_md, priority, audience_type, audience_role, channels, scheduled_publish_at, published_at, is_public"
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!ann) notFound();

  const { count: totalCount } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("announcement_id", id)
    .is("deleted_at", null);

  const { count: readCount } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("announcement_id", id)
    .is("deleted_at", null)
    .not("read_at", "is", null);

  const html = renderMarkdownToSafeHtml(ann.body_md);

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">{ann.title}</h2>
      <div className="text-sm text-gray-600">
        Priority: {ann.priority} · Audience: {ann.audience_type}
        {ann.audience_role ? ` (${ann.audience_role})` : ""} · Public: {ann.is_public ? "yes" : "no"}
      </div>
      <div className="text-sm">
        {ann.published_at ? (
          <>Published {formatWat(ann.published_at, "yyyy-MM-dd HH:mm")}</>
        ) : ann.scheduled_publish_at ? (
          <>Scheduled for {formatWat(ann.scheduled_publish_at, "yyyy-MM-dd HH:mm")}</>
        ) : (
          <>Draft</>
        )}
      </div>
      <article className="prose prose-sm" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="text-sm text-gray-600">
        Delivery: {readCount ?? 0} / {totalCount ?? 0} read
      </div>
      {!ann.published_at ? (
        <form action={publishNowFromDetail}>
          <input type="hidden" name="id" value={ann.id} />
          <button className="bg-black text-white rounded px-4 py-2" type="submit">
            Publish now
          </button>
        </form>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/admin/announcements/[id]
git commit -m "feat(admin): announcement detail page + publish-now + delivery stats"
```

---

## Task 13: Public feed `/announcements`

**Files:**
- Create: `apps/web/src/app/announcements/page.tsx`

- [ ] **Step 1: Write page**

Contents:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { renderMarkdownToSafeHtml } from "@/server/announcements/render";

export const revalidate = 60; // ISR — per spec §12

export default async function PublicAnnouncements() {
  const sb = await getServerSupabase();
  const { data: rows } = await sb
    .from("announcements")
    .select("id, title, body_md, priority, published_at")
    .is("deleted_at", null)
    .eq("is_public", true)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(50);

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">Announcements</h1>
      {(rows ?? []).map((r) => (
        <article key={r.id} className="space-y-2 border-b pb-6">
          <header className="flex items-baseline gap-3">
            <h2 className="text-xl font-semibold">{r.title}</h2>
            <span className="text-xs uppercase tracking-wide text-gray-500">{r.priority}</span>
          </header>
          <time className="text-sm text-gray-500">
            {r.published_at ? formatWat(r.published_at, "yyyy-MM-dd HH:mm") : ""}
          </time>
          <div
            className="prose prose-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(r.body_md) }}
          />
        </article>
      ))}
      {(!rows || rows.length === 0) && <p className="text-gray-500">Nothing to announce yet.</p>}
    </main>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/announcements/page.tsx
git commit -m "feat(public): /announcements feed (is_public + published, ISR 60s)"
```

---

## Task 14: Bell / unread count in admin layout

**Files:**
- Create: `apps/web/src/lib/notifications/unreadCount.ts`
- Modify: `apps/web/src/app/admin/layout.tsx`

- [ ] **Step 1: Write helper**

Contents of `unreadCount.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getUnreadCountForAuthUser(sb: SupabaseClient): Promise<number> {
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return 0;
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .single();
  if (!pub) return 0;

  const { count } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .is("read_at", null);
  return count ?? 0;
}
```

- [ ] **Step 2: Modify admin layout to render bell**

In `apps/web/src/app/admin/layout.tsx`, inside the header's flex row add:

```tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { getUnreadCountForAuthUser } from "@/lib/notifications/unreadCount";
import Link from "next/link";

// ...
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const sb = await getServerSupabase();
  const unread = await getUnreadCountForAuthUser(sb);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="font-semibold">CADE League · Admin</h1>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/announcements"
              aria-label="Notifications"
              className="relative text-sm"
              data-testid="bell"
            >
              Bell
              {unread > 0 ? (
                <span
                  className="absolute -top-2 -right-3 bg-red-600 text-white text-xs rounded-full px-1.5"
                  data-testid="bell-count"
                >
                  {unread}
                </span>
              ) : null}
            </Link>
            <form action="/logout" method="post">
              <button className="text-sm underline" type="submit">Log out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/lib/notifications apps/web/src/app/admin/layout.tsx
git commit -m "feat(admin): unread-count bell in admin layout header"
```

---

## Task 15: Mark-read route handler

**Files:**
- Create: `apps/web/src/app/api/notifications/[id]/read/route.ts`

- [ ] **Step 1: Write route**

Contents:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { markRead } from "@/server/announcements";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) return new NextResponse("Unauthorized", { status: 401 });

  await markRead(sb, id, pub.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Build + commit**

```bash
npm --workspace apps/web run build
git add apps/web/src/app/api/notifications
git commit -m "feat(api): POST /api/notifications/[id]/read marks notification read"
```

---

## Task 16: E2E — compose → publish → public feed → email stub

**Files:**
- Create: `apps/web/tests/e2e/announcements.spec.ts`

- [ ] **Step 1: Write E2E**

Contents:

```ts
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

test.describe("announcements happy path", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/admin/);
  });

  test("admin composes public announcement, publishes now, shows on /announcements", async ({ page }) => {
    const title = `E2E test ${Date.now()}`;
    await page.goto("/admin/announcements/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Body (markdown)").fill("# Heading\n\nHello **world**.");
    await page.getByLabel("Public").check();
    // audience_type stays on "All users"; channels in_app + email stay checked.
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page).toHaveURL(/\/admin\/announcements\/[0-9a-f-]+/);
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText(/Delivery: \d+ \/ \d+ read/)).toBeVisible();

    // Public feed reflects it (ISR — force-refresh).
    await page.goto("/announcements", { waitUntil: "networkidle" });
    await expect(page.getByText(title)).toBeVisible();
  });

  test("cron route 403s without secret", async ({ request }) => {
    const r = await request.get("/api/cron/publish-announcements");
    expect(r.status()).toBe(403);
  });

  test("cron route 200s with correct secret", async ({ request }) => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "CRON_SECRET env var required for this test");
    const r = await request.get("/api/cron/publish-announcements", {
      headers: { "X-Cron-Secret": secret! },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("processed");
  });
});
```

- [ ] **Step 2: Verify email stub output**

When `RESEND_API_KEY` is unset, `sendEmail` logs `[email:stub]` to stdout. During the E2E run, the Next.js dev server captures these — check the server log:

```bash
# Tail the dev server stdout during the E2E run and grep [email:stub]
npm --workspace apps/web run e2e 2>&1 | tee /tmp/e2e.log
grep -c '\[email:stub\]' /tmp/e2e.log
```

Expected: one or more stub lines per published announcement (one per recipient with `email` channel).

- [ ] **Step 3: Run**

```bash
npm --workspace apps/web run e2e
```

Expected: 3 new tests pass (happy path + 403 + 200 secret).

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e/announcements.spec.ts
git commit -m "test(e2e): compose → publish → public feed + cron secret gate"
```

---

## Task 17: Env + deployment notes

**Files:**
- Modify: `.env.example` (or project equivalent) — add `CRON_SECRET`
- Create/update: a short note inline in this plan's "Out of Scope" below describing Vercel Cron + GitHub Actions cron config

- [ ] **Step 1: Add `CRON_SECRET` to `.env.example`**

```env
# Cron endpoint shared secret for /api/cron/publish-announcements
CRON_SECRET=change-me-to-a-long-random-string
```

- [ ] **Step 2: Document the two prod cron options (see Out of Scope section below).**

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore(env): document CRON_SECRET for scheduled announcements publish"
```

---

## Task 18: Final verification

- [ ] **Step 1: All migrations applied**

```bash
npm run db:push
```

- [ ] **Step 2: Unit tests**

```bash
npm run test
```

Expected totals up through Plan 6: prior tests + 5 render + 5 audience + 3 publish + 1 list + 1 markRead = 15 new tests in this plan.

- [ ] **Step 3: Lint + build**

```bash
npm run lint && npm run build
```

- [ ] **Step 4: E2E**

```bash
npm --workspace apps/web run e2e
```

Expected: +3 tests (compose/publish/public + 403 + 200).

- [ ] **Step 5: Audit trigger active on announcements**

```bash
npx --yes supabase db query "select entity_type, action, count(*) from public.audit_events where entity_type='announcements' group by 1,2" --linked --output table
```

Expected: at least one `insert` and one `update` row (from the E2E draft → publish transition).

- [ ] **Step 6: No audit trigger on notifications**

```bash
npx --yes supabase db query "select count(*) from public.audit_events where entity_type='notifications'" --linked --output table
```

Expected: `0`.

- [ ] **Step 7: Update `tasks/todo.md`**

Move Plan 6 to Done.

- [ ] **Step 8: Commit verification**

```bash
git add tasks/todo.md
git commit -m "docs(tasks): Plan 6 complete"
```

---

## Out of Scope for Plan 6

- Real-time push / WebSocket delivery of in-app notifications (Phase 2+). Bell count is a server-render of current unread count; users must navigate to refresh.
- Batched email sending (for audiences > ~100). Current per-user loop is fine for Division 1 Elite's 13 players + a handful of staff.
- Announcement editing after publish. Phase 1A treats publish as a frozen event; edits require a follow-up announcement or admin DB intervention.
- Bounce / complaint handling from Resend webhooks (Phase 2+).
- A11y on the bell beyond `aria-label="Notifications"`. Design system pass later.
- Pagination on `/announcements` (caps at 50 rows for Phase 1A).
- Per-channel delivery retry (Phase 2+). Current behaviour: if `sendEmail` returns false, the notification row exists with `delivered_channels=['in_app']` only; admin can see unread = sent-not-read but not email-failed separately. Track via `[email:error]` log lines for now.

### Production cron wiring (follow-up)

Two supported options; pick one when deploying:

1. **Vercel Cron** (preferred if we deploy on Vercel). Add to `vercel.json`:

   ```json
   {
     "crons": [
       { "path": "/api/cron/publish-announcements", "schedule": "*/5 * * * *" }
     ]
   }
   ```

   Vercel automatically passes an `Authorization: Bearer <CRON_SECRET>` header — our route currently checks `X-Cron-Secret`. If adopting Vercel Cron, update the route to accept either header, or (simpler) set `CRON_SECRET` and a matching `headers` clause in `vercel.json`.

2. **GitHub Actions cron** (portable; works with any host). `.github/workflows/announcements-cron.yml`:

   ```yaml
   on:
     schedule:
       - cron: "*/5 * * * *"
   jobs:
     publish:
       runs-on: ubuntu-latest
       steps:
         - run: |
             curl -fsS \
               -H "X-Cron-Secret: ${{ secrets.CRON_SECRET }}" \
               https://${{ vars.APP_HOST }}/api/cron/publish-announcements
   ```

Both approaches expect `CRON_SECRET` set in the respective secret store.

---

## Review / Acceptance Criteria

Plan 6 is done when:

1. `git log --oneline` shows ~18 commits (one per task, + E2E + env note).
2. All unit tests green (+15 from this plan).
3. Admin can compose an announcement with audience_type='all', publish now, land on detail page, and see `Delivery: 0 / N read` where N = count of non-deleted users.
4. `/announcements` shows only `is_public=true` + `published_at is not null` entries, newest first, with sanitized markdown rendered.
5. `GET /api/cron/publish-announcements` without the `X-Cron-Secret` header returns 403; with it returns 200 + processed count.
6. A scheduled announcement (`scheduled_publish_at` = 1 minute ago, manually inserted) becomes published on the next cron hit.
7. `[email:stub]` log lines appear in dev server output during the E2E run (one per recipient with `email` channel).
8. Admin layout header renders a bell; when logged in as a user with one unread notification, `data-testid="bell-count"` shows `1`.
9. `audit_events` has rows for `announcements` but zero rows for `notifications`.
10. `marked` + `isomorphic-dompurify` versions pinned in `package.json`; no major-range drift.
