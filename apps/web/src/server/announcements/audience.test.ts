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
