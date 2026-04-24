import { describe, it, expect, vi } from "vitest";
import { unvoidMatchResult } from "./results";

const MATCH_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

function mkSb(existing: {
  id: string;
  result_type: string;
  voided_by_action_id: string | null;
  notes: string | null;
} | null) {
  const deleteCalls: string[] = [];
  const statusCalls: Array<{ id: string; status: string }> = [];
  return {
    sb: {
      from: vi.fn((t: string) => {
        if (t === "match_results") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: existing, error: null }),
                })),
              })),
            })),
            delete: vi.fn(() => ({
              eq: vi.fn((_col: string, val: string) => {
                deleteCalls.push(val);
                return Promise.resolve({ data: null, error: null });
              }),
            })),
          };
        }
        if (t === "matches") {
          return {
            update: vi.fn((patch: { status: string }) => ({
              eq: vi.fn((_col: string, val: string) => {
                statusCalls.push({ id: val, status: patch.status });
                return Promise.resolve({ data: null, error: null });
              }),
            })),
          };
        }
        throw new Error(`unexpected ${t}`);
      }),
    } as never,
    deleteCalls,
    statusCalls,
  };
}

describe("unvoidMatchResult (Plan 50)", () => {
  it("deletes the void row + flips match status to scheduled", async () => {
    const { sb, deleteCalls, statusCalls } = mkSb({
      id: "r-1",
      result_type: "void",
      voided_by_action_id: "act-1",
      notes: "auto-voided: suspension action act-1",
    });
    await unvoidMatchResult(sb, {
      matchId: MATCH_ID,
      actorUserId: ACTOR,
      reason: "match was actually played before ban was backdated",
    });
    expect(deleteCalls).toEqual(["r-1"]);
    expect(statusCalls).toEqual([{ id: MATCH_ID, status: "scheduled" }]);
  });

  it("rejects when no result exists", async () => {
    const { sb } = mkSb(null);
    await expect(
      unvoidMatchResult(sb, {
        matchId: MATCH_ID,
        actorUserId: ACTOR,
        reason: "whatever",
      }),
    ).rejects.toThrow(/no result/);
  });

  it("rejects when the result exists but isn't voided", async () => {
    const { sb } = mkSb({
      id: "r-2",
      result_type: "normal",
      voided_by_action_id: null,
      notes: null,
    });
    await expect(
      unvoidMatchResult(sb, {
        matchId: MATCH_ID,
        actorUserId: ACTOR,
        reason: "whatever",
      }),
    ).rejects.toThrow(/not currently voided/);
  });

  it("rejects when reason is whitespace-only", async () => {
    const { sb } = mkSb({
      id: "r-3",
      result_type: "void",
      voided_by_action_id: "act-1",
      notes: null,
    });
    await expect(
      unvoidMatchResult(sb, {
        matchId: MATCH_ID,
        actorUserId: ACTOR,
        reason: "   ",
      }),
    ).rejects.toThrow(/reason/);
  });
});
