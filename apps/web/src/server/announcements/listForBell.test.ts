import { describe, it, expect, vi } from "vitest";
import { listAnnouncementsForUser, markAllRead } from "./index";

/**
 * Plan 40 §3.3 — the shape contract for /api/notifications/announcements.
 * These tests exercise the two new server functions powering the bell
 * modal end-to-end: the list query (joined against announcements with
 * body_md + soft-delete filter) and the read-all mutation.
 */

function mkListSb(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return { from: vi.fn(() => chain) };
}

function mkUpdateSb() {
  const patches: Array<Record<string, unknown>> = [];
  const filterCalls: Array<{ op: string; args: unknown[] }> = [];
  return {
    _patches: patches,
    _filters: filterCalls,
    from: vi.fn(() => ({
      update: vi.fn((patch: Record<string, unknown>) => {
        patches.push(patch);
        // Build a thenable chain: every .eq/.is returns the same
        // thenable so the terminal-await resolves whenever the caller
        // stops chaining. This mirrors how the real Supabase builder
        // works and sidesteps fragile call-count counting.
        const thenable: Record<string, unknown> = {};
        const record = (op: string) => (...args: unknown[]) => {
          filterCalls.push({ op, args });
          return thenable;
        };
        thenable.eq = vi.fn(record("eq"));
        thenable.is = vi.fn(record("is"));
        thenable.then = (
          resolve: (v: { error: null }) => unknown
        ) => resolve({ error: null });
        return thenable;
      }),
    })),
  };
}

describe("listAnnouncementsForUser (Plan 40)", () => {
  it("projects the spec shape { id, title, body_md, priority, published_at, is_read }", async () => {
    const sb = mkListSb([
      {
        id: "n1",
        read_at: null,
        announcement: {
          title: "Squad window open",
          body_md: "# Head's up\n\nSubmit by Thursday 10:00 WAT.",
          priority: "important",
          published_at: "2026-04-22T10:00:00Z",
          deleted_at: null,
        },
      },
      {
        id: "n2",
        read_at: "2026-04-22T12:00:00Z",
        announcement: {
          title: "Rulebook v1.7.1",
          body_md: "Minor clarification to Rule 5.4.",
          priority: "info",
          published_at: "2026-04-20T09:00:00Z",
          deleted_at: null,
        },
      },
    ]);

    const rows = await listAnnouncementsForUser(sb as never, "user-1");

    expect(rows).toEqual([
      {
        id: "n1",
        title: "Squad window open",
        body_md: "# Head's up\n\nSubmit by Thursday 10:00 WAT.",
        priority: "important",
        published_at: "2026-04-22T10:00:00Z",
        is_read: false,
      },
      {
        id: "n2",
        title: "Rulebook v1.7.1",
        body_md: "Minor clarification to Rule 5.4.",
        priority: "info",
        published_at: "2026-04-20T09:00:00Z",
        is_read: true,
      },
    ]);
  });

  it("drops notifications whose joined announcement was soft-deleted", async () => {
    // A notification row joined against a soft-deleted announcement must
    // never leak into the bell modal — the admin may have retracted it.
    const sb = mkListSb([
      {
        id: "n1",
        read_at: null,
        announcement: {
          title: "Live",
          body_md: "body",
          priority: "info",
          published_at: "2026-04-22T10:00:00Z",
          deleted_at: null,
        },
      },
      {
        id: "n2",
        read_at: null,
        announcement: {
          title: "Retracted",
          body_md: "should not appear",
          priority: "info",
          published_at: "2026-04-22T09:00:00Z",
          deleted_at: "2026-04-22T09:30:00Z",
        },
      },
    ]);

    const rows = await listAnnouncementsForUser(sb as never, "user-1");
    expect(rows.map((r) => r.id)).toEqual(["n1"]);
    expect(rows.some((r) => r.title === "Retracted")).toBe(false);
  });

  it("handles an empty inbox without throwing", async () => {
    const sb = mkListSb([]);
    const rows = await listAnnouncementsForUser(sb as never, "nobody");
    expect(rows).toEqual([]);
  });

  it("uses default limit of 50 but accepts override", async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    const limitMock = vi.fn(() => Promise.resolve({ data: [], error: null }));
    chain.limit = limitMock;
    const sb = { from: vi.fn(() => chain) };

    await listAnnouncementsForUser(sb as never, "u1");
    expect(limitMock).toHaveBeenLastCalledWith(50);

    await listAnnouncementsForUser(sb as never, "u1", { limit: 10 });
    expect(limitMock).toHaveBeenLastCalledWith(10);
  });
});

describe("markAllRead (Plan 40)", () => {
  it("issues a single UPDATE scoped to user_id + unread rows", async () => {
    const sb = mkUpdateSb();
    await markAllRead(sb as never, "user-42");
    expect(sb._patches.length).toBe(1);
    expect(sb._patches[0]).toMatchObject({ read_at: expect.any(String) });

    const eqCalls = sb._filters.filter((c) => c.op === "eq");
    const isCalls = sb._filters.filter((c) => c.op === "is");
    expect(eqCalls[0]?.args).toEqual(["user_id", "user-42"]);
    // Both deleted_at and read_at constraints must be present so a
    // second call can't reset `read_at` on already-read rows.
    const isKeys = isCalls.map((c) => c.args[0]);
    expect(isKeys).toContain("deleted_at");
    expect(isKeys).toContain("read_at");
  });

  it("is idempotent: a second call doesn't throw", async () => {
    const sb = mkUpdateSb();
    await markAllRead(sb as never, "user-42");
    await markAllRead(sb as never, "user-42");
    expect(sb._patches.length).toBe(2);
  });
});
