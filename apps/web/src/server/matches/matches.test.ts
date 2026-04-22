import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMatch,
  editMatch,
  reorderMatches,
  softDeleteMatch,
  voidMatch,
} from "./matches";
import { __test as cacheTest } from "@/server/roles/cache";

function mkSb({
  matchDay,
  insertId = "m-1",
}: {
  matchDay: { season_id: string } | null;
  insertId?: string;
}) {
  const insertFn = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: insertId }, error: null }),
    })),
  }));
  const updateFn = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }));
  return {
    from: vi.fn((table: string) => {
      if (table === "match_days") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: matchDay, error: matchDay ? null : new Error("no") }),
              })),
            })),
          })),
        };
      }
      if (table === "matches") return { insert: insertFn, update: updateFn };
      throw new Error(`unexpected table ${table}`);
    }),
    _insert: insertFn,
    _update: updateFn,
  };
}

describe("createMatch", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects same home/away player", async () => {
    const sb = mkSb({ matchDay: { season_id: "s-1" } });
    await expect(
      createMatch(sb as never, {
        matchDayId: "11111111-1111-4111-8111-111111111111",
        homePlayerId: "22222222-2222-4222-8222-222222222222",
        awayPlayerId: "22222222-2222-4222-8222-222222222222",
      })
    ).rejects.toThrow(/same player/i);
  });

  it("resolves season_id from match_day and inserts", async () => {
    const sb = mkSb({ matchDay: { season_id: "s-1" } });
    const out = await createMatch(sb as never, {
      matchDayId: "11111111-1111-4111-8111-111111111111",
      homePlayerId: "22222222-2222-4222-8222-222222222222",
      awayPlayerId: "33333333-3333-4333-8333-333333333333",
    });
    expect(out.id).toBe("m-1");
    const payload = (sb._insert.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      season_id: "s-1",
      home_player_id: "22222222-2222-4222-8222-222222222222",
    });
  });
});

describe("voidMatch", () => {
  it("sets status=voided on the matches row", async () => {
    const sb = mkSb({ matchDay: { season_id: "s-1" } });
    await voidMatch(sb as never, "m-77");
    expect(sb._update).toHaveBeenCalled();
  });
});

function mkUpdateSb() {
  // The new editMatch / softDeleteMatch helpers chain
  // .update(...).eq(...).is(...) so the eq() leaf must return a promise.
  const isFn = vi.fn().mockResolvedValue({ error: null });
  const eqFn = vi.fn(() => ({ is: isFn }));
  const updateFn = vi.fn(() => ({ eq: eqFn }));
  return {
    from: vi.fn(() => ({ update: updateFn })),
    _update: updateFn,
    _eq: eqFn,
    _is: isFn,
  };
}

describe("editMatch (Plan 26)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects same home/away player", async () => {
    const sb = mkUpdateSb();
    await expect(
      editMatch(sb as never, {
        matchId: "11111111-1111-4111-8111-111111111111",
        homePlayerId: "22222222-2222-4222-8222-222222222222",
        awayPlayerId: "22222222-2222-4222-8222-222222222222",
      })
    ).rejects.toThrow(/same player/i);
  });

  it("updates the matches row with snake_case columns", async () => {
    const sb = mkUpdateSb();
    await editMatch(sb as never, {
      matchId: "11111111-1111-4111-8111-111111111111",
      homePlayerId: "22222222-2222-4222-8222-222222222222",
      awayPlayerId: "33333333-3333-4333-8333-333333333333",
    });
    expect(sb.from).toHaveBeenCalledWith("matches");
    const payload = (sb._update.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      home_player_id: "22222222-2222-4222-8222-222222222222",
      away_player_id: "33333333-3333-4333-8333-333333333333",
    });
  });
});

describe("softDeleteMatch (Plan 26)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("sets deleted_at on the matches row", async () => {
    const sb = mkUpdateSb();
    await softDeleteMatch(sb as never, {
      matchId: "11111111-1111-4111-8111-111111111111",
    });
    const payload = (sb._update.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload.deleted_at).toEqual(expect.any(String));
  });
});

/**
 * Plan 27 — reorderMatches.
 *
 * Mock dual-purposes itself: handles `role_permissions` (perm check),
 * `matches` SELECT (existing-id verify), and `matches` UPDATE (per-row
 * match_order rewrite).
 */
function mkReorderSb(opts: {
  rolePerms: Record<string, string[]>;
  matchIds: string[];
}) {
  const updateCalls: Array<{ payload: Record<string, unknown>; id: string }> = [];
  let nextEqId = "";
  const from = vi.fn((table: string) => {
    if (table === "role_permissions") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((_col: string, val: string) => {
        const perms = (opts.rolePerms[val] ?? []).map((permission) => ({ permission }));
        return Promise.resolve({ data: perms, error: null });
      });
      return chain;
    }
    if (table === "matches") {
      // The verify-select chain: select().eq(match_day_id).is(deleted_at).order? returns an array of {id}.
      const selectChain: Record<string, unknown> = {};
      selectChain.select = vi.fn(() => selectChain);
      selectChain.eq = vi.fn(() => selectChain);
      selectChain.is = vi.fn(() =>
        Promise.resolve({
          data: opts.matchIds.map((id) => ({ id })),
          error: null,
        }),
      );

      const updateChain = {
        update: vi.fn((payload: Record<string, unknown>) => {
          const tail: Record<string, unknown> = {};
          tail.eq = vi.fn((_col: string, val: string) => {
            nextEqId = val;
            return tail;
          });
          tail.is = vi.fn(() => {
            updateCalls.push({ payload, id: nextEqId });
            return Promise.resolve({ error: null });
          });
          return tail;
        }),
      };
      return { ...selectChain, ...updateChain };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from, _updates: updateCalls };
}

beforeEach(() => cacheTest.clearAll());
afterEach(() => cacheTest.clearAll());

describe("reorderMatches (Plan 27)", () => {
  it("rejects when actor lacks matches.edit", async () => {
    const sb = mkReorderSb({ rolePerms: { player: ["matches.read"] }, matchIds: ["a", "b"] });
    await expect(
      reorderMatches(sb as never, { userId: "u", roles: ["player"] }, "md-1", ["a", "b"]),
    ).rejects.toThrow(/missing permission/);
  });

  it("rejects when an id is not in the match day", async () => {
    const sb = mkReorderSb({ rolePerms: { admin: ["*"] }, matchIds: ["a", "b"] });
    await expect(
      reorderMatches(sb as never, { userId: "u", roles: ["admin"] }, "md-1", ["a", "stranger"]),
    ).rejects.toThrow(/not in match_day/);
  });

  it("rejects duplicate ids", async () => {
    const sb = mkReorderSb({ rolePerms: { admin: ["*"] }, matchIds: ["a", "b"] });
    await expect(
      reorderMatches(sb as never, { userId: "u", roles: ["admin"] }, "md-1", ["a", "a"]),
    ).rejects.toThrow(/duplicate/);
  });

  it("writes match_order = i+1 for each id in order", async () => {
    const sb = mkReorderSb({ rolePerms: { admin: ["*"] }, matchIds: ["a", "b", "c"] });
    await reorderMatches(
      sb as never,
      { userId: "u", roles: ["admin"] },
      "md-1",
      ["c", "a", "b"],
    );
    expect(sb._updates).toEqual([
      { id: "c", payload: expect.objectContaining({ match_order: 1 }) },
      { id: "a", payload: expect.objectContaining({ match_order: 2 }) },
      { id: "b", payload: expect.objectContaining({ match_order: 3 }) },
    ]);
  });

  it("idempotent — running the same order twice yields the same final state", async () => {
    const sb1 = mkReorderSb({ rolePerms: { admin: ["*"] }, matchIds: ["a", "b", "c"] });
    await reorderMatches(sb1 as never, { userId: "u", roles: ["admin"] }, "md", ["a", "b", "c"]);
    const sb2 = mkReorderSb({ rolePerms: { admin: ["*"] }, matchIds: ["a", "b", "c"] });
    await reorderMatches(sb2 as never, { userId: "u", roles: ["admin"] }, "md", ["a", "b", "c"]);
    // Second run produces the same per-id match_order assignments.
    expect(sb1._updates.map((c) => ({ id: c.id, n: c.payload.match_order }))).toEqual(
      sb2._updates.map((c) => ({ id: c.id, n: c.payload.match_order })),
    );
  });

  it("a single neighbor swap reverses cleanly when re-applied", async () => {
    // Start: [a, b, c]. Swap b up → [b, a, c]. Swap b back down → [a, b, c].
    const order1 = ["b", "a", "c"];
    const order2 = ["a", "b", "c"];
    const sb1 = mkReorderSb({ rolePerms: { admin: ["*"] }, matchIds: ["a", "b", "c"] });
    await reorderMatches(sb1 as never, { userId: "u", roles: ["admin"] }, "md", order1);
    const sb2 = mkReorderSb({ rolePerms: { admin: ["*"] }, matchIds: ["a", "b", "c"] });
    await reorderMatches(sb2 as never, { userId: "u", roles: ["admin"] }, "md", order2);
    expect(sb1._updates.map((c) => c.id)).toEqual(order1);
    expect(sb2._updates.map((c) => c.id)).toEqual(order2);
  });

  it("empty array no-ops without DB calls or perm errors", async () => {
    const sb = mkReorderSb({ rolePerms: { admin: ["*"] }, matchIds: ["a"] });
    await reorderMatches(sb as never, { userId: "u", roles: ["admin"] }, "md", []);
    expect(sb._updates).toEqual([]);
  });
});
