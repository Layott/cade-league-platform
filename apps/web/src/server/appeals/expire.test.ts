import { describe, it, expect, vi } from "vitest";
import { markExpired } from "./expire";

function mkSb(rowsUpdated: Array<{ id: string }>) {
  // Full chain mock: update().in().lt().is().select()
  const selectFn = vi.fn().mockResolvedValue({ data: rowsUpdated, error: null });
  const isFn = vi.fn(() => ({ select: selectFn }));
  const ltFn = vi.fn(() => ({ is: isFn }));
  const inFn = vi.fn(() => ({ lt: ltFn }));
  const updateFn = vi.fn(() => ({ in: inFn }));
  return {
    sb: { from: vi.fn(() => ({ update: updateFn })) } as never,
    spies: { selectFn, isFn, ltFn, inFn, updateFn },
  };
}

describe("markExpired", () => {
  it("returns the count of expired appeals", async () => {
    const { sb } = mkSb([{ id: "a-1" }, { id: "a-2" }]);
    const out = await markExpired(sb, new Date("2026-05-20T12:00:00Z"));
    expect(out.expired).toBe(2);
  });

  it("returns 0 when nothing is overdue", async () => {
    const { sb } = mkSb([]);
    const out = await markExpired(sb, new Date());
    expect(out.expired).toBe(0);
  });

  it("is idempotent — re-running returns 0", async () => {
    const { sb } = mkSb([]);
    expect((await markExpired(sb)).expired).toBe(0);
    expect((await markExpired(sb)).expired).toBe(0);
  });
});
