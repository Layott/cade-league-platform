import { describe, it, expect, vi, beforeEach } from "vitest";
import { markPresent, markLate, markAbsent } from "./mark";

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

function mkSb(opts: {
  matchDay?: { match_date: string; match_start_time: string; arrival_cutoff_time: string };
  existingMark?: { id: string } | null;
  insertedId?: string;
}) {
  const existingMark = opts.existingMark ?? null;
  return {
    from: vi.fn((table: string) => {
      if (table === "match_days") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: opts.matchDay ?? {
                  match_date: "2026-05-01",
                  match_start_time: "19:30:00",
                  arrival_cutoff_time: "19:15:00",
                },
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "attendance_marks") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: existingMark,
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: opts.insertedId ?? "mark-1" },
                error: null,
              }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("markPresent", () => {
  beforeEach(() => {
    openAutoCaseMock.mockReset();
    revokeAutoActionMock.mockReset();
  });

  it("inserts attendance_marks row with status=present and NO penalty", async () => {
    const sb = mkSb({});
    openAutoCaseMock.mockResolvedValue(null);

    const out = await markPresent(sb as never, {
      matchDayId: "md-1",
      playerId: "p-1",
      actorUserId: "u-1",
    });

    expect(out.id).toBe("mark-1");
    expect(openAutoCaseMock).not.toHaveBeenCalled();
  });

  it("throws ConflictError when mark already exists", async () => {
    const sb = mkSb({ existingMark: { id: "existing" } });
    await expect(
      markPresent(sb as never, {
        matchDayId: "md-1",
        playerId: "p-1",
        actorUserId: "u-1",
      })
    ).rejects.toThrow(/already marked/i);
  });
});

describe("markLate", () => {
  beforeEach(() => {
    openAutoCaseMock.mockReset();
    openAutoCaseMock.mockResolvedValue({ caseId: "c-1", actionId: "a-1" });
  });

  it("creates disciplinary_case + action of magnitude 1", async () => {
    const sb = mkSb({});
    const out = await markLate(sb as never, {
      matchDayId: "md-1",
      playerId: "p-1",
      actorUserId: "u-1",
    });
    expect(out.id).toBe("mark-1");
    expect(openAutoCaseMock).toHaveBeenCalledTimes(1);
    expect(openAutoCaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "late", playerId: "p-1" })
    );
  });
});

describe("markAbsent", () => {
  beforeEach(() => {
    openAutoCaseMock.mockReset();
    openAutoCaseMock.mockResolvedValue({ caseId: "c-1", actionId: "a-2" });
  });

  it("creates case + action with magnitude 3 semantics (via openAutoCase)", async () => {
    const sb = mkSb({});
    await markAbsent(sb as never, {
      matchDayId: "md-1",
      playerId: "p-1",
      actorUserId: "u-1",
    });
    expect(openAutoCaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "absent" })
    );
  });
});
