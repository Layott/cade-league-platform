import { describe, it, expect, vi, beforeEach } from "vitest";

const { requirePermAsyncMock } = vi.hoisted(() => ({
  requirePermAsyncMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: requirePermAsyncMock,
  PermissionError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = "PermissionError";
    }
  },
}));

import { listHistory, revertToSnapshot } from "./history";

const ACTOR = { userId: "u-1", roles: ["admin"] };
const KEY = "07-leaderboard";
const VARIANT = "default";

type HistRow = {
  id: string;
  overlay_key: string;
  variant_id: string;
  snapshot_json: Record<string, string>;
  changed_by: string;
  reason: string | null;
  created_at: string;
};

const SNAP_OLD: HistRow = {
  id: "h-old",
  overlay_key: KEY,
  variant_id: VARIANT,
  snapshot_json: { "accent-color": "#6bcd06" },
  changed_by: "u-2",
  reason: "set accent-color=#6bcd06",
  created_at: "2026-04-29T08:00:00Z",
};
const SNAP_NEW: HistRow = {
  id: "h-new",
  overlay_key: KEY,
  variant_id: VARIANT,
  snapshot_json: { "accent-color": "#fe036d" },
  changed_by: "u-1",
  reason: "set accent-color=#fe036d",
  created_at: "2026-04-29T09:00:00Z",
};

// ---- listHistory --------------------------------------------------------

describe("listHistory", () => {
  it("returns rows mapped to camelCase + ordered desc", async () => {
    // Chain: from().select().eq().eq().is().order().limit() → resolves rows.
    const limitFn = vi
      .fn()
      .mockResolvedValue({ data: [SNAP_NEW, SNAP_OLD], error: null });
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                order: vi.fn(() => ({ limit: limitFn })),
              })),
            })),
          })),
        })),
      })),
    };
    const out = await listHistory(sb as never, KEY, VARIANT);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("h-new");
    expect(out[0].snapshot["accent-color"]).toBe("#fe036d");
    expect(out[1].id).toBe("h-old");
  });

  it("applies a custom limit", async () => {
    const limitFn = vi.fn().mockResolvedValue({ data: [SNAP_NEW], error: null });
    const orderFn = vi.fn(() => ({ limit: limitFn }));
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ order: orderFn })),
            })),
          })),
        })),
      })),
    };
    await listHistory(sb as never, KEY, VARIANT, 5);
    expect(limitFn).toHaveBeenCalledWith(5);
  });

  it("propagates supabase error", async () => {
    const limitFn = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                order: vi.fn(() => ({ limit: limitFn })),
              })),
            })),
          })),
        })),
      })),
    };
    await expect(listHistory(sb as never, KEY, VARIANT)).rejects.toThrow(
      /listHistory: boom/,
    );
  });
});

// ---- revertToSnapshot ---------------------------------------------------

/**
 * Build a Supabase mock for revertToSnapshot.
 *
 * Drives:
 *   - history SELECT (load snapshotId).
 *   - tokens SELECT (current live rows so we can capture them).
 *   - history INSERT (capturing the pre-revert state).
 *   - tokens UPSERT (writing the snapshot tokens back).
 */
function mkRevertSb(opts: {
  loadSnapshot: HistRow | null;
  liveRows: Array<{
    token_key: string;
    token_value: string;
    token_type: string;
  }>;
  upsertError?: { message: string } | null;
}) {
  const historyMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.loadSnapshot, error: null });
  const historyInsert = vi.fn().mockResolvedValue({ error: null });

  const tokensSelectIs = vi
    .fn()
    .mockResolvedValue({ data: opts.liveRows, error: null });
  const tokensUpsert = vi
    .fn()
    .mockResolvedValue({ error: opts.upsertError ?? null });

  const sb = {
    from: vi.fn((table: string) => {
      if (table === "overlay_design_history") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ maybeSingle: historyMaybeSingle })),
            })),
          })),
          insert: historyInsert,
        };
      }
      if (table === "overlay_design_tokens") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: tokensSelectIs,
              })),
            })),
          })),
          upsert: tokensUpsert,
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _spies: { historyInsert, tokensUpsert, historyMaybeSingle },
  };
  return sb;
}

describe("revertToSnapshot", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkRevertSb({ loadSnapshot: SNAP_OLD, liveRows: [] });
    await expect(
      revertToSnapshot(sb as never, ACTOR, "h-old"),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("throws when actor.userId is null", async () => {
    const sb = mkRevertSb({ loadSnapshot: SNAP_OLD, liveRows: [] });
    await expect(
      revertToSnapshot(
        sb as never,
        { userId: null, roles: ["admin"] },
        "h-old",
      ),
    ).rejects.toThrow(/no actor\.userId/);
  });

  it("throws when snapshot not found", async () => {
    const sb = mkRevertSb({ loadSnapshot: null, liveRows: [] });
    await expect(
      revertToSnapshot(sb as never, ACTOR, "h-missing"),
    ).rejects.toThrow(/snapshot not found/);
  });

  it("captures CURRENT state to history then upserts snapshot tokens", async () => {
    const sb = mkRevertSb({
      loadSnapshot: SNAP_OLD,
      liveRows: [
        { token_key: "accent-color", token_value: "#fe036d", token_type: "color" },
      ],
    });
    await revertToSnapshot(sb as never, ACTOR, "h-old");
    // History row inserted with the live (pre-revert) snapshot.
    expect(sb._spies.historyInsert).toHaveBeenCalledTimes(1);
    expect(sb._spies.historyInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        overlay_key: KEY,
        variant_id: VARIANT,
        changed_by: "u-1",
        snapshot_json: { "accent-color": "#fe036d" },
        reason: expect.stringContaining("revert to snapshot h-old"),
      }),
    );
    // Tokens upsert called with the snapshot values.
    expect(sb._spies.tokensUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = sb._spies.tokensUpsert.mock.calls[0][0];
    expect(upsertArg).toEqual([
      expect.objectContaining({
        overlay_key: KEY,
        variant_id: VARIANT,
        token_key: "accent-color",
        token_value: "#6bcd06",
        token_type: "color",
        set_by: "u-1",
      }),
    ]);
  });

  it("infers token_type='string' when no live row exists for a snapshot key", async () => {
    const sb = mkRevertSb({
      loadSnapshot: {
        ...SNAP_OLD,
        snapshot_json: { "novel-token": "value-a" },
      },
      liveRows: [],
    });
    await revertToSnapshot(sb as never, ACTOR, "h-old");
    const upsertArg = sb._spies.tokensUpsert.mock.calls[0][0];
    expect(upsertArg[0]).toMatchObject({
      token_key: "novel-token",
      token_value: "value-a",
      token_type: "string",
    });
  });

  it("no-ops when snapshot is empty (no upsert call)", async () => {
    const sb = mkRevertSb({
      loadSnapshot: { ...SNAP_OLD, snapshot_json: {} },
      liveRows: [],
    });
    await revertToSnapshot(sb as never, ACTOR, "h-old");
    expect(sb._spies.historyInsert).toHaveBeenCalledTimes(1);
    expect(sb._spies.tokensUpsert).not.toHaveBeenCalled();
  });

  it("propagates upsert error", async () => {
    const sb = mkRevertSb({
      loadSnapshot: SNAP_OLD,
      liveRows: [],
      upsertError: { message: "constraint failed" },
    });
    await expect(
      revertToSnapshot(sb as never, ACTOR, "h-old"),
    ).rejects.toThrow(/constraint failed/);
  });
});
