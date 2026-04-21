import { describe, it, expect, vi } from "vitest";
import { adjustPrecedent, AdjustPrecedentError } from "./adjust";

function mkSb(precedentRow: { offense_count: number } | null) {
  const insertedRows: unknown[] = [];
  const updatedRows: unknown[] = [];

  const readChain = () => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: precedentRow, error: null }),
          })),
        })),
      })),
    })),
    insert: vi.fn((payload: unknown) => {
      insertedRows.push(payload);
      return Promise.resolve({ error: null });
    }),
    update: vi.fn((payload: unknown) => {
      updatedRows.push(payload);
      return {
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
    }),
  });

  return {
    insertedRows,
    updatedRows,
    client: { from: vi.fn(() => readChain()) } as never,
  };
}

describe("adjustPrecedent", () => {
  it("+1 on existing row updates offense_count to N+1", async () => {
    const { client, updatedRows } = mkSb({ offense_count: 2 });
    await adjustPrecedent(client, "actor-1", {
      playerId: "p-1",
      category: "late_arrival",
      delta: 1,
      reason: "manual correction for LOC paperwork",
    });
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]).toMatchObject({ offense_count: 3 });
  });

  it("rejects reason shorter than 6 chars", async () => {
    const { client } = mkSb({ offense_count: 2 });
    await expect(
      adjustPrecedent(client, "actor-1", {
        playerId: "p-1",
        category: "late_arrival",
        delta: 1,
        reason: "nope",
      }),
    ).rejects.toBeInstanceOf(AdjustPrecedentError);
  });

  it("+1 on missing row inserts offense_count=1; -1 on missing row refuses", async () => {
    const { client: insertClient, insertedRows } = mkSb(null);
    await adjustPrecedent(insertClient, "actor-1", {
      playerId: "p-2",
      category: "absent",
      delta: 1,
      reason: "LOC-noted no-show prior to Plan 11 rollout",
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ offense_count: 1 });

    const { client: refuseClient } = mkSb(null);
    await expect(
      adjustPrecedent(refuseClient, "actor-1", {
        playerId: "p-3",
        category: "absent",
        delta: -1,
        reason: "attempting to decrement nothing",
      }),
    ).rejects.toBeInstanceOf(AdjustPrecedentError);
  });
});
