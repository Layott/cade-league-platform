import { describe, it, expect, vi } from "vitest";
import { createSubmission } from "./submit";

const UUID_S = "11111111-1111-4111-8111-111111111111";
const UUID_P = "22222222-2222-4222-8222-222222222222";

function mkSb(opts: {
  existing?: { id: string } | null;
  insertedId?: string;
  itemsErr?: { message: string } | null;
}) {
  const insertedId = opts.insertedId ?? "sub-1";
  const deleteFromSubmissions = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }));
  const itemsInsert = vi.fn(() => ({ error: opts.itemsErr ?? null }));

  return {
    itemsInsert,
    deleteFromSubmissions,
    from: vi.fn((table: string) => {
      if (table === "squad_submissions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: opts.existing ?? null, error: null }),
                })),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: insertedId },
                error: null,
              }),
            })),
          })),
          delete: deleteFromSubmissions,
        };
      }
      if (table === "squad_player_items") {
        return {
          insert: (rows: unknown[]) => itemsInsert(rows),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function mkInput(over: Partial<Parameters<typeof createSubmission>[1]> = {}) {
  return {
    seasonId: UUID_S,
    playerId: UUID_P,
    weekStartDate: "2026-04-16",
    futbinScreenshotPath: "seasons/s/players/p/weeks/2026-04-16/a.png",
    items: [
      {
        name: "Maddison",
        rating: 84,
        position: "CAM",
        value: 100_000,
        itemType: "gold" as const,
        nationalityFlag: "GB",
        slotIndex: 0,
      },
    ],
    ...over,
  };
}

describe("createSubmission", () => {
  it("happy path inserts submission + items and returns the id", async () => {
    const sb = mkSb({});
    const out = await createSubmission(sb as never, mkInput(), {
      now: new Date("2026-04-16T08:00:00+01:00"),
    });
    expect(out.id).toBe("sub-1");
    expect(sb.itemsInsert).toHaveBeenCalledTimes(1);
  });

  it("throws ConflictError when live submission exists for the week", async () => {
    const sb = mkSb({ existing: { id: "existing" } });
    await expect(
      createSubmission(sb as never, mkInput(), {
        now: new Date("2026-04-16T08:00:00+01:00"),
      }),
    ).rejects.toThrow(/submission already exists/i);
  });

  it("rejects weekStartDate that doesn't match the current Thursday anchor", async () => {
    const sb = mkSb({});
    await expect(
      createSubmission(
        sb as never,
        mkInput({ weekStartDate: "2026-04-09" }),
        { now: new Date("2026-04-16T08:00:00+01:00") },
      ),
    ).rejects.toThrow(/does not match current week anchor/i);
  });

  it("rolls back the submission if item insert fails", async () => {
    const sb = mkSb({ itemsErr: { message: "boom" } });
    await expect(
      createSubmission(sb as never, mkInput(), {
        now: new Date("2026-04-16T08:00:00+01:00"),
      }),
    ).rejects.toThrow(/failed to insert items/i);
    expect(sb.deleteFromSubmissions).toHaveBeenCalledTimes(1);
  });
});
