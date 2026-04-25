import { describe, it, expect, vi } from "vitest";
import { listStandings } from "./read";
import { recomputeStandings } from ".";

describe("recomputeStandings (wrapper around SQL fn)", () => {
  function mkSb(rpcResult: { error: { message: string } | null }) {
    const send = vi.fn().mockResolvedValue("ok");
    const channel = vi.fn(() => ({ send }));
    const removeChannel = vi.fn();
    const rpc = vi.fn().mockResolvedValue(rpcResult);
    return {
      sb: { rpc, channel, removeChannel } as unknown as never,
      rpc,
      channel,
      send,
    };
  }

  it("calls rpc('recompute_standings', { p_season_id })", async () => {
    const { sb, rpc } = mkSb({ error: null });
    await recomputeStandings(sb, "s-1");
    expect(rpc).toHaveBeenCalledWith("recompute_standings", { p_season_id: "s-1" });
  });

  it("throws when rpc returns error", async () => {
    const { sb } = mkSb({ error: { message: "boom" } });
    await expect(recomputeStandings(sb, "s-1")).rejects.toThrow(/boom/);
  });

  it("Plan 51: publishes standings.changed after successful recompute", async () => {
    const { sb, channel, send } = mkSb({ error: null });
    await recomputeStandings(sb, "s-99");
    expect(channel).toHaveBeenCalledWith("public:standings:s-99");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "broadcast",
        event: "standings.changed",
      }),
    );
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
