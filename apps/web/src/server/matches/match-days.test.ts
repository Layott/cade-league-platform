import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMatchDay, publishMatchDay, unpublishMatchDay } from "./match-days";
import { __test as cacheTest } from "@/server/roles/cache";

function mockSb(insertResult: { id: string } | null, insertError: Error | null = null) {
  const insertFn = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue(
        insertError
          ? { data: null, error: insertError }
          : { data: insertResult, error: null }
      ),
    })),
  }));
  return {
    from: vi.fn(() => ({ insert: insertFn })),
    _insertFn: insertFn,
  };
}

describe("createMatchDay", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects invalid date format", async () => {
    const sb = mockSb({ id: "x" });
    await expect(
      createMatchDay(sb as never, {
        seasonId: "11111111-1111-4111-8111-111111111111",
        matchDate: "2026/06/01",
        arrivalCutoffTime: "18:00",
        matchStartTime: "19:00",
        venueName: "v",
      } as never)
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("inserts row and returns id on happy path", async () => {
    const sb = mockSb({ id: "md-1" });
    const out = await createMatchDay(sb as never, {
      seasonId: "11111111-1111-4111-8111-111111111111",
      matchDate: "2026-06-01",
      arrivalCutoffTime: "18:00",
      matchStartTime: "19:00",
      venueName: "CADE HQ",
    });
    expect(out).toEqual({ id: "md-1" });
    expect(sb.from).toHaveBeenCalledWith("match_days");
  });

  it("maps camelCase to snake_case in insert payload", async () => {
    const sb = mockSb({ id: "md-2" });
    await createMatchDay(sb as never, {
      seasonId: "11111111-1111-4111-8111-111111111111",
      matchDate: "2026-06-02",
      arrivalCutoffTime: "17:30",
      matchStartTime: "18:30",
      venueName: "Venue",
      notes: "pre-match meal",
    });
    const payload = (sb._insertFn.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      season_id: "11111111-1111-4111-8111-111111111111",
      match_date: "2026-06-02",
      arrival_cutoff_time: "17:30",
      match_start_time: "18:30",
      venue_name: "Venue",
      notes: "pre-match meal",
    });
  });
});

/**
 * Plan 27 — publish/unpublish tests.
 *
 * The mock dual-purposes itself: when the function asks for `role_permissions`
 * (the perm-check path), it answers with the row map; when it asks for
 * `match_days` (the actual update), it returns success and captures the
 * payload so we can assert it.
 */
function mkPublishSb(rowsByRole: Record<string, string[]>) {
  const updatePayloads: Array<Record<string, unknown>> = [];
  const from = vi.fn((table: string) => {
    if (table === "role_permissions") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((_col: string, val: string) => {
        const perms = (rowsByRole[val] ?? []).map((permission) => ({ permission }));
        return Promise.resolve({ data: perms, error: null });
      });
      return chain;
    }
    if (table === "match_days") {
      // Capture .update(payload).eq(...).is(...)[.is(...)] chains. The chain
      // length depends on whether publishMatchDay (3 calls) or
      // unpublishMatchDay (2 calls) is invoked. Make `tail` thenable so
      // `await` resolves no matter when the caller stops chaining.
      return {
        update: vi.fn((payload: Record<string, unknown>) => {
          updatePayloads.push(payload);
          type Tail = {
            eq: ReturnType<typeof vi.fn>;
            is: ReturnType<typeof vi.fn>;
            then: (
              resolve: (v: { error: null }) => void,
            ) => void;
          };
          const tail: Tail = {
            eq: vi.fn(() => tail),
            is: vi.fn(() => tail),
            then: (resolve) => resolve({ error: null }),
          };
          return tail;
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from, _updates: updatePayloads };
}

beforeEach(() => cacheTest.clearAll());
afterEach(() => cacheTest.clearAll());

describe("publishMatchDay (Plan 27)", () => {
  it("rejects when actor lacks match_days.publish", async () => {
    const sb = mkPublishSb({ player: ["matches.read"] });
    await expect(
      publishMatchDay(sb as never, { userId: "u", roles: ["player"] }, "md-1"),
    ).rejects.toThrow(/missing permission/);
  });

  it("admin wildcard is allowed and writes published_at timestamp", async () => {
    const sb = mkPublishSb({ admin: ["*"] });
    await publishMatchDay(sb as never, { userId: "u", roles: ["admin"] }, "md-1");
    expect(sb._updates).toHaveLength(1);
    const payload = sb._updates[0];
    expect(payload).toHaveProperty("published_at");
    expect(typeof payload.published_at).toBe("string");
    // ISO timestamp shape
    expect(String(payload.published_at)).toMatch(/T.*Z$/);
  });

  it("loc role with explicit grant succeeds", async () => {
    const sb = mkPublishSb({ loc: ["match_days.publish"] });
    await expect(
      publishMatchDay(sb as never, { userId: "u", roles: ["loc"] }, "md-1"),
    ).resolves.toBeUndefined();
  });
});

describe("unpublishMatchDay (Plan 27)", () => {
  it("rejects when actor lacks match_days.publish", async () => {
    const sb = mkPublishSb({ moderator: ["punishments.issue"] });
    await expect(
      unpublishMatchDay(sb as never, { userId: "u", roles: ["moderator"] }, "md-1"),
    ).rejects.toThrow(/missing permission/);
  });

  it("clears published_at to null on success", async () => {
    const sb = mkPublishSb({ admin: ["*"] });
    await unpublishMatchDay(sb as never, { userId: "u", roles: ["admin"] }, "md-1");
    expect(sb._updates).toHaveLength(1);
    expect(sb._updates[0].published_at).toBeNull();
  });
});
