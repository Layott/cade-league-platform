import { describe, it, expect, vi } from "vitest";
import { previewSuspensionVoids } from "./preview";

function mkSb(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        is: vi.fn(() => ({
          or: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn().mockResolvedValue({ data: rows, error: null }),
            })),
          })),
        })),
      })),
    })),
  } as never;
}

describe("previewSuspensionVoids", () => {
  it("returns matches whose match_day.match_date is in [from, until]", async () => {
    const sb = mkSb([
      {
        id: "m-1",
        home_player_id: "p-1",
        away_player_id: "p-2",
        match_day_id: "md-1",
        match_days: {
          id: "md-1",
          match_date: "2026-05-04",
          venue_name: "Venue A",
          deleted_at: null,
        },
        home: { id: "p-1", gamer_tag: "tag-1", users: { display_name: "Alice" } },
        away: { id: "p-2", gamer_tag: "tag-2", users: { display_name: "Bob" } },
      },
      {
        id: "m-2",
        home_player_id: "p-3",
        away_player_id: "p-1",
        match_day_id: "md-2",
        match_days: {
          id: "md-2",
          match_date: "2026-05-11",
          venue_name: "Venue B",
          deleted_at: null,
        },
        home: { id: "p-3", gamer_tag: "tag-3", users: { display_name: "Charlie" } },
        away: { id: "p-1", gamer_tag: "tag-1", users: { display_name: "Alice" } },
      },
    ]);
    const result = await previewSuspensionVoids(sb, "p-1", "2026-05-01", "2026-05-15");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ matchId: "m-1", opponentTag: "tag-2" });
    expect(result[1]).toMatchObject({ matchId: "m-2", opponentTag: "tag-3" });
  });

  it("returns empty array when no fixtures in window", async () => {
    const sb = mkSb([]);
    const result = await previewSuspensionVoids(sb, "p-99", "2026-05-01", "2026-05-15");
    expect(result).toEqual([]);
  });

  it("returns empty when until < from", async () => {
    const sb = mkSb([]);
    const result = await previewSuspensionVoids(sb, "p-1", "2026-05-15", "2026-05-01");
    expect(result).toEqual([]);
  });
});
