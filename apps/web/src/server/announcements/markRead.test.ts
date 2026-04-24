import { describe, it, expect, vi } from "vitest";
import { markRead } from "./index";

function mkSb(rowsFlipped: Array<{ id: string }> = [{ id: "n-flipped" }]) {
  const updateCalls: unknown[] = [];
  return {
    _updateCalls: updateCalls,
    from: vi.fn(() => ({
      update: vi.fn((patch: unknown) => {
        updateCalls.push(patch);
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                select: vi
                  .fn()
                  .mockResolvedValue({ data: rowsFlipped, error: null }),
              })),
            })),
          })),
        };
      }),
    })),
  };
}

describe("markRead", () => {
  it("sets read_at once; second call matches zero rows (terminal select returns empty)", async () => {
    const sb = mkSb([{ id: "n1" }]);
    const flipped1 = await markRead(sb as never, "n1", "u1");
    expect(flipped1).toBe(1);

    // Second call — fresh stub returns empty to mirror "already read".
    const sb2 = mkSb([]);
    const flipped2 = await markRead(sb2 as never, "n1", "u1");
    expect(flipped2).toBe(0);

    // Both calls patched read_at — second would match zero rows in real DB.
    const patches = sb._updateCalls as Array<{ read_at: string }>;
    expect(patches[0].read_at).toBeTruthy();
  });
});
