import { describe, it, expect, vi } from "vitest";
import { getStatusForPlayerWeek } from "./status";

function mkSb(row: Record<string, unknown> | null) {
  return {
    from: vi.fn((t: string) => {
      if (t !== "content_obligation_status") throw new Error(`unexpected ${t}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
            })),
          })),
        })),
      };
    }),
  } as never;
}

describe("getStatusForPlayerWeek", () => {
  it("returns met=true when >=2 platforms verified", async () => {
    const sb = mkSb({
      player_id: "p-1",
      week_start: "2026-05-04",
      post_count: 3,
      verified_platforms: 2,
      met: true,
    });
    const s = await getStatusForPlayerWeek(sb, "p-1", "2026-05-04");
    expect(s.met).toBe(true);
    expect(s.verified_platforms).toBe(2);
  });

  it("returns met=false when view reports <2 verified platforms", async () => {
    const sb = mkSb({
      player_id: "p-1",
      week_start: "2026-05-04",
      post_count: 3,
      verified_platforms: 1,
      met: false,
    });
    const s = await getStatusForPlayerWeek(sb, "p-1", "2026-05-04");
    expect(s.met).toBe(false);
  });

  it("returns synthesised zero-row when no posts exist yet", async () => {
    const sb = mkSb(null);
    const s = await getStatusForPlayerWeek(sb, "p-1", "2026-05-04");
    expect(s.met).toBe(false);
    expect(s.post_count).toBe(0);
    expect(s.verified_platforms).toBe(0);
  });
});
