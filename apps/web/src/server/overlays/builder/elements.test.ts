import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addElement,
  cloneElement,
  deleteElement,
  reorderElements,
  updateElement,
  updateElements,
} from "./elements";

type FakeRow = Record<string, unknown>;
type FakeTable = {
  rows: FakeRow[];
  insertedRows: FakeRow[];
};

function makeFakeSb() {
  const tables: Record<string, FakeTable> = {
    overlay_user_design_elements: { rows: [], insertedRows: [] },
  };
  const builder = (tableName: string) => {
    const tbl = tables[tableName];
    const filters: Array<{ col: string; val: unknown }> = [];
    const api: Record<string, unknown> = {};
    api.select = vi.fn(() => api);
    api.insert = vi.fn((row: FakeRow) => {
      const stamped = { id: `id-${tbl.insertedRows.length + 1}`, ...row };
      tbl.insertedRows.push(stamped);
      tbl.rows.push(stamped);
      return {
        select: () => ({
          single: async () => ({ data: stamped, error: null }),
        }),
      };
    });
    api.update = vi.fn((patch: FakeRow) => {
      return {
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return {
            select: () => ({
              single: async () => {
                const match = tbl.rows.find((r) =>
                  filters.every((f) => r[f.col] === f.val),
                );
                if (match) Object.assign(match, patch);
                return { data: match ?? null, error: null };
              },
            }),
          };
        },
      };
    });
    api.eq = vi.fn((col: string, val: unknown) => {
      filters.push({ col, val });
      return api;
    });
    api.is = vi.fn(() => api);
    api.maybeSingle = vi.fn(async () => {
      const match = tbl.rows.find((r) =>
        filters.every((f) => r[f.col] === f.val),
      );
      return { data: match ?? null, error: null };
    });
    api.then = (resolve: unknown) => {
      const matched = tbl.rows.filter((r) =>
        filters.every((f) => r[f.col] === f.val),
      );
      return Promise.resolve({ data: matched, error: null }).then(
        resolve as (v: unknown) => unknown,
      );
    };
    return api;
  };
  return {
    from: vi.fn((tableName: string) => builder(tableName)),
    _tables: tables,
  };
}

const VALID_TEXT_INPUT = {
  elementType: "text" as const,
  transform: {
    x: 0,
    y: 0,
    width: 400,
    height: 80,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  },
  style: {
    fontFamily: "Agharti",
    fontSize: 64,
    color: "#ffffff",
  },
  content: { text: "Hello" },
  binding: null,
  animation: {},
  parentGroupId: null,
};

describe("elements.ts — add/update/delete", () => {
  let sb: ReturnType<typeof makeFakeSb>;
  beforeEach(() => {
    sb = makeFakeSb();
  });

  it("addElement validates + inserts a text element", async () => {
    const el = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    expect(el.elementType).toBe("text");
    expect(el.sceneId).toBe("scene-1");
    expect(sb._tables.overlay_user_design_elements.insertedRows.length).toBe(1);
  });

  it("addElement preserves client-provided id when supplied (Bug 4)", async () => {
    const clientUuid = "11111111-1111-4111-8111-111111111111";
    await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      { ...VALID_TEXT_INPUT, id: clientUuid },
    );
    const inserted = sb._tables.overlay_user_design_elements.insertedRows[0];
    expect(inserted.id).toBe(clientUuid);
  });

  it("addElement still works when no explicit id is supplied", async () => {
    const el = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    // The fake-sb stamps an id when the row didn't include one.
    expect(el.id).toMatch(/^id-/);
  });

  it("addElement rejects bad style (missing fontFamily on text)", async () => {
    await expect(
      addElement(sb as unknown as Parameters<typeof addElement>[0], "scene-1", {
        ...VALID_TEXT_INPUT,
        style: { fontSize: 64, color: "#fff" },
      }),
    ).rejects.toThrow(/style|fontFamily/i);
  });

  it("addElement rejects bad binding (eval inside template)", async () => {
    await expect(
      addElement(sb as unknown as Parameters<typeof addElement>[0], "scene-1", {
        ...VALID_TEXT_INPUT,
        binding: {
          feed: "standings",
          fieldPath: "[0].name",
          templateString: "${eval(x)}",
        },
      }),
    ).rejects.toThrow(/templateString|eval|interpolation/i);
  });

  it("addElement rejects bad animation (invalid easing)", async () => {
    await expect(
      addElement(sb as unknown as Parameters<typeof addElement>[0], "scene-1", {
        ...VALID_TEXT_INPUT,
        animation: {
          entry: {
            type: "fade",
            durationMs: 240,
            delayMs: 0,
            easing: "ease-into-the-void",
          },
        },
      }),
    ).rejects.toThrow(/easing/i);
  });

  it("updateElement patches transform only", async () => {
    const el = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    await updateElement(
      sb as unknown as Parameters<typeof updateElement>[0],
      el.id,
      { transform: { ...VALID_TEXT_INPUT.transform, x: 100, y: 50 } },
    );
    const row = sb._tables.overlay_user_design_elements.rows.find(
      (r) => r.id === el.id,
    );
    expect((row?.transform as { x: number; y: number }).x).toBe(100);
  });

  it("deleteElement sets deleted_at on the row", async () => {
    const el = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    await deleteElement(
      sb as unknown as Parameters<typeof deleteElement>[0],
      el.id,
    );
    const row = sb._tables.overlay_user_design_elements.rows.find(
      (r) => r.id === el.id,
    );
    expect(row?.deleted_at).not.toBeNull();
  });

  it("reorderElements bulk-reassigns z_index", async () => {
    const a = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    const b = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    const c = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    await reorderElements(
      sb as unknown as Parameters<typeof reorderElements>[0],
      "scene-1",
      [c.id, b.id, a.id],
    );
    const find = (id: string) =>
      sb._tables.overlay_user_design_elements.rows.find((r) => r.id === id);
    expect(find(c.id)?.z_index).toBe(0);
    expect(find(b.id)?.z_index).toBe(1);
    expect(find(a.id)?.z_index).toBe(2);
  });

  it("updateElements bulk-applies patches to multiple elements", async () => {
    const a = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    const b = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    const mockActor = { userId: "u-1", roles: ["admin"] as readonly string[] };
    const updated = await updateElements(
      sb as unknown as Parameters<typeof updateElements>[0],
      mockActor,
      "design-1",
      [
        { id: a.id, patch: { locked: true } },
        { id: b.id, patch: { visible: false } },
      ],
    );
    expect(updated).toEqual([a.id, b.id]);
    const rowA = sb._tables.overlay_user_design_elements.rows.find((r) => r.id === a.id);
    expect(rowA?.locked).toBe(true);
    const rowB = sb._tables.overlay_user_design_elements.rows.find((r) => r.id === b.id);
    expect(rowB?.visible).toBe(false);
  });

  it("cloneElement duplicates with +20px offset on x/y", async () => {
    const el = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    const clone = await cloneElement(
      sb as unknown as Parameters<typeof cloneElement>[0],
      el.id,
    );
    expect(clone.id).not.toBe(el.id);
    expect(clone.transform.x).toBe(20);
    expect(clone.transform.y).toBe(20);
  });
});

// ────────────── Wave 3B — advancedTimeline round-trip ──────────────
//
// PresetAnimSchema (types.ts) gained `advancedTimeline` in Task 1.
// validateAnimation (animation-validator.ts) parses + validates the
// extended shape but used to strip it from the returned value; the
// compiler reads `anim.advancedTimeline` off the persisted row, so the
// CRUD save path MUST round-trip the field intact. These tests guard
// against regression in either direction (insert + update + clear).
describe("elements.ts — Wave 3B advancedTimeline round-trip", () => {
  let sb: ReturnType<typeof makeFakeSb>;
  beforeEach(() => {
    sb = makeFakeSb();
  });

  const TIMELINE_ENTRY = {
    type: "noop" as const,
    durationMs: 1000,
    delayMs: 0,
    easing: "linear",
    advancedTimeline: [
      {
        property: "opacity" as const,
        keyframes: [
          { id: "k1", timeMs: 0, value: 0, easingOut: null },
          { id: "k2", timeMs: 1000, value: 1, easingOut: null },
        ],
      },
    ],
  };

  const TIMELINE_EXIT = {
    type: "noop" as const,
    durationMs: 600,
    delayMs: 0,
    easing: "linear",
    advancedTimeline: [
      {
        property: "opacity" as const,
        keyframes: [
          { id: "x1", timeMs: 0, value: 1, easingOut: null },
          { id: "x2", timeMs: 600, value: 0, easingOut: null },
        ],
      },
    ],
  };

  it("addElement persists advancedTimeline on entry phase through insert", async () => {
    const el = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      {
        ...VALID_TEXT_INPUT,
        animation: { entry: TIMELINE_ENTRY },
      },
    );
    const row = sb._tables.overlay_user_design_elements.rows.find(
      (r) => r.id === el.id,
    );
    expect(row).toBeDefined();
    const anim = row?.animation as {
      entry?: { advancedTimeline?: typeof TIMELINE_ENTRY.advancedTimeline };
    };
    expect(anim.entry?.advancedTimeline).toEqual(TIMELINE_ENTRY.advancedTimeline);
    // Compiler key invariant — preset `type` stays `noop` so the
    // mutual-exclusivity branch in animation-validator.ts holds.
    expect(
      (row?.animation as { entry?: { type?: string } }).entry?.type,
    ).toBe("noop");
  });

  it("updateElement adds advancedTimeline to exit phase on a previously-empty animation", async () => {
    const el = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      VALID_TEXT_INPUT,
    );
    await updateElement(
      sb as unknown as Parameters<typeof updateElement>[0],
      el.id,
      { animation: { exit: TIMELINE_EXIT } },
    );
    const row = sb._tables.overlay_user_design_elements.rows.find(
      (r) => r.id === el.id,
    );
    const anim = row?.animation as {
      exit?: { advancedTimeline?: typeof TIMELINE_EXIT.advancedTimeline };
    };
    expect(anim.exit?.advancedTimeline).toEqual(TIMELINE_EXIT.advancedTimeline);
  });

  it("updateElement clears advancedTimeline by overwriting with empty animation", async () => {
    const el = await addElement(
      sb as unknown as Parameters<typeof addElement>[0],
      "scene-1",
      {
        ...VALID_TEXT_INPUT,
        animation: { entry: TIMELINE_ENTRY },
      },
    );
    // Sanity — timeline is present after insert.
    {
      const row0 = sb._tables.overlay_user_design_elements.rows.find(
        (r) => r.id === el.id,
      );
      expect(
        (
          row0?.animation as {
            entry?: { advancedTimeline?: unknown[] };
          }
        ).entry?.advancedTimeline,
      ).toBeDefined();
    }
    await updateElement(
      sb as unknown as Parameters<typeof updateElement>[0],
      el.id,
      { animation: {} },
    );
    const row = sb._tables.overlay_user_design_elements.rows.find(
      (r) => r.id === el.id,
    );
    expect(row?.animation).toEqual({});
  });

  it("addElement rejects advancedTimeline alongside a non-noop preset (mutual exclusivity)", async () => {
    await expect(
      addElement(sb as unknown as Parameters<typeof addElement>[0], "scene-1", {
        ...VALID_TEXT_INPUT,
        animation: {
          entry: {
            type: "slide-left",
            durationMs: 600,
            delayMs: 0,
            easing: "ease-out",
            advancedTimeline: [
              {
                property: "opacity",
                keyframes: [
                  { id: "k1", timeMs: 0, value: 0, easingOut: null },
                  { id: "k2", timeMs: 600, value: 1, easingOut: null },
                ],
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/mutual|exclusive|both/i);
  });
});
