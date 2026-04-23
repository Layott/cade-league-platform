import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn().mockResolvedValue(undefined),
  PermissionError: class extends Error {},
}));

import {
  getPlayerSquadOverride,
  setPlayerSquadOverride,
  clearPlayerSquadOverride,
  listPlayerSquadOverridesForWeek,
} from "./player_override";

type Row = {
  id: string;
  player_id: string;
  week_start_date: string;
  state: "ban" | "force_open";
  note: string | null;
  set_by: string;
  set_at: string;
};

type Existing = { id: string; deleted_at: string | null } | null;

function mkSb(opts: {
  row?: Row | null;
  existing?: Existing;
  listRows?: Row[];
}) {
  // get(): from → select → eq → eq → is → maybeSingle
  const getMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.row ?? null, error: null });

  // set()/existing sniff: from → select → eq → eq → order → limit → maybeSingle
  const existingMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.existing ?? null, error: null });

  // upsert(): from → upsert → select → single
  const upsertSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.row ?? null, error: null });

  // update-by-id (resurrection): from → update → eq → select → single
  const updateByIdSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.row ?? null, error: null });

  // clear(): from → update → eq → eq → is
  const clearIs = vi.fn().mockResolvedValue({ error: null });

  // list(): from → select → eq → is → order
  const listOrder = vi
    .fn()
    .mockResolvedValue({ data: opts.listRows ?? [], error: null });

  // Router spy lets us branch select() results on projection string.
  const spies = {
    getMaybeSingle,
    existingMaybeSingle,
    upsertSingle,
    updateByIdSingle,
    clearIs,
    listOrder,
    fromCalls: [] as string[],
    upsertCalls: [] as unknown[],
    updatePayloads: [] as unknown[],
  };

  function selectBuilder(cols: string) {
    if (cols.includes("deleted_at") && !cols.includes("player_id,")) {
      // existing-sniff path
      return {
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({ maybeSingle: existingMaybeSingle })),
            })),
          })),
        })),
      };
    }
    // normal get() / listForWeek() / read-back-from-upsert/update
    return {
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({ maybeSingle: getMaybeSingle })),
        })),
        is: vi.fn(() => ({
          order: listOrder,
        })),
      })),
      single: upsertSingle,
    };
  }

  return {
    from: vi.fn((tbl: string) => {
      spies.fromCalls.push(tbl);
      return {
        select: vi.fn((cols: string) => selectBuilder(cols)),
        upsert: vi.fn((payload: unknown) => {
          spies.upsertCalls.push(payload);
          return {
            select: vi.fn(() => ({ single: upsertSingle })),
          };
        }),
        update: vi.fn((payload: unknown) => {
          spies.updatePayloads.push(payload);
          return {
            // resurrection: .eq("id", ...).select(...).single()
            eq: vi.fn(() => ({
              select: vi.fn(() => ({ single: updateByIdSingle })),
              // clear: .eq(...).eq(...).is(...)
              eq: vi.fn(() => ({ is: clearIs })),
            })),
          };
        }),
      };
    }),
    _spies: spies,
  };
}

const ACTOR = { userId: "u-1", roles: ["admin"] };
const PLAYER = "p-123";
const WEEK = "2026-04-16";
const ROW: Row = {
  id: "ov-1",
  player_id: PLAYER,
  week_start_date: WEEK,
  state: "ban",
  note: "no-show last week",
  set_by: "u-1",
  set_at: "2026-04-23T20:00:00Z",
};

describe("getPlayerSquadOverride", () => {
  it("returns null when no row exists", async () => {
    const sb = mkSb({ row: null });
    const out = await getPlayerSquadOverride(sb as never, PLAYER, WEEK);
    expect(out).toBeNull();
    expect(sb._spies.fromCalls).toContain("player_squad_overrides");
  });

  it("maps row fields to camelCase override shape", async () => {
    const sb = mkSb({ row: ROW });
    const out = await getPlayerSquadOverride(sb as never, PLAYER, WEEK);
    expect(out).toEqual({
      id: "ov-1",
      playerId: PLAYER,
      weekStartDate: WEEK,
      state: "ban",
      note: "no-show last week",
      setBy: "u-1",
      setAt: "2026-04-23T20:00:00Z",
    });
  });
});

describe("setPlayerSquadOverride", () => {
  it("upserts state='ban' with a note + returns the saved row", async () => {
    const sb = mkSb({ row: ROW, existing: null });
    const out = await setPlayerSquadOverride(
      sb as never,
      ACTOR,
      PLAYER,
      WEEK,
      "ban",
      "no-show last week",
    );
    expect(out.state).toBe("ban");
    expect(out.note).toBe("no-show last week");
    expect(out.playerId).toBe(PLAYER);
    expect(sb._spies.fromCalls).toContain("player_squad_overrides");
    // upsert payload should carry player_id + state + set_by
    expect(sb._spies.upsertCalls.length).toBe(1);
    const payload = sb._spies.upsertCalls[0] as Record<string, unknown>;
    expect(payload.player_id).toBe(PLAYER);
    expect(payload.week_start_date).toBe(WEEK);
    expect(payload.state).toBe("ban");
    expect(payload.set_by).toBe("u-1");
    expect(payload.deleted_at).toBeNull();
  });

  it("throws when actor has no userId", async () => {
    const sb = mkSb({ row: ROW, existing: null });
    await expect(
      setPlayerSquadOverride(
        sb as never,
        { userId: null, roles: ["admin"] },
        PLAYER,
        WEEK,
        "force_open",
      ),
    ).rejects.toThrow(/no actor\.userId/);
  });

  it("resurrects a soft-deleted row instead of inserting a duplicate", async () => {
    const resurrected: Row = { ...ROW, state: "force_open", note: "unbanned" };
    const sb = mkSb({
      row: resurrected,
      existing: { id: "ov-1", deleted_at: "2026-04-22T10:00:00Z" },
    });
    const out = await setPlayerSquadOverride(
      sb as never,
      ACTOR,
      PLAYER,
      WEEK,
      "force_open",
      "unbanned",
    );
    expect(out.state).toBe("force_open");
    // resurrection path: update(), no upsert()
    expect(sb._spies.upsertCalls.length).toBe(0);
    expect(sb._spies.updatePayloads.length).toBe(1);
    const payload = sb._spies.updatePayloads[0] as Record<string, unknown>;
    expect(payload.deleted_at).toBeNull();
    expect(payload.state).toBe("force_open");
  });
});

describe("clearPlayerSquadOverride", () => {
  it("soft-deletes the matching row", async () => {
    const sb = mkSb({ row: ROW });
    await clearPlayerSquadOverride(sb as never, ACTOR, PLAYER, WEEK);
    expect(sb._spies.fromCalls).toContain("player_squad_overrides");
    // update payload sets deleted_at to an ISO string
    expect(sb._spies.updatePayloads.length).toBe(1);
    const payload = sb._spies.updatePayloads[0] as Record<string, unknown>;
    expect(typeof payload.deleted_at).toBe("string");
    expect(payload.updated_at).toBeDefined();
  });
});

describe("listPlayerSquadOverridesForWeek", () => {
  it("returns an array mapped to camelCase", async () => {
    const sb = mkSb({ listRows: [ROW] });
    const out = await listPlayerSquadOverridesForWeek(sb as never, WEEK);
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(1);
    expect(out[0].playerId).toBe(PLAYER);
    expect(out[0].weekStartDate).toBe(WEEK);
    expect(out[0].state).toBe("ban");
  });

  it("returns [] when no rows exist", async () => {
    const sb = mkSb({ listRows: [] });
    const out = await listPlayerSquadOverridesForWeek(sb as never, WEEK);
    expect(out).toEqual([]);
  });
});
