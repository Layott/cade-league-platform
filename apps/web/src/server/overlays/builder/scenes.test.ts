import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addScene,
  cloneScene,
  deleteScene,
  reorderScenes,
  updateScene,
} from "./scenes";

type FakeRow = Record<string, unknown>;
type FakeTable = {
  rows: FakeRow[];
  insertedRows: FakeRow[];
  updates: Array<{ patch: FakeRow }>;
};

function makeFakeSb() {
  const tables: Record<string, FakeTable> = {
    overlay_user_design_scenes: { rows: [], insertedRows: [], updates: [] },
    overlay_user_design_elements: { rows: [], insertedRows: [], updates: [] },
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
      tbl.updates.push({ patch });
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

describe("scenes.ts", () => {
  let sb: ReturnType<typeof makeFakeSb>;
  beforeEach(() => {
    sb = makeFakeSb();
  });

  it("addScene inserts a scene at the requested order_index", async () => {
    const scene = await addScene(
      sb as unknown as Parameters<typeof addScene>[0],
      "design-1",
      { afterOrderIndex: -1 },
    );
    expect(scene.orderIndex).toBe(0);
    expect(scene.durationMs).toBe(5000);
  });

  it("addScene shifts subsequent scenes", async () => {
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
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s2",
      design_id: "d1",
      order_index: 1,
      name: null,
      duration_ms: 5000,
      transition_in: "fade",
      transition_out: "fade",
      deleted_at: null,
    });
    await addScene(sb as unknown as Parameters<typeof addScene>[0], "d1", {
      afterOrderIndex: 0,
    });
    // Either s2 got bumped to 2, or new scene took 1 and s2 bumped.
    const all = sb._tables.overlay_user_design_scenes.rows.filter(
      (r) => r.design_id === "d1",
    );
    const indices = all.map((r) => r.order_index).sort();
    expect(indices).toEqual([0, 1, 2]);
  });

  it("updateScene patches duration_ms", async () => {
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s1",
      design_id: "d1",
      order_index: 0,
      duration_ms: 5000,
      transition_in: "fade",
      transition_out: "fade",
      deleted_at: null,
    });
    await updateScene(
      sb as unknown as Parameters<typeof updateScene>[0],
      "s1",
      { durationMs: 10000 },
    );
    const row = sb._tables.overlay_user_design_scenes.rows.find(
      (r) => r.id === "s1",
    );
    expect(row?.duration_ms).toBe(10000);
  });

  it("reorderScenes bulk-reassigns order_index", async () => {
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s1",
      design_id: "d1",
      order_index: 0,
      deleted_at: null,
    });
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s2",
      design_id: "d1",
      order_index: 1,
      deleted_at: null,
    });
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s3",
      design_id: "d1",
      order_index: 2,
      deleted_at: null,
    });
    await reorderScenes(
      sb as unknown as Parameters<typeof reorderScenes>[0],
      "d1",
      ["s3", "s1", "s2"],
    );
    const findRow = (id: string) =>
      sb._tables.overlay_user_design_scenes.rows.find((r) => r.id === id);
    expect(findRow("s3")?.order_index).toBe(0);
    expect(findRow("s1")?.order_index).toBe(1);
    expect(findRow("s2")?.order_index).toBe(2);
  });

  it("deleteScene sets deleted_at + reindexes siblings", async () => {
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s1",
      design_id: "d1",
      order_index: 0,
      deleted_at: null,
    });
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s2",
      design_id: "d1",
      order_index: 1,
      deleted_at: null,
    });
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s3",
      design_id: "d1",
      order_index: 2,
      deleted_at: null,
    });
    await deleteScene(sb as unknown as Parameters<typeof deleteScene>[0], "s2");
    const findRow = (id: string) =>
      sb._tables.overlay_user_design_scenes.rows.find((r) => r.id === id);
    expect(findRow("s2")?.deleted_at).not.toBeNull();
    expect(findRow("s1")?.order_index).toBe(0);
    expect(findRow("s3")?.order_index).toBe(1);
  });

  it("cloneScene duplicates a scene and its elements with fresh ids", async () => {
    sb._tables.overlay_user_design_scenes.rows.push({
      id: "s1",
      design_id: "d1",
      order_index: 0,
      name: "intro",
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
      transform: {},
      style: {},
      content: { text: "hello" },
      binding: null,
      animation: {},
      deleted_at: null,
    });
    const clone = await cloneScene(
      sb as unknown as Parameters<typeof cloneScene>[0],
      "s1",
    );
    expect(clone.id).not.toBe("s1");
    expect(clone.designId).toBe("d1");
    // The clone's element rows were inserted into the elements table.
    expect(
      sb._tables.overlay_user_design_elements.insertedRows.length,
    ).toBeGreaterThan(0);
  });
});
