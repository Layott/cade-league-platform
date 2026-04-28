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
  getDesignTokens,
  resolveTokens,
  setDesignToken,
  clearDesignToken,
} from "./tokens";
import { BRAND_ACCENT, BRAND_BG } from "./defaults";

type Row = {
  overlay_key: string;
  variant_id: string;
  token_key: string;
  token_value: string;
  token_type: "color" | "font" | "number" | "boolean" | "enum" | "string";
  set_by: string;
  set_at: string;
};

const ACTOR = { userId: "u-1", roles: ["admin"] };
const KEY = "07-leaderboard";
const VARIANT = "default";

function rowsTable(rows: Row[]) {
  // Read chain: from().select(cols).eq(K,V).eq(K,V).is(D,null) → resolves rows.
  // Insert chain: from().insert(payload) → resolves error null (history insert).
  // Upsert chain: from().upsert(payload, opts).select(cols).single() → row.
  // Update chain (clear): from().update(payload).eq().eq().eq().is() → error null.
  const selectIs = vi.fn().mockResolvedValue({ data: rows, error: null });
  const insertResult = vi.fn().mockResolvedValue({ error: null });
  const upsertSingle = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null });
  const updateChain = vi
    .fn()
    .mockResolvedValue({ error: null });

  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({ is: selectIs })),
    })),
  }));

  const insert = vi.fn(() => insertResult());

  const upsert = vi.fn(() => ({
    select: vi.fn(() => ({ single: upsertSingle })),
  }));

  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => updateChain()),
        })),
      })),
    })),
  }));

  return {
    select,
    insert,
    upsert,
    update,
    _spies: { selectIs, insertResult, upsertSingle, updateChain },
  };
}

function mkSb(read: Row[], upsertReturn?: Row) {
  const tokensTable = rowsTable(read);
  if (upsertReturn) {
    tokensTable._spies.upsertSingle.mockResolvedValue({
      data: upsertReturn,
      error: null,
    });
  }
  const historyTable = {
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    from: vi.fn((t: string) => {
      if (t === "overlay_design_tokens") return tokensTable;
      if (t === "overlay_design_history") return historyTable;
      throw new Error(`unexpected table ${t}`);
    }),
    _tokens: tokensTable,
    _history: historyTable,
  };
}

describe("getDesignTokens", () => {
  beforeEach(() => requirePermAsyncMock.mockClear());

  it("returns empty map when no rows exist", async () => {
    const sb = mkSb([]);
    const out = await getDesignTokens(sb as never, KEY, VARIANT);
    expect(out).toEqual({});
  });

  it("maps rows to camelCase keyed by token_key", async () => {
    const r: Row = {
      overlay_key: KEY,
      variant_id: VARIANT,
      token_key: "accent-color",
      token_value: "#fe036d",
      token_type: "color",
      set_by: "u-1",
      set_at: "2026-04-29T08:00:00Z",
    };
    const sb = mkSb([r]);
    const out = await getDesignTokens(sb as never, KEY, VARIANT);
    expect(out["accent-color"]).toEqual({
      overlayKey: KEY,
      variantId: VARIANT,
      tokenKey: "accent-color",
      tokenValue: "#fe036d",
      tokenType: "color",
      setBy: "u-1",
      setAt: "2026-04-29T08:00:00Z",
    });
  });

  it("defaults variantId to 'default' when omitted", async () => {
    const sb = mkSb([]);
    await getDesignTokens(sb as never, KEY);
    expect(sb._tokens.select).toHaveBeenCalled();
  });
});

describe("resolveTokens — defaults vs DB merge", () => {
  it("returns full default map when no DB rows present", async () => {
    const sb = mkSb([]);
    const out = await resolveTokens(sb as never, KEY, VARIANT);
    // 07-leaderboard default overrides row-highlight-count to "3".
    expect(out["accent-color"]).toBe(BRAND_ACCENT);
    expect(out["bg-color"]).toBe(BRAND_BG);
    expect(out["row-highlight-count"]).toBe("3");
  });

  it("DB row overrides the hard-coded default", async () => {
    const r: Row = {
      overlay_key: KEY,
      variant_id: VARIANT,
      token_key: "accent-color",
      token_value: "#fe036d",
      token_type: "color",
      set_by: "u-1",
      set_at: "2026-04-29T08:00:00Z",
    };
    const sb = mkSb([r]);
    const out = await resolveTokens(sb as never, KEY, VARIANT);
    expect(out["accent-color"]).toBe("#fe036d");
    // Untouched defaults still present.
    expect(out["bg-color"]).toBe(BRAND_BG);
  });

  it("missing rows fall back to default for that key", async () => {
    const sb = mkSb([]);
    const out = await resolveTokens(sb as never, "01-brb", VARIANT);
    expect(out["partner-strip-show"]).toBe("true");
    expect(out.pattern).toBe("halftone");
  });
});

describe("setDesignToken", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects when actor lacks overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      setDesignToken(
        sb as never,
        ACTOR,
        KEY,
        VARIANT,
        "accent-color",
        "#fe036d",
        "color",
      ),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("throws when actor.userId is null", async () => {
    const sb = mkSb([]);
    await expect(
      setDesignToken(
        sb as never,
        { userId: null, roles: ["admin"] },
        KEY,
        VARIANT,
        "accent-color",
        "#fe036d",
        "color",
      ),
    ).rejects.toThrow(/no actor\.userId/);
  });

  it("writes a snapshot to history BEFORE upserting the token", async () => {
    const upsertedRow: Row = {
      overlay_key: KEY,
      variant_id: VARIANT,
      token_key: "accent-color",
      token_value: "#fe036d",
      token_type: "color",
      set_by: "u-1",
      set_at: "2026-04-29T09:00:00Z",
    };
    const sb = mkSb([], upsertedRow);
    const out = await setDesignToken(
      sb as never,
      ACTOR,
      KEY,
      VARIANT,
      "accent-color",
      "#fe036d",
      "color",
    );
    // History row inserted exactly once.
    expect(sb._history.insert).toHaveBeenCalledTimes(1);
    expect(sb._history.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        overlay_key: KEY,
        variant_id: VARIANT,
        changed_by: "u-1",
        reason: expect.stringContaining("set accent-color="),
      }),
    );
    expect(out.tokenValue).toBe("#fe036d");
    expect(out.tokenType).toBe("color");
  });
});

describe("clearDesignToken", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      clearDesignToken(sb as never, ACTOR, KEY, VARIANT, "accent-color"),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("snapshots prior state to history then soft-deletes the token", async () => {
    const r: Row = {
      overlay_key: KEY,
      variant_id: VARIANT,
      token_key: "accent-color",
      token_value: "#fe036d",
      token_type: "color",
      set_by: "u-1",
      set_at: "2026-04-29T09:00:00Z",
    };
    const sb = mkSb([r]);
    await clearDesignToken(sb as never, ACTOR, KEY, VARIANT, "accent-color");
    expect(sb._history.insert).toHaveBeenCalledTimes(1);
    expect(sb._history.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("clear accent-color"),
      }),
    );
    expect(sb._tokens.update).toHaveBeenCalled();
  });
});
