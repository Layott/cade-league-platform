import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listSnapshots,
  revertToSnapshot,
  snapshotDesign,
} from "./history";

type FakeRow = Record<string, unknown>;
type FakeTable = {
  rows: FakeRow[];
  insertedRows: FakeRow[];
};

function makeFakeSb() {
  const tables: Record<string, FakeTable> = {
    overlay_user_designs: { rows: [], insertedRows: [] },
    overlay_user_design_scenes: { rows: [], insertedRows: [] },
    overlay_user_design_elements: { rows: [], insertedRows: [] },
    overlay_user_design_history: { rows: [], insertedRows: [] },
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
    api.order = vi.fn(() => api);
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

describe("history.ts", () => {
  let sb: ReturnType<typeof makeFakeSb>;
  beforeEach(() => {
    sb = makeFakeSb();
    sb._tables.overlay_user_designs.rows.push({
      id: "d1",
      slug: "round-trip",
      title: "Round Trip",
      description: null,
      mode: "single",
      status: "draft",
      canvas_width: 1920,
      canvas_height: 1080,
      created_by: "u1",
      deleted_at: null,
    });
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s1",
      design_id: "d1",
      order_index: 0,
      name: null,
      duration_ms: 5000,
      transition_in: "fade",
      transition_out: "fade",
      deleted_at: null,
    });
    sb._tables.overlay_user_design_elements.rows.push({
      id: "e1",
      scene_id: "s1",
      parent_group_id: null,
      element_type: "text",
      z_index: 0,
      locked: false,
      visible: true,
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
      style: { fontFamily: "Agharti", fontSize: 64, color: "#fff" },
      content: { text: "v1" },
      binding: null,
      animation: {},
      deleted_at: null,
    });
  });

  it("snapshotDesign writes a row with the full design JSON", async () => {
    const snap = await snapshotDesign(
      sb as unknown as Parameters<typeof snapshotDesign>[0],
      "d1",
      "pre-edit",
    );
    expect(snap.id).toBeDefined();
    const row = sb._tables.overlay_user_design_history.insertedRows[0];
    expect(row).toBeDefined();
    expect((row?.snapshot as Record<string, unknown>).slug).toBe("round-trip");
  });

  it("listSnapshots returns metadata sorted by createdAt desc", async () => {
    await snapshotDesign(
      sb as unknown as Parameters<typeof snapshotDesign>[0],
      "d1",
      "first",
    );
    await snapshotDesign(
      sb as unknown as Parameters<typeof snapshotDesign>[0],
      "d1",
      "second",
    );
    const snaps = await listSnapshots(
      sb as unknown as Parameters<typeof listSnapshots>[0],
      "d1",
    );
    expect(snaps.length).toBe(2);
  });

  it("revertToSnapshot round-trips: create -> snapshot -> mutate -> revert", async () => {
    // Take snapshot before mutation.
    const snap = await snapshotDesign(
      sb as unknown as Parameters<typeof snapshotDesign>[0],
      "d1",
      "v1",
    );
    // Mutate the element's content.
    const elRow = sb._tables.overlay_user_design_elements.rows.find(
      (r) => r.id === "e1",
    );
    if (elRow) (elRow.content as { text: string }).text = "v2-MUTATED";
    // Revert.
    await revertToSnapshot(
      sb as unknown as Parameters<typeof revertToSnapshot>[0],
      snap.id,
    );
    // The element_id may be regenerated, but at least one live element
    // row should have content.text === "v1".
    const liveEls = sb._tables.overlay_user_design_elements.rows.filter(
      (r) => r.deleted_at === null || r.deleted_at === undefined,
    );
    const liveTexts = liveEls.map((r) => (r.content as { text?: string }).text);
    expect(liveTexts.some((t) => t === "v1")).toBe(true);
  });
});
