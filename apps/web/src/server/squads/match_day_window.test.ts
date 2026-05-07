import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn().mockResolvedValue(undefined),
  PermissionError: class extends Error {},
}));

import {
  getMatchDayWindow,
  setMatchDayWindow,
  clearMatchDayWindow,
  resolveSquadWindowForMatchDay,
} from "./match_day_window";

type Row = {
  match_day_id: string;
  state: "force_open" | "force_close";
  note: string | null;
  set_by: string;
  set_at: string;
};

function mkSb(opts: { row?: Row | null }) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.row ?? null, error: null });
  const upsertSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.row ?? null, error: null });
  const updateEq = vi.fn(() => ({ is: vi.fn().mockResolvedValue({ error: null }) }));
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({ single: upsertSingle })),
      })),
      update: vi.fn(() => ({ eq: updateEq })),
    })),
    _spies: { maybeSingle, upsertSingle, updateEq },
  };
}

const ACTOR = { userId: "u-1", roles: ["admin"] };
const MATCH_DAY = "00000000-0000-4000-8000-000000000001";
const ROW: Row = {
  match_day_id: MATCH_DAY,
  state: "force_open",
  note: "make-up day for power outage",
  set_by: "u-1",
  set_at: "2026-04-27T20:00:00Z",
};

describe("getMatchDayWindow", () => {
  it("returns null when no row exists", async () => {
    const sb = mkSb({ row: null });
    const out = await getMatchDayWindow(sb as never, MATCH_DAY);
    expect(out).toBeNull();
  });

  it("maps row fields to camelCase shape", async () => {
    const sb = mkSb({ row: ROW });
    const out = await getMatchDayWindow(sb as never, MATCH_DAY);
    expect(out).toEqual({
      matchDayId: MATCH_DAY,
      state: "force_open",
      note: "make-up day for power outage",
      setBy: "u-1",
      setAt: "2026-04-27T20:00:00Z",
    });
  });
});

describe("setMatchDayWindow", () => {
  it("upserts force_open with note + returns the saved row", async () => {
    const sb = mkSb({ row: ROW });
    const out = await setMatchDayWindow(
      sb as never,
      ACTOR,
      MATCH_DAY,
      "force_open",
      "make-up day for power outage",
    );
    expect(out.state).toBe("force_open");
    expect(out.note).toBe("make-up day for power outage");
    expect(sb.from).toHaveBeenCalledWith("squad_match_day_overrides");
  });

  it("throws when actor has no userId", async () => {
    const sb = mkSb({ row: ROW });
    await expect(
      setMatchDayWindow(
        sb as never,
        { userId: null, roles: ["admin"] },
        MATCH_DAY,
        "force_close",
      ),
    ).rejects.toThrow(/no actor\.userId/);
  });

  it("supports force_close with optional null note", async () => {
    const closedRow: Row = { ...ROW, state: "force_close", note: null };
    const sb = mkSb({ row: closedRow });
    const out = await setMatchDayWindow(
      sb as never,
      ACTOR,
      MATCH_DAY,
      "force_close",
    );
    expect(out.state).toBe("force_close");
    expect(out.note).toBeNull();
  });
});

describe("clearMatchDayWindow", () => {
  it("soft-deletes the matching row", async () => {
    const sb = mkSb({ row: ROW });
    await clearMatchDayWindow(sb as never, ACTOR, MATCH_DAY);
    expect(sb.from).toHaveBeenCalledWith("squad_match_day_overrides");
    expect(sb._spies.updateEq).toHaveBeenCalledWith("match_day_id", MATCH_DAY);
  });
});

// -- resolver -----------------------------------------------------------

type ResolverState = {
  matchDayOverride?: { state: "force_open" | "force_close" } | null;
  matchDayDate?: string | null; // null means match_day row missing
  weeklyOverride?: { state: "force_open" | "force_close" } | null;
  scheduleOverride?: {
    submissionDeadlineAt: string | null;
  } | null;
};

function mkResolverSb(state: ResolverState) {
  return {
    from: vi.fn((table: string) => {
      if (table === "squad_match_day_overrides") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: state.matchDayOverride
                    ? {
                        match_day_id: MATCH_DAY,
                        state: state.matchDayOverride.state,
                        note: null,
                        set_by: "u-1",
                        set_at: "2026-04-27T20:00:00Z",
                      }
                    : null,
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      if (table === "match_days") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data:
                    state.matchDayDate === null
                      ? null
                      : { match_date: state.matchDayDate ?? "2026-04-16" },
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      if (table === "squad_window_overrides") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: state.weeklyOverride
                    ? {
                        week_start_date: "2026-04-16",
                        state: state.weeklyOverride.state,
                        note: null,
                        set_by: "u-1",
                        set_at: "2026-04-27T20:00:00Z",
                      }
                    : null,
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      if (table === "match_day_schedule_overrides") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: state.scheduleOverride
                    ? {
                        id: "00000000-0000-4000-8000-00000000aaaa",
                        match_day_id: MATCH_DAY,
                        submission_deadline_at:
                          state.scheduleOverride.submissionDeadlineAt,
                        change_window_open_at: null,
                        change_window_close_at: null,
                        notes: null,
                        set_by: "u-1",
                        set_at: "2026-04-22T20:00:00Z",
                      }
                    : null,
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("resolveSquadWindowForMatchDay", () => {
  it("match-day force_open wins regardless of weekly", async () => {
    const sb = mkResolverSb({
      matchDayOverride: { state: "force_open" },
      weeklyOverride: { state: "force_close" },
    });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-30T12:00:00+01:00"), // way past deadline
    });
    expect(out).toMatchObject({
      open: true,
      forceOpen: true,
      reason: "match_day_force_open",
    });
    expect(out.effectiveDeadlineAt).toBeDefined();
  });

  it("match-day force_close wins regardless of weekly", async () => {
    const sb = mkResolverSb({
      matchDayOverride: { state: "force_close" },
      weeklyOverride: { state: "force_open" },
    });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-15T08:00:00+01:00"), // pre-deadline
    });
    expect(out).toMatchObject({
      open: false,
      forceOpen: false,
      reason: "match_day_force_close",
    });
  });

  it("falls through to weekly force_close when no match-day override", async () => {
    const sb = mkResolverSb({
      weeklyOverride: { state: "force_close" },
    });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-15T08:00:00+01:00"),
    });
    expect(out).toMatchObject({
      open: false,
      forceOpen: false,
      reason: "weekly_force_close",
    });
  });

  it("falls through to weekly force_open when no match-day override", async () => {
    const sb = mkResolverSb({
      weeklyOverride: { state: "force_open" },
    });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-30T12:00:00+01:00"), // past deadline
    });
    expect(out).toMatchObject({
      open: true,
      forceOpen: true,
      reason: "weekly_force_open",
    });
  });

  it("default open before Thursday deadline", async () => {
    const sb = mkResolverSb({
      matchDayDate: "2026-04-16", // Thursday
    });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-16T08:00:00+01:00"), // 2h before deadline
    });
    expect(out).toMatchObject({
      open: true,
      forceOpen: false,
      reason: "weekly_default_open",
    });
  });

  it("default closed past Thursday deadline", async () => {
    const sb = mkResolverSb({
      matchDayDate: "2026-04-16", // Thursday
    });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-17T12:00:00+01:00"), // day after
    });
    expect(out).toMatchObject({
      open: false,
      forceOpen: false,
      reason: "weekly_default_closed",
    });
  });

  it("returns closed when match_day row missing", async () => {
    const sb = mkResolverSb({ matchDayDate: null });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-16T08:00:00+01:00"),
    });
    expect(out).toMatchObject({
      open: false,
      forceOpen: false,
      reason: "weekly_default_closed",
    });
  });

  it("schedule override extends the deadline past Thursday 10:00", async () => {
    // Default Thursday 10:00 deadline would close the window at 10:00 WAT,
    // but the override pushes it to 14:00 — submission still open.
    const sb = mkResolverSb({
      matchDayDate: "2026-04-16", // Thursday
      scheduleOverride: {
        submissionDeadlineAt: "2026-04-16T14:00:00+01:00",
      },
    });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-16T13:00:00+01:00"), // 1pm WAT — past default
    });
    expect(out).toMatchObject({
      open: true,
      forceOpen: false,
      reason: "weekly_default_open",
    });
    expect(out.effectiveDeadlineAt).toBe("2026-04-16T13:00:00.000Z");
  });

  it("schedule override shortens the deadline before Thursday 10:00", async () => {
    // Override pulls deadline forward to 06:00 — submissions close earlier.
    const sb = mkResolverSb({
      matchDayDate: "2026-04-16", // Thursday
      scheduleOverride: {
        submissionDeadlineAt: "2026-04-16T06:00:00+01:00",
      },
    });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-16T08:00:00+01:00"), // past 06:00 override
    });
    expect(out).toMatchObject({
      open: false,
      forceOpen: false,
      reason: "weekly_default_closed",
    });
    expect(out.effectiveDeadlineAt).toBe("2026-04-16T05:00:00.000Z");
  });

  it("force_open carries the admin note + effective deadline", async () => {
    const sb = mkResolverSb({
      matchDayDate: "2026-04-16",
      matchDayOverride: { state: "force_open" },
      scheduleOverride: { submissionDeadlineAt: "2026-04-17T18:00:00+01:00" },
    });
    const out = await resolveSquadWindowForMatchDay(sb as never, MATCH_DAY, {
      now: new Date("2026-04-16T11:00:00+01:00"),
    });
    expect(out.open).toBe(true);
    expect(out.forceOpen).toBe(true);
    expect(out.reason).toBe("match_day_force_open");
    expect(out.effectiveDeadlineAt).toBe("2026-04-17T17:00:00.000Z");
  });
});
