import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn().mockResolvedValue(undefined),
  PermissionError: class extends Error {},
}));

import {
  getSquadWindowOverride,
  setSquadWindowOverride,
  clearSquadWindowOverride,
} from "./window_override";

type Row = {
  week_start_date: string;
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
const WEEK = "2026-04-16";
const ROW: Row = {
  week_start_date: WEEK,
  state: "force_open",
  note: "late patch",
  set_by: "u-1",
  set_at: "2026-04-23T20:00:00Z",
};

describe("getSquadWindowOverride", () => {
  it("returns null when no row exists", async () => {
    const sb = mkSb({ row: null });
    const out = await getSquadWindowOverride(sb as never, WEEK);
    expect(out).toBeNull();
  });

  it("maps row fields to camelCase override shape", async () => {
    const sb = mkSb({ row: ROW });
    const out = await getSquadWindowOverride(sb as never, WEEK);
    expect(out).toEqual({
      weekStartDate: WEEK,
      state: "force_open",
      note: "late patch",
      setBy: "u-1",
      setAt: "2026-04-23T20:00:00Z",
    });
  });
});

describe("setSquadWindowOverride", () => {
  it("upserts force_open with note + returns the saved row", async () => {
    const sb = mkSb({ row: ROW });
    const out = await setSquadWindowOverride(
      sb as never,
      ACTOR,
      WEEK,
      "force_open",
      "late patch",
    );
    expect(out.state).toBe("force_open");
    expect(out.note).toBe("late patch");
    expect(sb.from).toHaveBeenCalledWith("squad_window_overrides");
  });

  it("throws when actor has no userId", async () => {
    const sb = mkSb({ row: ROW });
    await expect(
      setSquadWindowOverride(sb as never, { userId: null, roles: ["admin"] }, WEEK, "force_close"),
    ).rejects.toThrow(/no actor\.userId/);
  });
});

describe("clearSquadWindowOverride", () => {
  it("soft-deletes the matching row", async () => {
    const sb = mkSb({ row: ROW });
    await clearSquadWindowOverride(sb as never, ACTOR, WEEK);
    expect(sb.from).toHaveBeenCalledWith("squad_window_overrides");
    expect(sb._spies.updateEq).toHaveBeenCalledWith("week_start_date", WEEK);
  });
});
