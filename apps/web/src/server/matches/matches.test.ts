import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMatch, editMatch, softDeleteMatch, voidMatch } from "./matches";

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
