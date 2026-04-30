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
  listTextElements,
  getTextElement,
  upsertTextElement,
  deleteTextElement,
  restoreTextElement,
  resolveTextElements,
  isValidTextKind,
  TEXT_KINDS,
  type TextElementInput,
} from "./elements";

const ACTOR = { userId: "u-1", roles: ["admin"] };
const KEY = "07-leaderboard";
const VARIANT = "default";

type Row = {
  id: string;
  overlay_key: string;
  variant_id: string;
  element_id: string;
  origin: "seed" | "runtime";
  kind: string;
  display_label: string | null;
  visible: boolean;
  content: string;
  font_family: string | null;
  font_weight: number | null;
  font_size_px: number | null;
  letter_spacing: number | string | null;
  line_height: number | string | null;
  color: string | null;
  alignment: "left" | "center" | "right" | "justify" | null;
  opacity_pct: number | null;
  position_x_px: number | null;
  position_y_px: number | null;
  z_index: number | null;
  sort_order: number;
  set_by: string;
  created_at: string;
  updated_at: string;
};

function mkSeedRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "row-1",
    overlay_key: KEY,
    variant_id: VARIANT,
    element_id: "title",
    origin: "seed",
    kind: "title",
    display_label: null,
    visible: true,
    content: "",
    font_family: null,
    font_weight: null,
    font_size_px: null,
    letter_spacing: null,
    line_height: null,
    color: null,
    alignment: null,
    opacity_pct: null,
    position_x_px: null,
    position_y_px: null,
    z_index: null,
    sort_order: 0,
    set_by: "u-1",
    created_at: "2026-04-29T08:00:00Z",
    updated_at: "2026-04-29T08:00:00Z",
    ...overrides,
  };
}

function rowsTable(rows: Row[]) {
  const orderResult = vi.fn().mockResolvedValue({ data: rows, error: null });
  const isSelectThenOrder = vi.fn(() => ({ order: orderResult }));
  const maybeSingle = vi.fn().mockResolvedValue({
    data: rows[0] ?? null,
    error: null,
  });
  // SELECT-then-INSERT-or-UPDATE workaround chains (post partial-unique-index fix).
  // Synthesize a returnable row when the input rows[] is empty (INSERT path),
  // so toElement() doesn't NPE before the test gets to assert call shape.
  const writeRow: Row = rows[0] ?? mkSeedRow({ element_id: "title" });
  const writeSingle = vi
    .fn()
    .mockResolvedValue({ data: writeRow, error: null });
  const updateById = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({ single: writeSingle })),
    })),
  }));
  const insertChain = vi.fn(() => ({
    select: vi.fn(() => ({ single: writeSingle })),
  }));
  const updateNot = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null });
  const updateRestore = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          not: vi.fn(() => ({
            select: vi.fn(() => ({ single: updateNot })),
          })),
        })),
      })),
    })),
  }));
  const updateSoftDelete = vi.fn().mockResolvedValue({ error: null });
  const updateSoftDeleteChain = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ is: vi.fn(() => updateSoftDelete()) })),
      })),
    })),
  }));

  const update = vi.fn((..._args: unknown[]) => {
    // Three update shapes:
    //   1. .update({deleted_at:null,...}).eq().eq().eq().not()... — restore.
    //   2. .update({deleted_at:<iso>,...}).eq().eq().eq().is()    — soft-delete.
    //   3. .update(row).eq("id", X).select().single()             — upsert update branch.
    // Detect by inspecting the payload.
    const payload = _args[0] as { deleted_at: string | null };
    if (payload && payload.deleted_at === null && !("element_id" in payload)) {
      return updateRestore();
    }
    if (payload && typeof payload.deleted_at === "string") {
      return updateSoftDeleteChain();
    }
    // upsert UPDATE branch — payload includes element_id, set_by, etc.
    return updateById();
  });

  // Three select shapes:
  //   - list:   .select(SELECT_COLS).eq().eq().is().order()
  //   - single: .select(SELECT_COLS).eq().eq().eq().is().maybeSingle()
  //   - id:     .select("id").eq().eq().eq().is().maybeSingle() (upsert SELECT)
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: isSelectThenOrder,
        eq: vi.fn(() => ({
          is: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    })),
  }));

  return {
    select,
    update,
    insert: insertChain,
    _spies: {
      updateSoftDelete,
      updateNot,
      writeSingle,
      orderResult,
      maybeSingle,
    },
  };
}

function mkSb(rows: Row[]) {
  const table = rowsTable(rows);
  return {
    from: vi.fn((t: string) => {
      if (t !== "overlay_text_elements") {
        throw new Error(`unexpected table ${t}`);
      }
      return table;
    }),
    _table: table,
  };
}

describe("listTextElements", () => {
  it("returns empty array when no rows exist", async () => {
    const sb = mkSb([]);
    const out = await listTextElements(sb as never, KEY, VARIANT);
    expect(out).toEqual([]);
  });

  it("maps DB rows to camelCase TextElement objects", async () => {
    const r = mkSeedRow({
      element_id: "title",
      content: "GAME ON",
      color: "#fe036d",
      font_family: "Agharti",
      font_weight: 900,
      font_size_px: 120,
      letter_spacing: "0.04",
      line_height: "0.92",
      alignment: "center",
      opacity_pct: 90,
      position_x_px: 960,
      position_y_px: 70,
      z_index: 12,
      sort_order: 5,
    });
    const sb = mkSb([r]);
    const out = await listTextElements(sb as never, KEY, VARIANT);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      elementId: "title",
      content: "GAME ON",
      color: "#fe036d",
      fontFamily: "Agharti",
      fontWeight: 900,
      fontSizePx: 120,
      letterSpacing: 0.04,
      lineHeight: 0.92,
      alignment: "center",
      opacityPct: 90,
      positionXPx: 960,
      positionYPx: 70,
      zIndex: 12,
      sortOrder: 5,
    });
  });

  it("defaults variantId to 'default'", async () => {
    const sb = mkSb([]);
    await listTextElements(sb as never, KEY);
    expect(sb._table.select).toHaveBeenCalled();
  });
});

describe("getTextElement", () => {
  it("returns null when no row exists", async () => {
    const sb = mkSb([]);
    const out = await getTextElement(sb as never, KEY, VARIANT, "title");
    expect(out).toBeNull();
  });

  it("returns the mapped element when row exists", async () => {
    const r = mkSeedRow({ element_id: "title", content: "X" });
    const sb = mkSb([r]);
    const out = await getTextElement(sb as never, KEY, VARIANT, "title");
    expect(out?.elementId).toBe("title");
    expect(out?.content).toBe("X");
  });
});

describe("upsertTextElement — perm + validation", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects when actor lacks overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    const input: TextElementInput = {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "title",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "GAME ON",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
    };
    await expect(upsertTextElement(sb as never, ACTOR, input)).rejects.toThrow(
      /overlay\.design\.manage/,
    );
  });

  it("throws when actor.userId is null", async () => {
    const sb = mkSb([]);
    const input: TextElementInput = {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "title",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "X",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
    };
    await expect(
      upsertTextElement(
        sb as never,
        { userId: null, roles: ["admin"] },
        input,
      ),
    ).rejects.toThrow(/no actor\.userId/);
  });

  it("rejects unknown overlay key", async () => {
    const sb = mkSb([]);
    const input: TextElementInput = {
      overlayKey: "99-fake",
      variantId: VARIANT,
      elementId: "title",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "X",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
    };
    await expect(upsertTextElement(sb as never, ACTOR, input)).rejects.toThrow(
      /unknown overlay key/,
    );
  });

  it("rejects invalid element_id", async () => {
    const sb = mkSb([]);
    const input: TextElementInput = {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "Has Space",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
    };
    await expect(upsertTextElement(sb as never, ACTOR, input)).rejects.toThrow(
      /invalid element_id/,
    );
  });

  it("rejects runtime element without content", async () => {
    const sb = mkSb([]);
    const input: TextElementInput = {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "new-runtime",
      origin: "runtime",
      kind: "caption",
      visible: true,
      content: "",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: 800,
      positionYPx: 400,
      zIndex: null,
      sortOrder: 0,
    };
    await expect(upsertTextElement(sb as never, ACTOR, input)).rejects.toThrow(
      /non-empty content/,
    );
  });

  it("rejects runtime element without position", async () => {
    const sb = mkSb([]);
    const input: TextElementInput = {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "new-runtime",
      origin: "runtime",
      kind: "caption",
      visible: true,
      content: "Hi",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: 400,
      zIndex: null,
      sortOrder: 0,
    };
    await expect(upsertTextElement(sb as never, ACTOR, input)).rejects.toThrow(
      /positionXPx/,
    );
  });

  it("rejects font outside brand allowlist", async () => {
    const sb = mkSb([]);
    const input: TextElementInput = {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "title",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "",
      fontFamily: "Comic Sans MS",
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
    };
    await expect(upsertTextElement(sb as never, ACTOR, input)).rejects.toThrow(
      /Comic Sans/,
    );
  });

  it("rejects invalid color", async () => {
    const sb = mkSb([]);
    const input: TextElementInput = {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "title",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: "javascript:alert(1)",
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
    };
    await expect(upsertTextElement(sb as never, ACTOR, input)).rejects.toThrow(
      /invalid color/,
    );
  });

  it("UPDATEs an existing seed override (partial-unique-index workaround)", async () => {
    // Existing row in mock → SELECT-first finds it → UPDATE branch.
    const r = mkSeedRow({
      element_id: "title",
      content: "GAME ON",
      color: "#fe036d",
    });
    const sb = mkSb([r]);
    const input: TextElementInput = {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "title",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "GAME ON",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: "#fe036d",
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
    };
    const out = await upsertTextElement(sb as never, ACTOR, input);
    expect(out.elementId).toBe("title");
    expect(out.content).toBe("GAME ON");
    // Confirm UPDATE branch (NOT .upsert, which Supabase JS rejects with PG 42P10
    // against the partial unique index on this table).
    expect(sb._table.update).toHaveBeenCalled();
    expect(sb._table.insert).not.toHaveBeenCalled();
  });

  it("INSERTs when no existing row (partial-unique-index workaround)", async () => {
    // Empty rows → SELECT-first returns null → INSERT branch.
    const sb = mkSb([]);
    const input: TextElementInput = {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "title",
      origin: "runtime",
      kind: "title",
      visible: true,
      content: "BRAND NEW",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: 100,
      positionYPx: 100,
      zIndex: null,
      sortOrder: 0,
    };
    await upsertTextElement(sb as never, ACTOR, input);
    expect(sb._table.insert).toHaveBeenCalled();
    expect(sb._table.update).not.toHaveBeenCalled();
  });
});

describe("deleteTextElement", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([mkSeedRow({ origin: "runtime" })]);
    await expect(
      deleteTextElement(sb as never, ACTOR, KEY, VARIANT, "title"),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("rejects deleting a seed row", async () => {
    const sb = mkSb([mkSeedRow({ element_id: "title", origin: "seed" })]);
    await expect(
      deleteTextElement(sb as never, ACTOR, KEY, VARIANT, "title"),
    ).rejects.toThrow(/seed rows cannot be deleted/);
  });

  it("rejects when row is missing", async () => {
    const sb = mkSb([]);
    await expect(
      deleteTextElement(sb as never, ACTOR, KEY, VARIANT, "ghost"),
    ).rejects.toThrow(/not found/);
  });

  it("soft-deletes a runtime row", async () => {
    const sb = mkSb([
      mkSeedRow({ element_id: "extra", origin: "runtime", content: "X" }),
    ]);
    await deleteTextElement(sb as never, ACTOR, KEY, VARIANT, "extra");
    expect(sb._table.update).toHaveBeenCalled();
  });
});

describe("resolveTextElements — effective-map merge", () => {
  it("returns empty map when only seed-noop rows exist", async () => {
    const sb = mkSb([mkSeedRow({ element_id: "title", content: "" })]);
    const out = await resolveTextElements(sb as never, KEY, VARIANT);
    expect(out).toEqual({});
  });

  it("includes seed rows with content overrides", async () => {
    const sb = mkSb([
      mkSeedRow({ element_id: "title", content: "GAME ON" }),
    ]);
    const out = await resolveTextElements(sb as never, KEY, VARIANT);
    expect(out["title"]).toBeDefined();
    expect(out["title"].content).toBe("GAME ON");
  });

  it("includes seed rows with style-only overrides", async () => {
    const sb = mkSb([
      mkSeedRow({ element_id: "title", color: "#fe036d", font_size_px: 120 }),
    ]);
    const out = await resolveTextElements(sb as never, KEY, VARIANT);
    expect(out["title"].styles.color).toBe("#fe036d");
    expect(out["title"].styles.fontSize).toBe("120px");
  });

  it("includes hidden seed rows", async () => {
    const sb = mkSb([mkSeedRow({ element_id: "title", visible: false })]);
    const out = await resolveTextElements(sb as never, KEY, VARIANT);
    expect(out["title"].visible).toBe(false);
  });

  it("ALWAYS includes runtime rows even with no overrides", async () => {
    const sb = mkSb([
      mkSeedRow({
        element_id: "extra",
        origin: "runtime",
        content: "Caster: KILLER FREAK",
        position_x_px: 800,
        position_y_px: 400,
      }),
    ]);
    const out = await resolveTextElements(sb as never, KEY, VARIANT);
    expect(out["extra"]).toBeDefined();
    expect(out["extra"].origin).toBe("runtime");
    expect(out["extra"].content).toBe("Caster: KILLER FREAK");
    expect(out["extra"].styles.left).toBe("800px");
    expect(out["extra"].styles.top).toBe("400px");
  });

  it("converts opacity_pct to a 0-1 fraction", async () => {
    const sb = mkSb([mkSeedRow({ element_id: "title", opacity_pct: 90 })]);
    const out = await resolveTextElements(sb as never, KEY, VARIANT);
    expect(out["title"].styles.opacity).toBe(0.9);
  });

  it("formats letter-spacing with em suffix", async () => {
    const sb = mkSb([
      mkSeedRow({ element_id: "title", letter_spacing: "0.04" }),
    ]);
    const out = await resolveTextElements(sb as never, KEY, VARIANT);
    expect(out["title"].styles.letterSpacing).toBe("0.04em");
  });
});

describe("restoreTextElement", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([mkSeedRow()]);
    await expect(
      restoreTextElement(sb as never, ACTOR, KEY, VARIANT, "title"),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });
});

/* ------------------------------------------------------------------ *
 * Universal element labels + kinds (post-2026-04-28)                 *
 * Migration: 20260620000010_overlay_text_elements_kind.sql           *
 * ------------------------------------------------------------------ */

describe("TEXT_KINDS allowlist", () => {
  it("accepts every legacy typographic kind", () => {
    for (const k of [
      "heading",
      "subheading",
      "eyebrow",
      "title",
      "subtitle",
      "caption",
      "number",
      "label",
      "body",
      "image",
      "layout",
    ]) {
      expect(isValidTextKind(k)).toBe(true);
    }
  });

  it("accepts every new semantic kind", () => {
    for (const k of [
      "text",
      "score-number",
      "player-name",
      "player-photo",
      "player-box",
      "sponsor-logo-strip",
      "sponsor-logo-floating",
      "partner-strip-container",
      "bg-image",
      "bg-vignette",
      "box",
    ]) {
      expect(isValidTextKind(k)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isValidTextKind("not-a-kind")).toBe(false);
    expect(isValidTextKind("")).toBe(false);
    expect(isValidTextKind(null)).toBe(false);
    expect(isValidTextKind(undefined)).toBe(false);
    expect(isValidTextKind(42)).toBe(false);
  });

  it("TEXT_KINDS array contains all 22 entries", () => {
    expect(TEXT_KINDS.length).toBe(22);
  });
});

describe("upsertTextElement — kind validation", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  function mkInput(overrides: Partial<TextElementInput> = {}): TextElementInput {
    return {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "title",
      origin: "seed",
      kind: "title",
      displayLabel: null,
      visible: true,
      content: "",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
      ...overrides,
    };
  }

  it("rejects unknown kind", async () => {
    const sb = mkSb([]);
    await expect(
      upsertTextElement(
        sb as never,
        ACTOR,
        mkInput({ kind: "not-a-kind" as never }),
      ),
    ).rejects.toThrow(/invalid kind/);
  });

  it("accepts new semantic kind player-photo", async () => {
    const r = mkSeedRow({ element_id: "title", kind: "player-photo" });
    const sb = mkSb([r]);
    const out = await upsertTextElement(
      sb as never,
      ACTOR,
      mkInput({ kind: "player-photo" }),
    );
    expect(out.kind).toBe("player-photo");
  });

  it("accepts new semantic kind partner-strip-container", async () => {
    const r = mkSeedRow({
      element_id: "partners-strip",
      kind: "partner-strip-container",
    });
    const sb = mkSb([r]);
    const out = await upsertTextElement(
      sb as never,
      ACTOR,
      mkInput({
        elementId: "partners-strip",
        kind: "partner-strip-container",
      }),
    );
    expect(out.kind).toBe("partner-strip-container");
  });
});

describe("upsertTextElement — displayLabel persistence", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("persists displayLabel on upsert", async () => {
    const r = mkSeedRow({
      element_id: "title",
      kind: "heading",
      display_label: "BRB Title",
    });
    const sb = mkSb([r]);
    const out = await upsertTextElement(sb as never, ACTOR, {
      overlayKey: KEY,
      variantId: VARIANT,
      elementId: "title",
      origin: "seed",
      kind: "heading",
      displayLabel: "BRB Title",
      visible: true,
      content: "",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
    });
    expect(out.displayLabel).toBe("BRB Title");
  });

  it("rejects empty-string displayLabel", async () => {
    const sb = mkSb([]);
    await expect(
      upsertTextElement(sb as never, ACTOR, {
        overlayKey: KEY,
        variantId: VARIANT,
        elementId: "title",
        origin: "seed",
        kind: "title",
        displayLabel: "",
        visible: true,
        content: "",
        fontFamily: null,
        fontWeight: null,
        fontSizePx: null,
        letterSpacing: null,
        lineHeight: null,
        color: null,
        alignment: null,
        opacityPct: null,
        positionXPx: null,
        positionYPx: null,
        zIndex: null,
        sortOrder: 0,
      }),
    ).rejects.toThrow(/displayLabel must be 1\.\.200/);
  });

  it("rejects displayLabel longer than 200 chars", async () => {
    const sb = mkSb([]);
    const tooLong = "A".repeat(201);
    await expect(
      upsertTextElement(sb as never, ACTOR, {
        overlayKey: KEY,
        variantId: VARIANT,
        elementId: "title",
        origin: "seed",
        kind: "title",
        displayLabel: tooLong,
        visible: true,
        content: "",
        fontFamily: null,
        fontWeight: null,
        fontSizePx: null,
        letterSpacing: null,
        lineHeight: null,
        color: null,
        alignment: null,
        opacityPct: null,
        positionXPx: null,
        positionYPx: null,
        zIndex: null,
        sortOrder: 0,
      }),
    ).rejects.toThrow(/displayLabel must be 1\.\.200/);
  });

  it("listTextElements maps display_label to displayLabel", async () => {
    const r = mkSeedRow({
      element_id: "partners-strip",
      kind: "partner-strip-container",
      display_label: "Partners Strip",
    });
    const sb = mkSb([r]);
    const out = await listTextElements(sb as never, KEY, VARIANT);
    expect(out[0].displayLabel).toBe("Partners Strip");
    expect(out[0].kind).toBe("partner-strip-container");
  });

  it("getTextElement returns NULL displayLabel for unbackfilled rows", async () => {
    const r = mkSeedRow({ display_label: null });
    const sb = mkSb([r]);
    const out = await getTextElement(sb as never, KEY, VARIANT, "title");
    expect(out?.displayLabel).toBeNull();
  });
});
