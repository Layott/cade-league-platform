import { describe, it, expect, vi } from "vitest";
import {
  appealRevokeReason,
  parseAppealIdFromReason,
  onAppealUpheld,
  onAppealUndo,
} from "./effects";

const APPEAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTION_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACTOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("appealRevokeReason / parseAppealIdFromReason", () => {
  it("round-trips the appeal id", () => {
    const reason = appealRevokeReason(
      APPEAL_ID,
      "ref error — goal was onside",
      new Date("2026-04-25T12:34:56Z"),
    );
    expect(reason.startsWith(`[appeal:${APPEAL_ID}]`)).toBe(true);
    expect(reason).toContain("Upheld on 2026-04-25");
    expect(reason).toContain("ref error");
    expect(parseAppealIdFromReason(reason)).toBe(APPEAL_ID);
  });

  it("returns null for non-appeal reasons", () => {
    expect(parseAppealIdFromReason(null)).toBeNull();
    expect(parseAppealIdFromReason("admin typo cleanup")).toBeNull();
    expect(parseAppealIdFromReason("[audit:123] something")).toBeNull();
  });

  it("truncates overly long ruling snippets", () => {
    const longRuling = "x".repeat(1000);
    const reason = appealRevokeReason(
      APPEAL_ID,
      longRuling,
      new Date("2026-04-25T00:00:00Z"),
    );
    // 200 char cap on the snippet + the fixed prefix bytes.
    expect(reason.length).toBeLessThan(300);
    expect(parseAppealIdFromReason(reason)).toBe(APPEAL_ID);
  });
});

function mkSupabase(opts: {
  liveActions: Array<{
    id: string;
    sanction_type: string;
    revoked_at: string | null;
    deleted_at: string | null;
  }>;
  appeal?: { ruling: string | null } | null;
  revokedActionsWithTag?: Array<{ id: string; revoke_reason: string | null }>;
  voidCountByActionId?: Record<string, number>;
}) {
  const revokeCalls: Array<{ actionId: string; revoked_at: string; revoke_reason: string }> = [];
  const unrevokeCalls: string[] = [];

  return {
    sb: {
      from: vi.fn((t: string) => {
        if (t === "disciplinary_actions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  is: vi.fn().mockResolvedValue({
                    data: opts.liveActions,
                    error: null,
                  }),
                })),
              })),
              ilike: vi.fn(() => ({
                is: vi.fn(() => ({
                  not: vi.fn().mockResolvedValue({
                    data: opts.revokedActionsWithTag ?? [],
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn((patch: Record<string, unknown>) => ({
              eq: vi.fn((_col: string, actionId: string) => {
                if (patch.revoked_at === null) {
                  unrevokeCalls.push(actionId);
                } else if (patch.revoked_at) {
                  revokeCalls.push({
                    actionId,
                    revoked_at: patch.revoked_at as string,
                    revoke_reason: patch.revoke_reason as string,
                  });
                }
                return Promise.resolve({ data: null, error: null });
              }),
            })),
          };
        }
        if (t === "appeals") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: opts.appeal ?? null,
                  error: null,
                }),
              })),
            })),
          };
        }
        if (t === "match_results") {
          // count(...) head:true path
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  count:
                    opts.voidCountByActionId?.[ACTION_A] ??
                    opts.voidCountByActionId?.[ACTION_B] ??
                    0,
                  data: [],
                  error: null,
                }),
              })),
            })),
          };
        }
        throw new Error(`unexpected table ${t}`);
      }),
    } as never,
    revokeCalls,
    unrevokeCalls,
  };
}

describe("onAppealUpheld", () => {
  it("revokes every live action on the case with a tagged reason", async () => {
    const { sb, revokeCalls } = mkSupabase({
      liveActions: [
        {
          id: ACTION_A,
          sanction_type: "point_deduction",
          revoked_at: null,
          deleted_at: null,
        },
        {
          id: ACTION_B,
          sanction_type: "ban",
          revoked_at: null,
          deleted_at: null,
        },
      ],
      appeal: { ruling: "panel sides with appellant — ref misread ball crossing line" },
      voidCountByActionId: { [ACTION_B]: 2 },
    });

    const summary = await onAppealUpheld(sb, {
      appealId: APPEAL_ID,
      disciplinaryCaseId: CASE_ID,
      actorUserId: ACTOR,
    });

    expect(revokeCalls).toHaveLength(2);
    for (const c of revokeCalls) {
      expect(c.revoke_reason.startsWith(`[appeal:${APPEAL_ID}]`)).toBe(true);
      expect(c.revoke_reason).toContain("panel sides with appellant");
    }
    expect(summary.appealId).toBe(APPEAL_ID);
    expect(summary.revokedActions).toHaveLength(2);
    const banRow = summary.revokedActions.find((r) => r.wasBan);
    expect(banRow).toBeDefined();
    // mk returns 2 for every row to keep the chain simple — asserts the
    // function READS the count before revoking, which is what we care
    // about (real-world test will see the correct shape).
    expect(banRow!.voidedMatchesBefore).toBeGreaterThan(0);
  });

  it("no-op when the case has zero live actions", async () => {
    const { sb, revokeCalls } = mkSupabase({ liveActions: [], appeal: null });
    const summary = await onAppealUpheld(sb, {
      appealId: APPEAL_ID,
      disciplinaryCaseId: CASE_ID,
      actorUserId: ACTOR,
    });
    expect(revokeCalls).toHaveLength(0);
    expect(summary.revokedActions).toHaveLength(0);
    expect(summary.totalMatchesUnvoided).toBe(0);
  });
});

describe("onAppealUndo", () => {
  it("un-revokes every action whose reason carries the appeal tag", async () => {
    const { sb, unrevokeCalls } = mkSupabase({
      liveActions: [],
      revokedActionsWithTag: [
        {
          id: ACTION_A,
          revoke_reason: `[appeal:${APPEAL_ID}] Upheld on 2026-04-25. Panel ruling: x`,
        },
        {
          id: ACTION_B,
          revoke_reason: `[appeal:${APPEAL_ID}] Upheld on 2026-04-25. Panel ruling: y`,
        },
      ],
    });
    const ids = await onAppealUndo(sb, APPEAL_ID);
    expect(ids).toEqual([ACTION_A, ACTION_B]);
    expect(unrevokeCalls).toEqual([ACTION_A, ACTION_B]);
  });

  it("returns empty when no tagged actions exist (dismissed appeals, legacy rows)", async () => {
    const { sb, unrevokeCalls } = mkSupabase({
      liveActions: [],
      revokedActionsWithTag: [],
    });
    const ids = await onAppealUndo(sb, APPEAL_ID);
    expect(ids).toEqual([]);
    expect(unrevokeCalls).toEqual([]);
  });
});
