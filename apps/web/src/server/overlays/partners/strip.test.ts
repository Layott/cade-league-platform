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

import {
  getStripLayout,
  upsertStripLayout,
  clearStripLayout,
  resolveStripLayout,
  type PartnerStripLayoutInput,
} from "./strip";

const ACTOR = { userId: "u-1", roles: ["admin"] };
const KEY = "01-brb";
const VARIANT = "default";

type Row = {
  id: string;
  overlay_key: string;
  variant_id: string;
  visible: boolean;
  position_x_px: number;
  position_y_px: number;
  anchor: string;
  orientation: string;
  scale_pct: number;
  item_spacing_px: number;
  justification: string;
  z_index: number;
};

function mkRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "row-1",
    overlay_key: KEY,
    variant_id: VARIANT,
    visible: true,
    position_x_px: 0,
    position_y_px: 1020,
    anchor: "bottom-center",
    orientation: "horizontal",
    scale_pct: 100,
    item_spacing_px: 64,
    justification: "center",
    z_index: 12,
    ...overrides,
  };
}

function rowsTable(rows: Row[]) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: rows[0] ?? null,
    error: null,
  });
  const upsertSingle = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null });
  const updateChain = vi.fn().mockResolvedValue({ error: null });

  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({ maybeSingle })),
      })),
    })),
  }));
  const upsert = vi.fn(() => ({
    select: vi.fn(() => ({ single: upsertSingle })),
  }));
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({ is: vi.fn(() => updateChain()) })),
    })),
  }));

  return {
    select,
    upsert,
    update,
    _spies: { maybeSingle, upsertSingle, updateChain },
  };
}

function mkSb(rows: Row[]) {
  const table = rowsTable(rows);
  return {
    from: vi.fn((t: string) => {
      if (t !== "overlay_partner_strip_layout") {
        throw new Error(`unexpected table ${t}`);
      }
      return table;
    }),
    _table: table,
  };
}

const VALID_INPUT: PartnerStripLayoutInput = {
  overlayKey: KEY,
  variantId: VARIANT,
  visible: true,
  positionXPx: 40,
  positionYPx: 40,
  anchor: "top-right",
  orientation: "horizontal",
  scalePct: 100,
  itemSpacingPx: 64,
  justification: "center",
  zIndex: 12,
};

describe("getStripLayout", () => {
  it("returns null when no row exists", async () => {
    const sb = mkSb([]);
    const out = await getStripLayout(sb as never, KEY, VARIANT);
    expect(out).toBeNull();
  });

  it("returns the mapped layout when row exists", async () => {
    const sb = mkSb([
      mkRow({ anchor: "top-right", position_x_px: 40, position_y_px: 40 }),
    ]);
    const out = await getStripLayout(sb as never, KEY, VARIANT);
    expect(out?.anchor).toBe("top-right");
    expect(out?.positionXPx).toBe(40);
    expect(out?.positionYPx).toBe(40);
  });

  it("defaults variantId to 'default'", async () => {
    const sb = mkSb([]);
    await getStripLayout(sb as never, KEY);
    expect(sb._table.select).toHaveBeenCalled();
  });
});

describe("upsertStripLayout — perm + validation", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      upsertStripLayout(sb as never, ACTOR, VALID_INPUT),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("throws when actor.userId is null", async () => {
    const sb = mkSb([]);
    await expect(
      upsertStripLayout(
        sb as never,
        { userId: null, roles: ["admin"] },
        VALID_INPUT,
      ),
    ).rejects.toThrow(/no actor\.userId/);
  });

  it("rejects unknown overlay key", async () => {
    const sb = mkSb([]);
    await expect(
      upsertStripLayout(sb as never, ACTOR, {
        ...VALID_INPUT,
        overlayKey: "99-fake",
      }),
    ).rejects.toThrow(/unknown overlay key/);
  });

  it("rejects invalid anchor", async () => {
    const sb = mkSb([]);
    await expect(
      upsertStripLayout(sb as never, ACTOR, {
        ...VALID_INPUT,
        anchor: "bad-anchor" as never,
      }),
    ).rejects.toThrow(/invalid anchor/);
  });

  it("rejects scale_pct out of range (low)", async () => {
    const sb = mkSb([]);
    await expect(
      upsertStripLayout(sb as never, ACTOR, { ...VALID_INPUT, scalePct: 49 }),
    ).rejects.toThrow(/scale_pct/);
  });

  it("rejects scale_pct out of range (high)", async () => {
    const sb = mkSb([]);
    await expect(
      upsertStripLayout(sb as never, ACTOR, { ...VALID_INPUT, scalePct: 201 }),
    ).rejects.toThrow(/scale_pct/);
  });

  it("rejects item_spacing_px out of range", async () => {
    const sb = mkSb([]);
    await expect(
      upsertStripLayout(sb as never, ACTOR, {
        ...VALID_INPUT,
        itemSpacingPx: 257,
      }),
    ).rejects.toThrow(/item_spacing/);
  });

  it("rejects z_index out of range", async () => {
    const sb = mkSb([]);
    await expect(
      upsertStripLayout(sb as never, ACTOR, { ...VALID_INPUT, zIndex: 41 }),
    ).rejects.toThrow(/z_index/);
  });

  it("upserts a valid layout", async () => {
    const sb = mkSb([mkRow({ anchor: "top-right" })]);
    const out = await upsertStripLayout(sb as never, ACTOR, VALID_INPUT);
    expect(out.anchor).toBe("top-right");
    expect(sb._table.upsert).toHaveBeenCalled();
  });
});

describe("clearStripLayout", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      clearStripLayout(sb as never, ACTOR, KEY, VARIANT),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("soft-deletes the row", async () => {
    const sb = mkSb([mkRow()]);
    await clearStripLayout(sb as never, ACTOR, KEY, VARIANT);
    expect(sb._table.update).toHaveBeenCalled();
  });
});

describe("resolveStripLayout", () => {
  it("returns null when no row exists", async () => {
    const sb = mkSb([]);
    const out = await resolveStripLayout(sb as never, KEY, VARIANT);
    expect(out).toBeNull();
  });

  it("returns the layout when row exists", async () => {
    const sb = mkSb([mkRow({ anchor: "top-right" })]);
    const out = await resolveStripLayout(sb as never, KEY, VARIANT);
    expect(out?.anchor).toBe("top-right");
  });
});
