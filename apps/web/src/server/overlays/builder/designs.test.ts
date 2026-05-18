import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDesign,
  getDesign,
  listDesigns,
  publishDesign,
  softDeleteDesign,
  unpublishDesign,
  updateDesignMeta,
} from "./designs";

type FakeRow = Record<string, unknown>;
type FakeTable = {
  rows: FakeRow[];
  insertedRows: FakeRow[];
  updates: Array<{ patch: FakeRow; match: FakeRow }>;
};

function makeFakeSb() {
  const tables: Record<string, FakeTable> = {
    overlay_user_designs: { rows: [], insertedRows: [], updates: [] },
    overlay_user_design_scenes: { rows: [], insertedRows: [], updates: [] },
    overlay_user_design_elements: { rows: [], insertedRows: [], updates: [] },
    overlay_template_variants: { rows: [], insertedRows: [], updates: [] },
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
                tbl.updates.push({ patch, match: match ?? {} });
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
    api.then = undefined;
    api.order = vi.fn(() => api);
    api.limit = vi.fn(() => api);
    api.range = vi.fn(() => api);
    // Default `then`-able for SELECT without single/maybeSingle.
    const selectThen = async () => {
      const matched = tbl.rows.filter((r) =>
        filters.every((f) => r[f.col] === f.val),
      );
      return { data: matched, error: null };
    };
    (api as Record<string, unknown>).then = (resolve: unknown) => {
      return selectThen().then(resolve as (v: unknown) => unknown);
    };
    return api;
  };
  return {
    from: vi.fn((tableName: string) => builder(tableName)),
    _tables: tables,
  };
}

describe("designs.ts — CRUD", () => {
  let sb: ReturnType<typeof makeFakeSb>;
  beforeEach(() => {
    sb = makeFakeSb();
  });

  it("createDesign inserts a row + auto-generates kebab slug from title", async () => {
    const d = await createDesign(sb as unknown as Parameters<typeof createDesign>[0], {
      title: "My Cool Overlay",
      mode: "single",
      createdBy: "user-abc",
    });
    expect(d.title).toBe("My Cool Overlay");
    expect(d.slug).toMatch(/^my-cool-overlay/);
    expect(d.mode).toBe("single");
    expect(d.status).toBe("draft");
  });

  it("createDesign single-mode creates exactly one scene", async () => {
    await createDesign(sb as unknown as Parameters<typeof createDesign>[0], {
      title: "Test",
      mode: "single",
      createdBy: "user-abc",
    });
    expect(sb._tables.overlay_user_design_scenes.insertedRows.length).toBe(1);
  });

  it("createDesign sequence-mode creates NO scenes by default", async () => {
    await createDesign(sb as unknown as Parameters<typeof createDesign>[0], {
      title: "Sequence",
      mode: "sequence",
      createdBy: "user-abc",
    });
    expect(sb._tables.overlay_user_design_scenes.insertedRows.length).toBe(0);
  });

  it("getDesign returns null when slug missing", async () => {
    const d = await getDesign(sb as unknown as Parameters<typeof getDesign>[0], "no-such-slug");
    expect(d).toBeNull();
  });

  it("listDesigns filters by status when provided", async () => {
    sb._tables.overlay_user_designs.rows.push({
      id: "d1",
      slug: "a",
      title: "A",
      status: "draft",
      mode: "single",
      created_by: "u1",
      canvas_width: 1920,
      canvas_height: 1080,
      description: null,
      updated_at: "2026-05-17T00:00:00Z",
      thumbnail_path: null,
      deleted_at: null,
    });
    sb._tables.overlay_user_designs.rows.push({
      id: "d2",
      slug: "b",
      title: "B",
      status: "published",
      mode: "single",
      created_by: "u1",
      canvas_width: 1920,
      canvas_height: 1080,
      description: null,
      updated_at: "2026-05-17T00:00:00Z",
      thumbnail_path: null,
      deleted_at: null,
    });
    const rows = await listDesigns(
      sb as unknown as Parameters<typeof listDesigns>[0],
      { status: "published" },
    );
    expect(rows.length).toBe(1);
    expect(rows[0].slug).toBe("b");
  });

  it("updateDesignMeta updates only provided keys", async () => {
    sb._tables.overlay_user_designs.rows.push({
      id: "d1",
      slug: "x",
      title: "Old",
      status: "draft",
      mode: "single",
      description: null,
    });
    await updateDesignMeta(
      sb as unknown as Parameters<typeof updateDesignMeta>[0],
      "d1",
      { title: "New" },
    );
    const row = sb._tables.overlay_user_designs.rows.find((r) => r.id === "d1");
    expect(row?.title).toBe("New");
  });

  it("publishDesign sets status='published' + inserts template_variant row", async () => {
    sb._tables.overlay_user_designs.rows.push({
      id: "d1",
      slug: "my-design",
      title: "My Design",
      status: "draft",
      mode: "single",
      description: null,
    });
    await publishDesign(
      sb as unknown as Parameters<typeof publishDesign>[0],
      "d1",
    );
    const row = sb._tables.overlay_user_designs.rows.find((r) => r.id === "d1");
    expect(row?.status).toBe("published");
    const variant = sb._tables.overlay_template_variants.insertedRows[0];
    expect(variant?.overlay_key).toBe("user-my-design");
    expect(variant?.kind).toBe("dynamic");
    expect(variant?.html_path).toBe("/overlay/v2/user/my-design");
  });

  it("publishDesign restores a soft-deleted template_variant row instead of duplicating", async () => {
    // Regression for QA 2026-05-18: publishing a design whose previous
    // template_variants row was soft-deleted (via unpublishDesign) must
    // restore the existing row, not INSERT a duplicate that violates the
    // (overlay_key, variant_id) UNIQUE constraint.
    sb._tables.overlay_user_designs.rows.push({
      id: "d-rep",
      slug: "republish-me",
      title: "Republish Me",
      status: "draft",
      mode: "single",
      description: null,
    });
    sb._tables.overlay_template_variants.rows.push({
      id: "tv-old",
      overlay_key: "user-republish-me",
      variant_id: "default",
      label: "Republish Me (stale)",
      html_path: "/overlay/v2/user/republish-me",
      active: false,
      kind: "dynamic",
      deleted_at: "2026-05-17T00:00:00Z",
    });

    await publishDesign(
      sb as unknown as Parameters<typeof publishDesign>[0],
      "d-rep",
    );

    expect(sb._tables.overlay_template_variants.insertedRows.length).toBe(0);
    const restored = sb._tables.overlay_template_variants.rows.find(
      (r) => r.id === "tv-old",
    );
    expect(restored?.deleted_at).toBeNull();
    expect(restored?.active).toBe(true);
    expect(restored?.label).toBe("Republish Me");
    expect(restored?.html_path).toBe("/overlay/v2/user/republish-me");
  });

  it("unpublishDesign soft-deletes the template_variant row", async () => {
    sb._tables.overlay_user_designs.rows.push({
      id: "d1",
      slug: "my-design",
      title: "My Design",
      status: "published",
      mode: "single",
      description: null,
    });
    sb._tables.overlay_template_variants.rows.push({
      id: "tv1",
      overlay_key: "user-my-design",
      variant_id: "default",
      label: "user-my-design",
      html_path: "/overlay/v2/user/my-design",
      active: true,
      kind: "dynamic",
      deleted_at: null,
    });
    await unpublishDesign(
      sb as unknown as Parameters<typeof unpublishDesign>[0],
      "d1",
    );
    const row = sb._tables.overlay_user_designs.rows.find((r) => r.id === "d1");
    expect(row?.status).toBe("draft");
    const variant = sb._tables.overlay_template_variants.rows.find(
      (r) => r.id === "tv1",
    );
    expect(variant?.deleted_at).not.toBeNull();
  });

  it("softDeleteDesign sets deleted_at on the design row", async () => {
    sb._tables.overlay_user_designs.rows.push({
      id: "d1",
      slug: "my-design",
      title: "My Design",
      status: "draft",
      mode: "single",
      description: null,
      deleted_at: null,
    });
    await softDeleteDesign(
      sb as unknown as Parameters<typeof softDeleteDesign>[0],
      "d1",
    );
    const row = sb._tables.overlay_user_designs.rows.find((r) => r.id === "d1");
    expect(row?.deleted_at).not.toBeNull();
  });
});
