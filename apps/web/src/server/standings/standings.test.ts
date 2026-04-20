import { describe, it, expect, vi } from "vitest";
import { listStandings } from "./read";
import { recomputeStandings } from ".";

describe("recomputeStandings (wrapper around SQL fn)", () => {
  it("calls rpc('recompute_standings', { p_season_id })", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const sb = { rpc } as unknown as never;
    await recomputeStandings(sb, "s-1");
    expect(rpc).toHaveBeenCalledWith("recompute_standings", { p_season_id: "s-1" });
  });

  it("throws when rpc returns error", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    const sb = { rpc } as unknown as never;
    await expect(recomputeStandings(sb, "s-1")).rejects.toThrow(/boom/);
  });
});

describe("listStandings", () => {
  it("resolves to [] when supabase returns no rows", async () => {
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              order: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
              })),
            })),
          })),
        })),
      })),
    } as unknown as never;
    const rows = await listStandings(sb, "s-1");
    expect(rows).toEqual([]);
  });
});
