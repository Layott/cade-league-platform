import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  triggerAdminWalkover,
  markRefPendingWalkover,
  confirmRefPendingWalkover,
  undoWalkover,
} from "./index";

type Tables = Record<string, unknown>;

function mkSb(tables: Tables) {
  // Plan 51: walkover paths emit a follow-up `walkover.confirmed` broadcast
  // via sb.channel. Mock no-op channel + removeChannel so unit tests don't
  // need to thread these through every test setup.
  const send = vi.fn().mockResolvedValue("ok");
  const channel = vi.fn(() => ({ send }));
  const removeChannel = vi.fn();
  return {
    from: vi.fn((t: string) => {
      const table = tables[t];
      if (!table) throw new Error(`unexpected table ${t}`);
      return table;
    }),
    channel,
    removeChannel,
  };
}

/**
 * Match table mock: only `.select(...).eq(...).is(...).maybeSingle()` reads
 * and `.update(...).eq(...)` writes are used.
 */
function mkMatchesTable(opts: {
  match?: { id: string; home_player_id: string; away_player_id: string } | null;
  matchError?: { message: string } | null;
  updateSpy?: (patch: Record<string, unknown>) => void;
}) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.match ?? null,
            error: opts.matchError ?? null,
          }),
        })),
      })),
    })),
    update: vi.fn((patch: Record<string, unknown>) => {
      updates.push(patch);
      if (opts.updateSpy) opts.updateSpy(patch);
      return {
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };
}

/**
 * match_results table mock with separate read + insert + update branches.
 */
function mkResultsTable(opts: {
  existingResult?: Record<string, unknown> | null;
  existingResultError?: { message: string } | null;
  insertedRow?: Record<string, unknown> | null;
  insertError?: { message: string } | null;
  updatedRow?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
  insertSpy?: (payload: Record<string, unknown>) => void;
  updateSpy?: (patch: Record<string, unknown>) => void;
}) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.existingResult ?? null,
            error: opts.existingResultError ?? null,
          }),
        })),
      })),
    })),
    insert: vi.fn((payload: Record<string, unknown>) => {
      if (opts.insertSpy) opts.insertSpy(payload);
      return {
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: opts.insertedRow ?? null,
            error: opts.insertError ?? null,
          }),
        })),
      };
    }),
    update: vi.fn((patch: Record<string, unknown>) => {
      if (opts.updateSpy) opts.updateSpy(patch);
      return {
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: opts.updatedRow ?? null,
              error: opts.updateError ?? null,
            }),
          })),
        })),
      };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("triggerAdminWalkover()", () => {
  it("writes a finalised 3-0 row in favour of the home winner", async () => {
    let captured: Record<string, unknown> = {};
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: null,
      insertedRow: {
        id: "r-1",
        match_id: "m-1",
        home_score: 3,
        away_score: 0,
        is_walkover: true,
      },
      insertSpy: (payload) => {
        captured = payload;
      },
    });
    const sb = mkSb({ matches, match_results: results });
    const out = await triggerAdminWalkover("m-1", "ph", sb as never, "u-1");
    expect(out.id).toBe("r-1");
    expect(captured.home_score).toBe(3);
    expect(captured.away_score).toBe(0);
    expect(captured.is_walkover).toBe(true);
    expect(captured.walkover_initiated_by).toBe("admin");
    expect(captured.walkover_pending).toBe(false);
    expect(typeof captured.walkover_confirmed_at).toBe("string");
    expect(captured.winner_player_id).toBe("ph");
    expect(captured.entered_by).toBe("u-1");
  });

  it("writes 0-3 when the away player is the winner", async () => {
    let captured: Record<string, unknown> = {};
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: null,
      insertedRow: { id: "r-2", home_score: 0, away_score: 3 },
      insertSpy: (p) => {
        captured = p;
      },
    });
    const sb = mkSb({ matches, match_results: results });
    await triggerAdminWalkover("m-1", "pa", sb as never);
    expect(captured.home_score).toBe(0);
    expect(captured.away_score).toBe(3);
    expect(captured.winner_player_id).toBe("pa");
  });

  it("throws when winnerId is not a participant of the match", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({ existingResult: null });
    const sb = mkSb({ matches, match_results: results });
    await expect(
      triggerAdminWalkover("m-1", "stranger", sb as never),
    ).rejects.toThrow(/not a participant/);
  });

  it("throws when match is not found", async () => {
    const matches = mkMatchesTable({ match: null });
    const results = mkResultsTable({});
    const sb = mkSb({ matches, match_results: results });
    await expect(
      triggerAdminWalkover("missing", "ph", sb as never),
    ).rejects.toThrow(/not found/);
  });

  it("throws when a result already exists", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: { id: "old-r" },
    });
    const sb = mkSb({ matches, match_results: results });
    await expect(
      triggerAdminWalkover("m-1", "ph", sb as never),
    ).rejects.toThrow(/already has a result/);
  });

  it("updates the match status to 'forfeited' after insert", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: null,
      insertedRow: { id: "r-1" },
    });
    const sb = mkSb({ matches, match_results: results });
    await triggerAdminWalkover("m-1", "ph", sb as never);
    expect(matches.updates).toContainEqual({ status: "forfeited" });
  });

  it("Plan 51: emits walkover.confirmed broadcast after admin trigger", async () => {
    const matches = mkMatchesTable({
      // match row carries the season via the embedded relation lookup the
      // emit helper performs after the write succeeds.
      match: {
        id: "m-1",
        home_player_id: "ph",
        away_player_id: "pa",
        match_days: { season_id: "season-9" },
      } as never,
    });
    const results = mkResultsTable({
      existingResult: null,
      insertedRow: { id: "r-1" },
    });
    const sb = mkSb({ matches, match_results: results });
    await triggerAdminWalkover("m-1", "ph", sb as never);
    // The mkSb factory installs a channel mock; assert it was reached.
    expect(
      (sb as { channel: { mock: { calls: unknown[][] } } }).channel.mock.calls,
    ).toContainEqual(["public:standings:season-9"]);
  });
});

describe("markRefPendingWalkover()", () => {
  it("marks 3-0 to opponent of absent player + walkover_pending=true", async () => {
    let captured: Record<string, unknown> = {};
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: null,
      insertedRow: { id: "r-7", match_id: "m-1" },
      insertSpy: (p) => {
        captured = p;
      },
    });
    const sb = mkSb({ matches, match_results: results });
    await markRefPendingWalkover("m-1", "ph", sb as never);
    expect(captured.is_walkover).toBe(true);
    expect(captured.walkover_initiated_by).toBe("ref");
    expect(captured.walkover_pending).toBe(true);
    expect(captured.walkover_confirmed_at).toBeNull();
    // home absent -> away wins 0-3, winner is away player
    expect(captured.home_score).toBe(0);
    expect(captured.away_score).toBe(3);
    expect(captured.winner_player_id).toBe("pa");
  });

  it("rejects unknown absent player", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({});
    const sb = mkSb({ matches, match_results: results });
    await expect(
      markRefPendingWalkover("m-1", "stranger", sb as never),
    ).rejects.toThrow(/not a participant/);
  });

  it("rejects when result already exists", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({ existingResult: { id: "old" } });
    const sb = mkSb({ matches, match_results: results });
    await expect(
      markRefPendingWalkover("m-1", "ph", sb as never),
    ).rejects.toThrow(/already has a result/);
  });

  it("propagates insert error", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: null,
      insertError: { message: "fk violation" },
    });
    const sb = mkSb({ matches, match_results: results });
    await expect(
      markRefPendingWalkover("m-1", "ph", sb as never),
    ).rejects.toThrow(/fk violation/);
  });
});

describe("confirmRefPendingWalkover()", () => {
  it("flips walkover_pending to false + stamps walkover_confirmed_at", async () => {
    let patched: Record<string, unknown> = {};
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: {
        id: "r-9",
        match_id: "m-1",
        is_walkover: true,
        walkover_initiated_by: "ref",
        walkover_pending: true,
        walkover_confirmed_at: null,
      },
      updatedRow: {
        id: "r-9",
        match_id: "m-1",
        is_walkover: true,
        walkover_initiated_by: "ref",
        walkover_pending: false,
        walkover_confirmed_at: "2026-04-25T10:00:00Z",
      },
      updateSpy: (p) => {
        patched = p;
      },
    });
    const sb = mkSb({ matches, match_results: results });
    const out = await confirmRefPendingWalkover("m-1", sb as never);
    expect(patched.walkover_pending).toBe(false);
    expect(typeof patched.walkover_confirmed_at).toBe("string");
    // Score not modified
    expect(Object.keys(patched)).not.toContain("home_score");
    expect(Object.keys(patched)).not.toContain("away_score");
    expect(out.walkover_pending).toBe(false);
  });

  it("rejects if existing row is not a walkover", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: { id: "r-1", is_walkover: false },
    });
    const sb = mkSb({ matches, match_results: results });
    await expect(
      confirmRefPendingWalkover("m-1", sb as never),
    ).rejects.toThrow(/not a walkover/);
  });

  it("rejects if walkover was admin-initiated (already final)", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: {
        id: "r-1",
        is_walkover: true,
        walkover_initiated_by: "admin",
        walkover_pending: false,
      },
    });
    const sb = mkSb({ matches, match_results: results });
    await expect(
      confirmRefPendingWalkover("m-1", sb as never),
    ).rejects.toThrow(/not initiated by ref/);
  });

  it("returns idempotently when already confirmed", async () => {
    const existing = {
      id: "r-1",
      is_walkover: true,
      walkover_initiated_by: "ref",
      walkover_pending: false,
      walkover_confirmed_at: "2026-04-25T10:00:00Z",
    };
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({ existingResult: existing });
    const sb = mkSb({ matches, match_results: results });
    const out = await confirmRefPendingWalkover("m-1", sb as never);
    expect(out.id).toBe("r-1");
    expect(results.update).not.toHaveBeenCalled();
  });

  it("throws when no match_result exists", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({ existingResult: null });
    const sb = mkSb({ matches, match_results: results });
    await expect(
      confirmRefPendingWalkover("m-1", sb as never),
    ).rejects.toThrow(/no match_result found/);
  });

  it("propagates update error", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: {
        id: "r-1",
        is_walkover: true,
        walkover_initiated_by: "ref",
        walkover_pending: true,
      },
      updateError: { message: "db error" },
    });
    const sb = mkSb({ matches, match_results: results });
    await expect(
      confirmRefPendingWalkover("m-1", sb as never),
    ).rejects.toThrow(/update failed/);
  });
});

describe("undoWalkover()", () => {
  it("soft-deletes the row + resets match status to 'scheduled'", async () => {
    let patched: Record<string, unknown> = {};
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: { id: "r-9", match_id: "m-1", is_walkover: true },
      updatedRow: {
        id: "r-9",
        match_id: "m-1",
        is_walkover: true,
        deleted_at: "2026-04-25T11:00:00Z",
      },
      updateSpy: (p) => {
        patched = p;
      },
    });
    const sb = mkSb({ matches, match_results: results });
    const out = await undoWalkover("m-1", sb as never);
    expect(typeof patched.deleted_at).toBe("string");
    expect(out.id).toBe("r-9");
    expect(matches.updates).toContainEqual({ status: "scheduled" });
  });

  it("rejects when match_result is not a walkover", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({
      existingResult: { id: "r-1", is_walkover: false },
    });
    const sb = mkSb({ matches, match_results: results });
    await expect(undoWalkover("m-1", sb as never)).rejects.toThrow(
      /not a walkover/,
    );
  });

  it("throws when no match_result exists", async () => {
    const matches = mkMatchesTable({
      match: { id: "m-1", home_player_id: "ph", away_player_id: "pa" },
    });
    const results = mkResultsTable({ existingResult: null });
    const sb = mkSb({ matches, match_results: results });
    await expect(undoWalkover("m-1", sb as never)).rejects.toThrow(
      /no match_result found/,
    );
  });
});
