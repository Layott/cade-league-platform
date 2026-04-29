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
  listAnimations,
  getAnimation,
  upsertAnimation,
  deleteAnimation,
  resolveAnimations,
  buildKeyframesBody,
  type ElementAnimationInput,
  type AnimPhase,
} from "./elements";

const ACTOR = { userId: "u-1", roles: ["admin"] };
const KEY = "01-brb";
const VARIANT = "default";

type Row = {
  id: string;
  overlay_key: string;
  variant_id: string;
  element_id: string;
  anim_phase: AnimPhase;
  enabled: boolean;
  anim_type: string;
  duration_ms: number;
  delay_ms: number;
  easing: string;
  iteration_count: string;
  custom_css_keyframes: string | null;
  set_by: string;
  created_at: string;
  updated_at: string;
};

function mkRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "row-1",
    overlay_key: KEY,
    variant_id: VARIANT,
    element_id: "title",
    anim_phase: "entry",
    enabled: true,
    anim_type: "slide-down",
    duration_ms: 600,
    delay_ms: 200,
    easing: "ease-out",
    iteration_count: "1",
    custom_css_keyframes: null,
    set_by: "u-1",
    created_at: "2026-04-29T08:00:00Z",
    updated_at: "2026-04-29T08:00:00Z",
    ...overrides,
  };
}

function rowsTable(rows: Row[]) {
  const isResult = vi.fn().mockResolvedValue({ data: rows, error: null });
  const maybeSingleResult = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null });
  const upsertSingle = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null });
  const updateChain = vi.fn().mockResolvedValue({ error: null });

  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: isResult,
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({ maybeSingle: maybeSingleResult })),
          })),
        })),
      })),
    })),
  }));
  const upsert = vi.fn(() => ({
    select: vi.fn(() => ({ single: upsertSingle })),
  }));
  // update() supports two chains:
  //   1. .update().eq().eq().eq().eq().is() — soft-delete in deleteAnimation
  //   2. .update().eq().select().single() — upsertAnimation update branch
  //      (post partial-unique-index workaround b7b3deff pattern)
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => updateChain()),
          })),
        })),
      })),
      select: vi.fn(() => ({ single: upsertSingle })),
    })),
  }));
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({ single: upsertSingle })),
  }));
  return {
    select,
    upsert,
    update,
    insert,
    _spies: { isResult, maybeSingleResult, upsertSingle, updateChain },
  };
}

function mkSb(rows: Row[]) {
  const t = rowsTable(rows);
  return {
    from: vi.fn((tbl: string) => {
      if (tbl !== "overlay_element_animations") {
        throw new Error(`unexpected table ${tbl}`);
      }
      return t;
    }),
    _table: t,
  };
}

const VALID_INPUT: ElementAnimationInput = {
  overlayKey: KEY,
  variantId: VARIANT,
  elementId: "title",
  animPhase: "entry",
  enabled: true,
  animType: "slide-down",
  durationMs: 600,
  delayMs: 200,
  easing: "ease-out",
  iterationCount: "1",
  customCssKeyframes: null,
};

describe("listAnimations", () => {
  it("returns empty when none exist", async () => {
    const sb = mkSb([]);
    const out = await listAnimations(sb as never, KEY, VARIANT);
    expect(out).toEqual([]);
  });

  it("maps rows", async () => {
    const sb = mkSb([mkRow({ element_id: "title", anim_type: "slide-down" })]);
    const out = await listAnimations(sb as never, KEY, VARIANT);
    expect(out).toHaveLength(1);
    expect(out[0].animType).toBe("slide-down");
    expect(out[0].durationMs).toBe(600);
  });
});

describe("getAnimation", () => {
  it("returns null when missing", async () => {
    const sb = mkSb([]);
    const out = await getAnimation(sb as never, KEY, VARIANT, "title", "entry");
    expect(out).toBeNull();
  });

  it("returns the mapped row", async () => {
    const sb = mkSb([mkRow()]);
    const out = await getAnimation(sb as never, KEY, VARIANT, "title", "entry");
    expect(out?.elementId).toBe("title");
  });
});

describe("upsertAnimation — perm + validation", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, VALID_INPUT),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("throws when actor.userId is null", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(
        sb as never,
        { userId: null, roles: ["admin"] },
        VALID_INPUT,
      ),
    ).rejects.toThrow(/no actor\.userId/);
  });

  it("rejects unknown overlay key", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        overlayKey: "99-fake",
      }),
    ).rejects.toThrow(/unknown overlay key/);
  });

  it("rejects invalid element_id", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        elementId: "Bad Id",
      }),
    ).rejects.toThrow(/invalid element_id/);
  });

  it("rejects invalid anim_phase", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        animPhase: "lol" as never,
      }),
    ).rejects.toThrow(/anim_phase/);
  });

  it("rejects invalid anim_type", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        animType: "spin" as never,
      }),
    ).rejects.toThrow(/anim_type/);
  });

  it("rejects duration out of range", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, { ...VALID_INPUT, durationMs: 49 }),
    ).rejects.toThrow(/duration_ms/);
    await expect(
      upsertAnimation(sb as never, ACTOR, { ...VALID_INPUT, durationMs: 5001 }),
    ).rejects.toThrow(/duration_ms/);
  });

  it("rejects delay out of range", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, { ...VALID_INPUT, delayMs: -1 }),
    ).rejects.toThrow(/delay_ms/);
    await expect(
      upsertAnimation(sb as never, ACTOR, { ...VALID_INPUT, delayMs: 5001 }),
    ).rejects.toThrow(/delay_ms/);
  });

  it("rejects invalid easing", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        easing: "bouncy",
      }),
    ).rejects.toThrow(/easing/);
  });

  it("accepts cubic-bezier easing", async () => {
    const sb = mkSb([mkRow({ easing: "cubic-bezier(0.16, 1, 0.3, 1)" })]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      }),
    ).resolves.toBeDefined();
  });

  it("rejects invalid iteration_count", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        iterationCount: "0",
      }),
    ).rejects.toThrow(/iteration_count/);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        iterationCount: "101",
      }),
    ).rejects.toThrow(/iteration_count/);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        iterationCount: "five",
      }),
    ).rejects.toThrow(/iteration_count/);
  });

  it("accepts 'infinite' iteration_count", async () => {
    const sb = mkSb([mkRow({ iteration_count: "infinite" })]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        iterationCount: "infinite",
      }),
    ).resolves.toBeDefined();
  });

  it("rejects custom-css without payload", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        animType: "custom-css",
        customCssKeyframes: null,
      }),
    ).rejects.toThrow(/customCssKeyframes/);
  });

  it("rejects custom-css with forbidden url()", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        animType: "custom-css",
        customCssKeyframes: "0% { background-color: url(http://x) } 100% { opacity:1 }",
      }),
    ).rejects.toThrow(/keyframes sanitize failed|url|forbidden/i);
  });

  it("rejects non-custom-css carrying customCssKeyframes", async () => {
    const sb = mkSb([]);
    await expect(
      upsertAnimation(sb as never, ACTOR, {
        ...VALID_INPUT,
        customCssKeyframes: "0% { opacity: 0 }",
      }),
    ).rejects.toThrow(/customCssKeyframes only allowed when animType='custom-css'/);
  });

  it("upserts a valid animation", async () => {
    const sb = mkSb([mkRow()]);
    const out = await upsertAnimation(sb as never, ACTOR, VALID_INPUT);
    expect(out.elementId).toBe("title");
    // Post partial-unique-index workaround: upsertAnimation does
    // SELECT-then-INSERT-or-UPDATE (b7b3deff pattern), not .upsert().
    // mkSb([mkRow()]) returns existing row → UPDATE branch.
    expect(sb._table.update).toHaveBeenCalled();
  });

  it("sanitizes + persists custom-css", async () => {
    const sb = mkSb([
      mkRow({
        anim_type: "custom-css",
        custom_css_keyframes: "0% { opacity: 0 } 100% { opacity: 1 }",
      }),
    ]);
    const out = await upsertAnimation(sb as never, ACTOR, {
      ...VALID_INPUT,
      animType: "custom-css",
      customCssKeyframes: "  0%   {  opacity: 0  }  100% { opacity: 1 }  ",
    });
    expect(out.animType).toBe("custom-css");
  });
});

describe("deleteAnimation", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      deleteAnimation(sb as never, ACTOR, KEY, VARIANT, "title", "entry"),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("soft-deletes the row", async () => {
    const sb = mkSb([mkRow()]);
    await deleteAnimation(sb as never, ACTOR, KEY, VARIANT, "title", "entry");
    expect(sb._table.update).toHaveBeenCalled();
  });
});

describe("buildKeyframesBody", () => {
  it("returns slide-left body", () => {
    const r = mkRow({ anim_type: "slide-left" });
    const body = buildKeyframesBody({
      ...{ ...mapRow(r) },
    });
    expect(body).toMatch(/translateX\(-32px\)/);
    expect(body).toMatch(/translateX\(0\)/);
  });

  it("returns fade body", () => {
    const body = buildKeyframesBody(mapRow(mkRow({ anim_type: "fade" })));
    expect(body).toBe("from{opacity:0}to{opacity:1}");
  });

  it("returns the custom-css body verbatim when sanitized", () => {
    const body = buildKeyframesBody(
      mapRow(
        mkRow({
          anim_type: "custom-css",
          custom_css_keyframes: "0% { opacity: 0 } 100% { opacity: 1 }",
        }),
      ),
    );
    expect(body).toBe("0% { opacity: 0 } 100% { opacity: 1 }");
  });

  it("returns empty for 'none'", () => {
    const body = buildKeyframesBody(mapRow(mkRow({ anim_type: "none" })));
    expect(body).toBe("");
  });
});

function mapRow(r: Row) {
  return {
    id: r.id,
    overlayKey: r.overlay_key,
    variantId: r.variant_id,
    elementId: r.element_id,
    animPhase: r.anim_phase,
    enabled: r.enabled,
    animType: r.anim_type as never,
    durationMs: r.duration_ms,
    delayMs: r.delay_ms,
    easing: r.easing,
    iterationCount: r.iteration_count,
    customCssKeyframes: r.custom_css_keyframes,
    setBy: r.set_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

describe("resolveAnimations — effective map", () => {
  it("returns empty when nothing enabled", async () => {
    const sb = mkSb([mkRow({ enabled: false })]);
    const out = await resolveAnimations(sb as never, KEY, VARIANT);
    expect(out).toEqual({});
  });

  it("skips anim_type='none'", async () => {
    const sb = mkSb([mkRow({ anim_type: "none" })]);
    const out = await resolveAnimations(sb as never, KEY, VARIANT);
    expect(out).toEqual({});
  });

  it("emits keyframesCss + animationRule per phase", async () => {
    const sb = mkSb([mkRow({ element_id: "title", anim_type: "slide-down" })]);
    const out = await resolveAnimations(sb as never, KEY, VARIANT);
    expect(out["title"]).toBeDefined();
    expect(out["title"].entry).toBeDefined();
    expect(out["title"].entry?.keyframesCss).toMatch(/cade-title-entry/);
    expect(out["title"].entry?.animationRule).toMatch(/cade-title-entry/);
    expect(out["title"].entry?.animationRule).toMatch(/600ms/);
    expect(out["title"].entry?.animationRule).toMatch(/ease-out/);
    expect(out["title"].entry?.animationRule).toMatch(/200ms/);
  });

  it("supports multiple phases per element", async () => {
    const sb = mkSb([
      mkRow({ element_id: "title", anim_phase: "entry", anim_type: "fade" }),
      mkRow({
        id: "row-2",
        element_id: "title",
        anim_phase: "continuous",
        anim_type: "pulse",
        iteration_count: "infinite",
      }),
      mkRow({
        id: "row-3",
        element_id: "title",
        anim_phase: "exit",
        anim_type: "fade",
      }),
    ]);
    const out = await resolveAnimations(sb as never, KEY, VARIANT);
    expect(out["title"].entry).toBeDefined();
    expect(out["title"].continuous).toBeDefined();
    expect(out["title"].exit).toBeDefined();
    expect(out["title"].continuous?.animationRule).toMatch(/infinite/);
  });
});
