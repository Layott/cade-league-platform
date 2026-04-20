import { describe, it, expect, vi, beforeEach } from "vitest";
import { editMark, ValidationError } from "./edit";

const openAutoCaseMock = vi.fn();
const revokeAutoActionMock = vi.fn();
vi.mock("./penalty", async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    openAutoCase: (...args: unknown[]) => openAutoCaseMock(...args),
    revokeAutoAction: (...args: unknown[]) => revokeAutoActionMock(...args),
  };
});

type MarkRow = {
  id: string;
  match_day_id: string;
  player_id: string;
  status: "present" | "late" | "absent";
  auto_case_id: string | null;
  auto_action_id: string | null;
};

function mkSb(row: MarkRow) {
  const state = { row: { ...row } };
  return {
    state,
    from: vi.fn((table: string) => {
      if (table === "attendance_marks") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: state.row, error: null }),
              })),
              single: vi.fn().mockResolvedValue({ data: state.row, error: null }),
            })),
          })),
          update: vi.fn((patch: Partial<MarkRow>) => {
            Object.assign(state.row, patch);
            return { eq: vi.fn().mockResolvedValue({ error: null }) };
          }),
        };
      }
      if (table === "match_days") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { match_date: "2026-05-01" },
                error: null,
              }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("editMark", () => {
  beforeEach(() => {
    openAutoCaseMock.mockReset();
    revokeAutoActionMock.mockReset();
  });

  it("rejects empty reason", async () => {
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "late",
      auto_case_id: "c",
      auto_action_id: "a",
    });
    await expect(
      editMark(sb as never, {
        markId: "m-1",
        newStatus: "present",
        reason: "   ",
        actorUserId: "u",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("late → present revokes auto-action + clears mark linkage", async () => {
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "late",
      auto_case_id: "c-1",
      auto_action_id: "a-1",
    });

    await editMark(sb as never, {
      markId: "m-1",
      newStatus: "present",
      reason: "was on call — released",
      actorUserId: "u",
    });

    expect(revokeAutoActionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionId: "a-1", reason: expect.any(String) })
    );
    expect(openAutoCaseMock).not.toHaveBeenCalled();
    expect(sb.state.row.status).toBe("present");
    expect(sb.state.row.auto_action_id).toBeNull();
    expect(sb.state.row.auto_case_id).toBeNull();
  });

  it("present → absent opens a fresh auto-case", async () => {
    openAutoCaseMock.mockResolvedValue({ caseId: "c-2", actionId: "a-2" });
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "present",
      auto_case_id: null,
      auto_action_id: null,
    });

    await editMark(sb as never, {
      markId: "m-1",
      newStatus: "absent",
      reason: "miscommunication, player never showed",
      actorUserId: "u",
    });

    expect(openAutoCaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "absent" })
    );
    expect(revokeAutoActionMock).not.toHaveBeenCalled();
    expect(sb.state.row.status).toBe("absent");
    expect(sb.state.row.auto_case_id).toBe("c-2");
    expect(sb.state.row.auto_action_id).toBe("a-2");
  });

  it("late → absent revokes old action + opens new case", async () => {
    openAutoCaseMock.mockResolvedValue({ caseId: "c-3", actionId: "a-3" });
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "late",
      auto_case_id: "c-old",
      auto_action_id: "a-old",
    });

    await editMark(sb as never, {
      markId: "m-1",
      newStatus: "absent",
      reason: "left before kickoff",
      actorUserId: "u",
    });

    expect(revokeAutoActionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionId: "a-old" })
    );
    expect(openAutoCaseMock).toHaveBeenCalled();
    expect(sb.state.row.status).toBe("absent");
    expect(sb.state.row.auto_action_id).toBe("a-3");
  });

  it("no-op same-status edit still stores reason, no penalty churn", async () => {
    const sb = mkSb({
      id: "m-1",
      match_day_id: "md",
      player_id: "p",
      status: "present",
      auto_case_id: null,
      auto_action_id: null,
    });

    await editMark(sb as never, {
      markId: "m-1",
      newStatus: "present",
      reason: "clarifying prior mark stands",
      actorUserId: "u",
    });

    expect(openAutoCaseMock).not.toHaveBeenCalled();
    expect(revokeAutoActionMock).not.toHaveBeenCalled();
    expect(sb.state.row.status).toBe("present");
  });
});
