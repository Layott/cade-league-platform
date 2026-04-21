import { describe, it, expect, vi, beforeEach } from "vitest";
import { markAttendance } from "./attendance";

const SHOOT = "11111111-1111-4111-8111-111111111111";
const PLAYER = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

const issueMock = vi.fn();
vi.mock("@/server/punishments", () => ({
  issue: (...args: unknown[]) => issueMock(...args),
}));

type AttRow = {
  id: string;
  shoot_id: string;
  player_id: string;
  attended_bool: boolean;
  warning_issued_bool: boolean;
  warning_action_id: string | null;
  notes: string | null;
};

function mkSb(opts: {
  existing?: AttRow | null;
  insertRow?: AttRow | null;
  updateAfterMark?: AttRow | null;
  updateAfterWarning?: AttRow | null;
}) {
  let updateCallCount = 0;
  return {
    from: vi.fn((t: string) => {
      if (t !== "preseason_shoot_attendance") throw new Error(`unexpected ${t}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: opts.existing ?? null,
                  error: null,
                }),
              })),
            })),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: opts.insertRow ?? null,
              error: opts.insertRow ? null : { message: "insert fail" },
            }),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockImplementation(() => {
                updateCallCount += 1;
                // First update = post-mark row; second = post-warning row.
                if (updateCallCount === 1) {
                  return Promise.resolve({
                    data: opts.updateAfterMark ?? null,
                    error: opts.updateAfterMark
                      ? null
                      : { message: "update fail" },
                  });
                }
                return Promise.resolve({
                  data: opts.updateAfterWarning ?? null,
                  error: opts.updateAfterWarning
                    ? null
                    : { message: "update fail 2" },
                });
              }),
            })),
          })),
        })),
      };
    }),
  } as never;
}

describe("markAttendance", () => {
  beforeEach(() => {
    issueMock.mockReset();
    issueMock.mockResolvedValue({ caseId: "c-1", actionId: "a-1" });
  });

  it("present player: no warning issued, no punishment call", async () => {
    const sb = mkSb({
      existing: null,
      insertRow: {
        id: "att-1",
        shoot_id: SHOOT,
        player_id: PLAYER,
        attended_bool: true,
        warning_issued_bool: false,
        warning_action_id: null,
        notes: null,
      },
    });
    const row = await markAttendance(sb, {
      shootId: SHOOT,
      playerId: PLAYER,
      attended: true,
      actorUserId: ACTOR,
    });
    expect(row.attended_bool).toBe(true);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("absent player: auto-warning issued once", async () => {
    const sb = mkSb({
      existing: null,
      insertRow: {
        id: "att-2",
        shoot_id: SHOOT,
        player_id: PLAYER,
        attended_bool: false,
        warning_issued_bool: false,
        warning_action_id: null,
        notes: null,
      },
      updateAfterMark: {
        id: "att-2",
        shoot_id: SHOOT,
        player_id: PLAYER,
        attended_bool: false,
        warning_issued_bool: true,
        warning_action_id: "a-1",
        notes: null,
      },
    });
    const row = await markAttendance(sb, {
      shootId: SHOOT,
      playerId: PLAYER,
      attended: false,
      actorUserId: ACTOR,
    });
    expect(issueMock).toHaveBeenCalledTimes(1);
    expect(issueMock).toHaveBeenCalledWith(
      expect.anything(),
      ACTOR,
      expect.objectContaining({
        incidentType: "preseason_miss",
        sanctionType: "warning",
        playerId: PLAYER,
      }),
    );
    expect(row.warning_issued_bool).toBe(true);
    expect(row.warning_action_id).toBe("a-1");
  });

  it("idempotent: re-marking an already-warned absent row does not re-issue", async () => {
    const existing: AttRow = {
      id: "att-3",
      shoot_id: SHOOT,
      player_id: PLAYER,
      attended_bool: false,
      warning_issued_bool: true,
      warning_action_id: "a-prev",
      notes: null,
    };
    const sb = mkSb({
      existing,
      updateAfterMark: existing,
    });
    const row = await markAttendance(sb, {
      shootId: SHOOT,
      playerId: PLAYER,
      attended: false,
      actorUserId: ACTOR,
    });
    expect(issueMock).not.toHaveBeenCalled();
    expect(row.warning_action_id).toBe("a-prev");
  });

  it("flipping from absent-with-warning to present: NO new warning", async () => {
    const existing: AttRow = {
      id: "att-4",
      shoot_id: SHOOT,
      player_id: PLAYER,
      attended_bool: false,
      warning_issued_bool: true,
      warning_action_id: "a-prev",
      notes: null,
    };
    const sb = mkSb({
      existing,
      updateAfterMark: { ...existing, attended_bool: true },
    });
    const row = await markAttendance(sb, {
      shootId: SHOOT,
      playerId: PLAYER,
      attended: true,
      actorUserId: ACTOR,
    });
    expect(issueMock).not.toHaveBeenCalled();
    expect(row.attended_bool).toBe(true);
  });
});
