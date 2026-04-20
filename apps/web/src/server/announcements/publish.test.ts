import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendEmail = vi.fn().mockResolvedValue(true);
const mockExpandAudience = vi.fn();

vi.mock("@/lib/email/resend", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));
vi.mock("./audience", () => ({
  expandAudience: (...args: unknown[]) => mockExpandAudience(...args),
}));

import { publishNow } from "./index";

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

/**
 * Build a minimal Supabase-like mock whose fluent chain behaves for the
 * paths publishNow actually walks:
 *   announcements.select().eq().is().single()  → returns {data: announcement}
 *   announcements.update().eq().is()           → { error: null }
 *   notifications.upsert(rows)                 → { error: null }
 *   users.select().in().is()                   → awaited, returns recipients
 *   notifications.update().eq().eq()           → { error: null }
 */
function mkSb(opts: {
  announcement: Ann;
  recipients?: { id: string; email: string; display_name: string }[];
}) {
  const inserts: Array<{ table: string; rows: unknown; upsert?: boolean }> = [];
  const updates: Array<{ table: string; patch: unknown }> = [];

  const chainForTable = (table: string) => {
    const chain: Record<string, unknown> = {};
    // users.select("id,email,display_name").in(...).is(...) is awaited,
    // so make `is` return a resolved Promise for users; otherwise chainable.
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);
    chain.is = vi.fn(() => {
      if (table === "users") {
        return Promise.resolve({ data: opts.recipients ?? [], error: null });
      }
      return chain;
    });
    chain.single = vi.fn(() => {
      if (table === "announcements") {
        return Promise.resolve({ data: opts.announcement, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    chain.upsert = vi.fn((rows: unknown) => {
      inserts.push({ table, rows, upsert: true });
      return Promise.resolve({ error: null });
    });
    chain.update = vi.fn((patch: unknown) => {
      updates.push({ table, patch });
      // For announcements.update().eq().is() path.
      // For notifications.update().eq().eq() path.
      const terminal = Promise.resolve({ error: null });
      const inner = {
        eq: vi.fn(() => ({
          is: vi.fn(() => terminal),
          eq: vi.fn(() => terminal),
        })),
        is: vi.fn(() => terminal),
      };
      return inner;
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
    mockSendEmail.mockResolvedValue(true);
    mockExpandAudience.mockReset();
  });

  it("with audience_type='role' admin and 3 users: inserts 3 notifications + 3 emails", async () => {
    mockExpandAudience.mockResolvedValue(["u1", "u2", "u3"]);
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
      recipients: [
        { id: "u1", email: "a@x", display_name: "A" },
        { id: "u2", email: "b@x", display_name: "B" },
        { id: "u3", email: "c@x", display_name: "C" },
      ],
    });
    const r = await publishNow(sb as never, "ann-1", "publisher-1");
    expect(r.delivered).toBe(3);
    const notifUpserts = sb._inserts.filter((i) => i.table === "notifications");
    expect(notifUpserts.length).toBe(1);
    const rows = notifUpserts[0].rows as Array<{ user_id: string; delivered_channels: string[] }>;
    expect(rows.length).toBe(3);
    expect(rows[0].delivered_channels).toContain("in_app");
    expect(mockSendEmail).toHaveBeenCalledTimes(3);
  });

  it("idempotent — already-published announcement returns delivered:0", async () => {
    mockExpandAudience.mockResolvedValue(["u1"]);
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
    mockExpandAudience.mockResolvedValue(["u1"]);
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
      recipients: [{ id: "u1", email: "a@x", display_name: "A" }],
    });
    const r = await publishNow(sb as never, "ann-1", "publisher-1");
    expect(r.delivered).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const notifUpserts = sb._inserts.filter((i) => i.table === "notifications");
    expect(notifUpserts.length).toBe(1);
    const rows = notifUpserts[0].rows as Array<{ delivered_channels: string[] }>;
    expect(rows[0].delivered_channels).not.toContain("in_app");
  });
});
