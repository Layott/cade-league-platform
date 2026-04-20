import { describe, it, expect, vi } from "vitest";
import { listForUser } from "./index";

function mkSb(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return { from: vi.fn(() => chain) };
}

describe("listForUser", () => {
  it("flattens announcement join", async () => {
    const sb = mkSb([
      {
        id: "n1",
        announcement_id: "a1",
        read_at: null,
        announcement: { title: "Hi", priority: "urgent", published_at: "2026-04-26T00:00:00Z" },
      },
    ]);
    const rows = await listForUser(sb as never, "u1");
    expect(rows).toEqual([
      {
        id: "n1",
        announcement_id: "a1",
        read_at: null,
        title: "Hi",
        priority: "urgent",
        published_at: "2026-04-26T00:00:00Z",
      },
    ]);
  });
});
