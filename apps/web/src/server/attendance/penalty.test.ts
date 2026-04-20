import { describe, it, expect, vi } from "vitest";
import { flatLadder, openAutoCase, revokeAutoAction } from "./penalty";

describe("flatLadder", () => {
  it("returns magnitude 1 for late", () => {
    expect(flatLadder("late")).toEqual({ sanction_type: "point_deduction", magnitude: 1 });
  });
  it("returns magnitude 3 for absent", () => {
    expect(flatLadder("absent")).toEqual({ sanction_type: "point_deduction", magnitude: 3 });
  });
  it("returns null for present", () => {
    expect(flatLadder("present")).toBeNull();
  });
});

describe("openAutoCase", () => {
  function mkSb() {
    const insertedCase = vi.fn().mockResolvedValue({
      data: { id: "case-1" },
      error: null,
    });
    const insertedAction = vi.fn().mockResolvedValue({
      data: { id: "action-1" },
      error: null,
    });

    return {
      insertedCase,
      insertedAction,
      from: vi.fn((table: string) => {
        if (table === "disciplinary_cases") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: insertedCase,
              })),
            })),
          };
        }
        if (table === "disciplinary_actions") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: insertedAction,
              })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
  }

  it("creates case + action for late", async () => {
    const sb = mkSb();
    const out = await openAutoCase(sb as never, {
      playerId: "p-1",
      status: "late",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(out).toEqual({ caseId: "case-1", actionId: "action-1" });
    expect(sb.from).toHaveBeenCalledWith("disciplinary_cases");
    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
  });

  it("creates case + action for absent", async () => {
    const sb = mkSb();
    await openAutoCase(sb as never, {
      playerId: "p-1",
      status: "absent",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
  });

  it("returns null for present", async () => {
    const sb = mkSb();
    const out = await openAutoCase(sb as never, {
      playerId: "p-1",
      status: "present",
      matchDayId: "md-1",
      actorUserId: "u-1",
      effectiveDate: "2026-05-01",
    });
    expect(out).toBeNull();
    expect(sb.from).not.toHaveBeenCalled();
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
      })
    );
    expect(eq).toHaveBeenCalledWith("id", "action-1");
  });
});
