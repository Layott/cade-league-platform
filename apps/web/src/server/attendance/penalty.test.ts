import { describe, it, expect, vi } from "vitest";
import { openAutoCase, revokeAutoAction } from "./penalty";

/**
 * Plan 11 rewrite: openAutoCase now consults the Rule 5.4 ladder rather
 * than a flat -1/-3. Prior flat-ladder tests (`flatLadder returns magnitude
 * 1 for late` etc.) are DELETED — see commit message:
 *   "flatLadder returns magnitude 1 for late"
 *   "flatLadder returns magnitude 3 for absent"
 *   "flatLadder returns null for present"
 *   "openAutoCase creates case + action for late"
 *   "openAutoCase creates case + action for absent"
 * These are superseded by the precedent-aware suite below.
 */

function makeSb(opts: {
  priorCount: number;
  caseId?: string;
  actionIds?: { point?: string; gd?: string; ban?: string };
  matchDayRow?: { season_id: string; match_date: string };
  matchDaysList?: Array<{ match_date: string }>;
  matchRow?: { id: string } | null;
}) {
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const upserts: Array<{ table: string; payload: unknown }> = [];
  const updates: Array<{ table: string; payload: unknown; eq?: [string, string] }> = [];

  const {
    priorCount,
    caseId = "case-1",
    actionIds = { point: "act-pd", gd: "act-gd", ban: "act-ban" },
    matchDayRow = { season_id: "season-1", match_date: "2026-05-01" },
    matchDaysList = [{ match_date: "2026-05-01" }],
    matchRow = { id: "match-1" },
  } = opts;

  const client = {
    from: vi.fn((table: string) => {
      if (table === "disciplinary_precedents") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: priorCount > 0 ? { offense_count: priorCount } : null,
                    error: null,
                  }),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "disciplinary_cases") {
        return {
          insert: vi.fn((payload: unknown) => {
            inserts.push({ table, payload });
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { id: caseId }, error: null }),
              })),
            };
          }),
        };
      }
      if (table === "disciplinary_actions") {
        return {
          insert: vi.fn((payload: unknown) => {
            inserts.push({ table, payload });
            const p = payload as { sanction_type: string };
            const id =
              p.sanction_type === "point_deduction"
                ? actionIds.point
                : p.sanction_type === "gd_deduction"
                  ? actionIds.gd
                  : actionIds.ban;
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { id }, error: null }),
              })),
            };
          }),
        };
      }
      if (table === "match_days") {
        // Two call shapes: single-row lookup (.eq.single) and list (.eq.is.gte.order.limit)
        const chain = {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: matchDayRow, error: null }),
              is: vi.fn(() => ({
                gte: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn().mockResolvedValue({ data: matchDaysList, error: null }),
                  })),
                })),
              })),
            })),
          })),
        };
        return chain;
      }
      if (table === "matches") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              or: vi.fn(() => ({
                is: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: matchRow, error: null }),
                  })),
                })),
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }
      if (table === "match_results") {
        return {
          upsert: vi.fn((payload: unknown) => {
            upserts.push({ table, payload });
            return Promise.resolve({ error: null });
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };

  return { client: client as never, inserts, upserts, updates };
}

describe("openAutoCase — Rule 5.4 ladder integration", () => {
  it("1st late (priorCount=0) opens an auto-status case + no action inserts (warning only)", async () => {
    const { client, inserts } = makeSb({ priorCount: 0 });
    const result = await openAutoCase(client, {
      playerId: "p-1",
      status: "late",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(result).not.toBeNull();
    const caseInserts = inserts.filter((i) => i.table === "disciplinary_cases");
    const actionInserts = inserts.filter((i) => i.table === "disciplinary_actions");
    expect(caseInserts).toHaveLength(1);
    expect((caseInserts[0].payload as { status: string }).status).toBe("auto");
    expect(actionInserts).toHaveLength(0);
    expect(result?.outcome.pointDeduction).toBe(0);
    expect(result?.outcome.gdDeduction).toBe(0);
  });

  it("2nd late (priorCount=1) opens a warning case + -3 GD action", async () => {
    const { client, inserts } = makeSb({ priorCount: 1 });
    const result = await openAutoCase(client, {
      playerId: "p-1",
      status: "late",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(result?.outcome.gdDeduction).toBe(3);
    const actionInserts = inserts.filter((i) => i.table === "disciplinary_actions");
    expect(actionInserts).toHaveLength(1);
    expect((actionInserts[0].payload as { sanction_type: string }).sanction_type).toBe(
      "gd_deduction",
    );
    expect((actionInserts[0].payload as { magnitude: number }).magnitude).toBe(3);
    const caseStatus = (inserts[0].payload as { status: string }).status;
    expect(caseStatus).toBe("open");
  });

  it("4th late (priorCount=3) opens a disciplinary case + -1 point action", async () => {
    const { client, inserts } = makeSb({ priorCount: 3 });
    const result = await openAutoCase(client, {
      playerId: "p-1",
      status: "late",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(result?.outcome.pointDeduction).toBe(1);
    const actionInserts = inserts.filter((i) => i.table === "disciplinary_actions");
    expect(actionInserts).toHaveLength(1);
    const payload = actionInserts[0].payload as { sanction_type: string; magnitude: number };
    expect(payload.sanction_type).toBe("point_deduction");
    expect(payload.magnitude).toBe(1);
  });

  it("1st absent (priorCount=0) opens warning case + auto-forfeit flag set (no deductions)", async () => {
    const { client, inserts } = makeSb({ priorCount: 0 });
    const result = await openAutoCase(client, {
      playerId: "p-1",
      status: "absent",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(result?.outcome.autoForfeit).toBe(true);
    expect(result?.outcome.pointDeduction).toBe(0);
    expect(result?.outcome.gdDeduction).toBe(0);
    const actionInserts = inserts.filter((i) => i.table === "disciplinary_actions");
    expect(actionInserts).toHaveLength(0);
  });

  it("2nd absent (priorCount=1) opens disciplinary case + ban action with resolved window", async () => {
    const { client, inserts } = makeSb({
      priorCount: 1,
      matchDaysList: [{ match_date: "2026-05-01" }, { match_date: "2026-05-08" }],
    });
    const result = await openAutoCase(client, {
      playerId: "p-1",
      status: "absent",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    const actionInserts = inserts.filter((i) => i.table === "disciplinary_actions");
    const ban = actionInserts.find(
      (i) => (i.payload as { sanction_type: string }).sanction_type === "ban",
    );
    expect(ban).toBeDefined();
    const banPayload = ban!.payload as { effective_from: string; effective_until: string };
    expect(banPayload.effective_from).toBe("2026-05-01");
    expect(banPayload.effective_until).toBeDefined();
    expect(result?.outcome.suspensionMatchDays).toBeGreaterThan(0);
  });

  it("returns null for present status (no DB traffic)", async () => {
    const { client } = makeSb({ priorCount: 0 });
    const result = await openAutoCase(client, {
      playerId: "p-1",
      status: "present",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(result).toBeNull();
  });
});

describe("revokeAutoAction", () => {
  it("sets revoked_at + revoke_reason on the given action id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const sb = { from: vi.fn(() => ({ update })) };

    await revokeAutoAction(sb as never, {
      actionId: "action-1",
      reason: "attendance edit",
    });

    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        revoked_at: expect.any(String),
        revoke_reason: "attendance edit",
      }),
    );
    expect(eq).toHaveBeenCalledWith("id", "action-1");
  });
});
