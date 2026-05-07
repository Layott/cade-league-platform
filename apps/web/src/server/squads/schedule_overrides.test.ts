import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn().mockResolvedValue(undefined),
  PermissionError: class extends Error {},
}));

import {
  getMatchDayScheduleOverride,
  setMatchDayScheduleOverride,
  clearMatchDayScheduleOverride,
} from "./schedule_overrides";

type Row = {
  id: string;
  match_day_id: string;
  submission_open_at: string | null;
  submission_deadline_at: string | null;
  change_window_open_at: string | null;
  change_window_close_at: string | null;
  notes: string | null;
  set_by: string | null;
  set_at: string;
};

type SbOpts = {
  existing?: Row | null;
  insertedRow?: Row;
  updatedRow?: Row;
  insertError?: { message: string } | null;
  updateError?: { message: string } | null;
  selectError?: { message: string } | null;
};

function mkSb(opts: SbOpts) {
  // Track which sequential maybeSingle call returns what.
  // First select: getter / pre-upsert existence check.
  // Second select after insert: returns insertedRow.
  // Second select after update: returns updatedRow.
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.existing ?? null, error: opts.selectError ?? null });
  const insertSingle = vi
    .fn()
    .mockResolvedValue({
      data: opts.insertedRow ?? null,
      error: opts.insertError ?? null,
    });
  const updateSingle = vi
    .fn()
    .mockResolvedValue({
      data: opts.updatedRow ?? null,
      error: opts.updateError ?? null,
    });
  const updateEqIs = vi.fn().mockResolvedValue({ error: null });

  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({ single: insertSingle })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({ single: updateSingle })),
          is: updateEqIs,
        })),
      })),
    })),
    _spies: { maybeSingle, insertSingle, updateSingle, updateEqIs },
  };
}

const ACTOR = { userId: "u-1", roles: ["admin"] };
const MATCH_DAY = "00000000-0000-4000-8000-000000000001";
const ROW: Row = {
  id: "00000000-0000-4000-8000-00000000aaaa",
  match_day_id: MATCH_DAY,
  submission_open_at: null,
  submission_deadline_at: "2026-04-23T13:00:00+01:00",
  change_window_open_at: "2026-04-24T20:00:00+01:00",
  change_window_close_at: "2026-04-24T21:00:00+01:00",
  notes: "extended deadline — power outage",
  set_by: "u-1",
  set_at: "2026-04-22T20:00:00Z",
};

describe("getMatchDayScheduleOverride", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no row exists", async () => {
    const sb = mkSb({ existing: null });
    const out = await getMatchDayScheduleOverride(sb as never, MATCH_DAY);
    expect(out).toBeNull();
  });

  it("maps row fields to camelCase shape", async () => {
    const sb = mkSb({ existing: ROW });
    const out = await getMatchDayScheduleOverride(sb as never, MATCH_DAY);
    expect(out).toEqual({
      id: ROW.id,
      matchDayId: MATCH_DAY,
      submissionOpenAt: null,
      submissionDeadlineAt: "2026-04-23T13:00:00+01:00",
      changeWindowOpenAt: "2026-04-24T20:00:00+01:00",
      changeWindowCloseAt: "2026-04-24T21:00:00+01:00",
      notes: "extended deadline — power outage",
      setBy: "u-1",
      setAt: "2026-04-22T20:00:00Z",
    });
  });
});

describe("setMatchDayScheduleOverride", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts when no row exists", async () => {
    const sb = mkSb({ existing: null, insertedRow: ROW });
    const out = await setMatchDayScheduleOverride(
      sb as never,
      ACTOR,
      MATCH_DAY,
      {
        submissionOpenAt: null,
        submissionDeadlineAt: "2026-04-23T13:00:00+01:00",
        changeWindowOpenAt: "2026-04-24T20:00:00+01:00",
        changeWindowCloseAt: "2026-04-24T21:00:00+01:00",
        notes: "extended deadline — power outage",
      },
    );
    expect(out.matchDayId).toBe(MATCH_DAY);
    expect(out.submissionDeadlineAt).toBe("2026-04-23T13:00:00+01:00");
    expect(sb._spies.insertSingle).toHaveBeenCalled();
    expect(sb._spies.updateSingle).not.toHaveBeenCalled();
  });

  it("updates when an active row already exists", async () => {
    const sb = mkSb({ existing: ROW, updatedRow: { ...ROW, notes: "new note" } });
    const out = await setMatchDayScheduleOverride(
      sb as never,
      ACTOR,
      MATCH_DAY,
      {
        submissionOpenAt: null,
        submissionDeadlineAt: "2026-04-23T13:00:00+01:00",
        changeWindowOpenAt: null,
        changeWindowCloseAt: null,
        notes: "new note",
      },
    );
    expect(out.notes).toBe("new note");
    expect(sb._spies.updateSingle).toHaveBeenCalled();
    expect(sb._spies.insertSingle).not.toHaveBeenCalled();
  });

  it("rejects all-null payloads", async () => {
    const sb = mkSb({ existing: null });
    await expect(
      setMatchDayScheduleOverride(sb as never, ACTOR, MATCH_DAY, {
        submissionOpenAt: null,
        submissionDeadlineAt: null,
        changeWindowOpenAt: null,
        changeWindowCloseAt: null,
        notes: null,
      }),
    ).rejects.toThrow(/at least one time boundary must be set/);
  });

  it("throws when actor has no userId", async () => {
    const sb = mkSb({ existing: null });
    await expect(
      setMatchDayScheduleOverride(
        sb as never,
        { userId: null, roles: ["admin"] },
        MATCH_DAY,
        {
          submissionOpenAt: null,
          submissionDeadlineAt: "2026-04-23T13:00:00+01:00",
          changeWindowOpenAt: null,
          changeWindowCloseAt: null,
          notes: null,
        },
      ),
    ).rejects.toThrow(/no actor\.userId/);
  });

  it("rejects window where open >= close", async () => {
    const sb = mkSb({ existing: null });
    await expect(
      setMatchDayScheduleOverride(sb as never, ACTOR, MATCH_DAY, {
        submissionOpenAt: null,
        submissionDeadlineAt: null,
        changeWindowOpenAt: "2026-04-24T22:00:00+01:00",
        changeWindowCloseAt: "2026-04-24T20:00:00+01:00",
        notes: null,
      }),
    ).rejects.toThrow(/earlier than/);
  });

  it("rejects when submission_open_at >= submission_deadline_at", async () => {
    const sb = mkSb({ existing: null });
    await expect(
      setMatchDayScheduleOverride(sb as never, ACTOR, MATCH_DAY, {
        submissionOpenAt: "2026-04-23T14:00:00+01:00",
        submissionDeadlineAt: "2026-04-23T13:00:00+01:00",
        changeWindowOpenAt: null,
        changeWindowCloseAt: null,
        notes: null,
      }),
    ).rejects.toThrow(/submission_open_at must be earlier/);
  });
});

describe("clearMatchDayScheduleOverride", () => {
  beforeEach(() => vi.clearAllMocks());

  it("soft-deletes the matching row", async () => {
    const sb = mkSb({ existing: ROW });
    await clearMatchDayScheduleOverride(sb as never, ACTOR, MATCH_DAY);
    expect(sb.from).toHaveBeenCalledWith("match_day_schedule_overrides");
    expect(sb._spies.updateEqIs).toHaveBeenCalled();
  });
});
