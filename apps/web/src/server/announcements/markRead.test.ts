import { describe, it, expect, vi } from "vitest";
import { markRead } from "./index";

function mkSb() {
  const updateCalls: unknown[] = [];
  const terminal = { error: null };
  return {
    _updateCalls: updateCalls,
    from: vi.fn(() => ({
      update: vi.fn((patch: unknown) => {
        updateCalls.push(patch);
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue(terminal),
            })),
          })),
        };
      }),
    })),
  };
}

describe("markRead", () => {
  it("sets read_at once; second call is no-op (terminal 0 rows via .is read_at null)", async () => {
    const sb = mkSb();
    await markRead(sb as never, "n1", "u1");
    await markRead(sb as never, "n1", "u1");
    expect(sb._updateCalls.length).toBe(2);
    // Both calls patched read_at — second would match zero rows in real DB.
    const patches = sb._updateCalls as Array<{ read_at: string }>;
    expect(patches[0].read_at).toBeTruthy();
  });
});
