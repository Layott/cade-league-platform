import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMatch, voidMatch } from "./matches";

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
