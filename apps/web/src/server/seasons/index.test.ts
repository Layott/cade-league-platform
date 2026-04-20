import { describe, it, expect, vi } from "vitest";
import { getActiveSeason, getSeasonById } from "./index";

function sbWith(data: unknown, error: unknown = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data, error }),
          })),
          maybeSingle: vi.fn().mockResolvedValue({ data, error }),
        })),
      })),
    })),
  };
}

describe("seasons module", () => {
  it("getActiveSeason returns the single active season row", async () => {
    const row = {
      id: "season-1",
      year_range: "2025-2026",
      division_name: "Division 1 Elite",
      status: "active",
    };
    const sb = sbWith(row);
    const result = await getActiveSeason(sb as never);
    expect(result).toEqual(row);
    expect(sb.from).toHaveBeenCalledWith("seasons");
  });

  it("getActiveSeason returns null when no active season", async () => {
    const sb = sbWith(null);
    const result = await getActiveSeason(sb as never);
    expect(result).toBeNull();
  });

  it("getSeasonById looks up by id", async () => {
    const row = {
      id: "season-7",
      year_range: "2025-2026",
      division_name: "Division 1 Elite",
      status: "active",
    };
    const sb = sbWith(row);
    const result = await getSeasonById(sb as never, "season-7");
    expect(result).toEqual(row);
  });
});
