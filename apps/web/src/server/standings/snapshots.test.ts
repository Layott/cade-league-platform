import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureSnapshot, readSnapshot } from "./snapshots";

/**
 * The Supabase chain is heavily nested. Each test builds a per-table
 * "mock matrix" so we can assert call shapes without faking the entire
 * client surface. Helper below returns a sb-shaped object whose `.from()`
 * dispatches per table to the configured chain.
 */
function mkSb(tables: Record<string, unknown>) {
  // Plan 51: captureSnapshot fires a snapshot.captured broadcast post-insert.
  // Mock channel + removeChannel as no-ops so tests don't need to thread
  // these through every fixture.
  const send = vi.fn().mockResolvedValue("ok");
  const channel = vi.fn(() => ({ send }));
  const removeChannel = vi.fn();
  return {
    from: vi.fn((t: string) => {
      const table = tables[t];
      if (!table) throw new Error(`unexpected table ${t}`);
      return table as Record<string, unknown>;
    }),
    channel,
    removeChannel,
  };
}

function mkSnapshotsTable(opts: {
  existingRead?: unknown; // for readSnapshot's maybeSingle resolution
  existingLookup?: unknown; // for captureSnapshot's secondary lookup
  insertedRow?: unknown;
  insertSpy?: (payload: Record<string, unknown>) => void;
}) {
  // Two distinct chains for the two query shapes (read vs insert)
  const sequence: ("readShort" | "readFull" | "insert")[] = [];

  const readChain = (resolveTo: unknown) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({
      data: resolveTo,
      error: null,
    });
    return chain;
  };

  const insertChain = (insertedRow: unknown) => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: insertedRow, error: null }),
    })),
  });

  return {
    sequence,
    select: vi.fn((cols: string) => {
      // detect which read flavour
      if (cols.includes("captured_at, snapshot_data") && !cols.includes("id")) {
        sequence.push("readShort");
        return readChain(opts.existingRead ?? null);
      }
      if (cols.includes("id, captured_at, snapshot_data")) {
        sequence.push("readFull");
        return readChain(opts.existingLookup ?? null);
      }
      throw new Error(`unexpected select on snapshots: ${cols}`);
    }),
    insert: vi.fn((payload: Record<string, unknown>) => {
      sequence.push("insert");
      if (opts.insertSpy) opts.insertSpy(payload);
      return insertChain(opts.insertedRow);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readSnapshot()", () => {
  it("returns null when no snapshot exists", async () => {
    const snapshots = mkSnapshotsTable({ existingRead: null });
    const sb = mkSb({ leaderboard_snapshots: snapshots });
    const out = await readSnapshot(7, sb as never);
    expect(out).toBeNull();
  });

  it("returns latest after capture", async () => {
    const snapshots = mkSnapshotsTable({
      existingRead: {
        captured_at: "2026-04-25T10:00:00Z",
        snapshot_data: [{ player_id: "p1" }],
      },
    });
    const sb = mkSb({ leaderboard_snapshots: snapshots });
    const out = await readSnapshot(7, sb as never);
    expect(out).toEqual({
      capturedAt: "2026-04-25T10:00:00Z",
      snapshotData: [{ player_id: "p1" }],
    });
  });

  it("throws on supabase error", async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    const sb = mkSb({ leaderboard_snapshots: { select: () => chain } });
    await expect(readSnapshot(1, sb as never)).rejects.toThrow(/readSnapshot failed/);
  });
});

describe("captureSnapshot()", () => {
  it("returns existing row when snapshot already exists (no overwrite)", async () => {
    const snapshots = mkSnapshotsTable({
      existingRead: {
        captured_at: "2026-04-25T10:00:00Z",
        snapshot_data: [{ player_id: "p1" }],
      },
      existingLookup: {
        id: 42,
        captured_at: "2026-04-25T10:00:00Z",
        snapshot_data: [{ player_id: "p1" }],
      },
    });
    const sb = mkSb({ leaderboard_snapshots: snapshots });
    const out = await captureSnapshot(7, sb as never);
    expect(out.id).toBe(42);
    expect(out.capturedAt).toBe("2026-04-25T10:00:00Z");
    expect(snapshots.insert).not.toHaveBeenCalled();
  });

  it("writes new row when none exists", async () => {
    const insertSpy = vi.fn();
    const snapshots = mkSnapshotsTable({
      existingRead: null,
      insertedRow: {
        id: 100,
        captured_at: "2026-04-25T11:00:00Z",
        snapshot_data: [{ player_id: "p1", points: 6 }],
      },
      insertSpy,
    });
    const matchDays = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({
                data: { id: 7, season_id: "season-99" },
                error: null,
              }),
          })),
        })),
      })),
    };
    const standings = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({
            data: [{ player_id: "p1", points: 6 }],
            error: null,
          }),
        })),
      })),
    };
    const sb = mkSb({
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
      standings,
    });
    const out = await captureSnapshot(7, sb as never);
    expect(snapshots.insert).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        match_day_id: 7,
        snapshot_data: expect.objectContaining({ season_id: "season-99" }),
      }),
    );
    expect(out.id).toBe(100);
  });

  it("throws when match-day cannot be found", async () => {
    const snapshots = mkSnapshotsTable({ existingRead: null });
    const matchDays = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    };
    const sb = mkSb({
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
    });
    await expect(captureSnapshot(404, sb as never)).rejects.toThrow(
      /match-day 404 not found/,
    );
  });

  it("throws when match-day lookup errors", async () => {
    const snapshots = mkSnapshotsTable({ existingRead: null });
    const matchDays = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({
                data: null,
                error: { message: "match-days down" },
              }),
          })),
        })),
      })),
    };
    const sb = mkSb({
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
    });
    await expect(captureSnapshot(404, sb as never)).rejects.toThrow(
      /match-day lookup failed/,
    );
  });

  it("throws when standings read errors", async () => {
    const snapshots = mkSnapshotsTable({ existingRead: null });
    const matchDays = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({
                data: { id: 1, season_id: "season-1" },
                error: null,
              }),
          })),
        })),
      })),
    };
    const standings = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "standings down" },
          }),
        })),
      })),
    };
    const sb = mkSb({
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
      standings,
    });
    await expect(captureSnapshot(1, sb as never)).rejects.toThrow(
      /standings read failed/,
    );
  });

  it("throws when insert fails (e.g. append-only trigger blocks update)", async () => {
    const snapshots = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: null }),
            })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi
            .fn()
            .mockResolvedValue({
              data: null,
              error: { message: "append-only violation" },
            }),
        })),
      })),
    };
    const matchDays = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({
                data: { id: 1, season_id: "season-1" },
                error: null,
              }),
          })),
        })),
      })),
    };
    const standings = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    };
    const sb = mkSb({
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
      standings,
    });
    await expect(captureSnapshot(1, sb as never)).rejects.toThrow(
      /insert failed/,
    );
  });

  it("inserts an empty array snapshot when no standings rows exist", async () => {
    const insertSpy = vi.fn();
    const snapshots = mkSnapshotsTable({
      existingRead: null,
      insertedRow: {
        id: 9,
        captured_at: "2026-04-25T12:00:00Z",
        snapshot_data: [],
      },
      insertSpy,
    });
    const matchDays = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({
                data: { id: 1, season_id: "season-1" },
                error: null,
              }),
          })),
        })),
      })),
    };
    const standings = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    };
    const sb = mkSb({
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
      standings,
    });
    const out = await captureSnapshot(1, sb as never);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        match_day_id: 1,
        snapshot_data: { season_id: "season-1", rows: [] },
      }),
    );
    expect(out.id).toBe(9);
  });

  it("verifies upsert + select calls fire in expected order", async () => {
    const snapshots = mkSnapshotsTable({
      existingRead: null,
      insertedRow: {
        id: 50,
        captured_at: "2026-04-25T13:00:00Z",
        snapshot_data: [],
      },
    });
    const matchDays = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({
                data: { id: 1, season_id: "season-1" },
                error: null,
              }),
          })),
        })),
      })),
    };
    const standings = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    };
    const sb = mkSb({
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
      standings,
    });
    await captureSnapshot(1, sb as never);
    // First read short-form (readSnapshot pre-check), then insert.
    expect(snapshots.sequence).toEqual(["readShort", "insert"]);
  });

  it("skips season lookup when an existing snapshot is found", async () => {
    const snapshots = mkSnapshotsTable({
      existingRead: {
        captured_at: "2026-04-25T10:00:00Z",
        snapshot_data: [{ player_id: "p1" }],
      },
      existingLookup: {
        id: 42,
        captured_at: "2026-04-25T10:00:00Z",
        snapshot_data: [{ player_id: "p1" }],
      },
    });
    const matchDays = { select: vi.fn() };
    const sb = mkSb({
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
    });
    await captureSnapshot(7, sb as never);
    expect(matchDays.select).not.toHaveBeenCalled();
  });

  it("returned shape matches StandingsSnapshot type", async () => {
    const snapshots = mkSnapshotsTable({
      existingRead: null,
      insertedRow: {
        id: 1,
        captured_at: "2026-04-25T13:00:00Z",
        snapshot_data: [{ a: 1 }],
      },
    });
    const matchDays = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({
                data: { id: 1, season_id: "season-1" },
                error: null,
              }),
          })),
        })),
      })),
    };
    const standings = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ data: [{ a: 1 }], error: null }),
        })),
      })),
    };
    const sb = mkSb({
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
      standings,
    });
    const out = await captureSnapshot(1, sb as never);
    expect(out).toEqual({
      id: 1,
      capturedAt: "2026-04-25T13:00:00Z",
      snapshotData: [{ a: 1 }],
    });
  });
});
