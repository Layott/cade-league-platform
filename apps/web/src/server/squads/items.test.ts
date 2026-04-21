import { describe, it, expect, vi } from "vitest";
import { replaceItemsForSubmission } from "./items";

function mkSb(opts: {
  submission?: { id: string; validation_status: string } | null;
  softDelEqErr?: { message: string } | null;
  insertErr?: { message: string } | null;
}) {
  const submission = opts.submission ?? { id: "s1", validation_status: "pending" };
  const softDeleteCalls: unknown[] = [];

  return {
    softDeleteCalls,
    from: vi.fn((table: string) => {
      if (table === "squad_submissions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: submission, error: null }),
              })),
            })),
          })),
        };
      }
      if (table === "squad_player_items") {
        return {
          update: vi.fn((payload: unknown) => {
            softDeleteCalls.push(payload);
            return {
              eq: vi.fn(() => ({
                is: vi
                  .fn()
                  .mockResolvedValue({ error: opts.softDelEqErr ?? null }),
              })),
            };
          }),
          insert: vi.fn().mockResolvedValue({ error: opts.insertErr ?? null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

const items = [
  {
    name: "A",
    rating: 80,
    position: "ST",
    value: 10_000,
    itemType: "gold" as const,
    nationalityFlag: "NG",
    slotIndex: 0,
  },
];

describe("replaceItemsForSubmission", () => {
  it("soft-deletes prior items and inserts new set", async () => {
    const sb = mkSb({});
    await replaceItemsForSubmission(sb as never, "sub-1", items);
    expect((sb.softDeleteCalls[0] as { deleted_at: string }).deleted_at).toBeTruthy();
  });

  it("refuses when submission is already approved", async () => {
    const sb = mkSb({
      submission: { id: "s1", validation_status: "approved" },
    });
    await expect(
      replaceItemsForSubmission(sb as never, "sub-1", items),
    ).rejects.toThrow(/cannot edit items/i);
  });
});
