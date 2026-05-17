import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPublishedUserDesigns } from "./registry";

type FakeRow = Record<string, unknown>;
type FakeTable = { rows: FakeRow[] };

function makeFakeSb() {
  const tables: Record<string, FakeTable> = {
    overlay_user_designs: { rows: [] },
    overlay_template_variants: { rows: [] },
  };
  const builder = (tableName: string) => {
    const tbl = tables[tableName];
    const filters: Array<{ col: string; val: unknown }> = [];
    const api: Record<string, unknown> = {};
    api.select = vi.fn(() => api);
    api.eq = vi.fn((col: string, val: unknown) => {
      filters.push({ col, val });
      return api;
    });
    api.is = vi.fn(() => api);
    api.order = vi.fn(() => api);
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

describe("listPublishedUserDesigns", () => {
  let sb: ReturnType<typeof makeFakeSb>;
  beforeEach(() => {
    sb = makeFakeSb();
  });

  it("returns empty when nothing is published", async () => {
    const r = await listPublishedUserDesigns(
      sb as unknown as Parameters<typeof listPublishedUserDesigns>[0],
    );
    expect(r).toEqual([]);
  });

  it("returns joined rows for published + dynamic variants", async () => {
    sb._tables.overlay_user_designs.rows.push({
      id: "d1",
      slug: "my-design",
      title: "My Design",
      status: "published",
      updated_at: "2026-05-17T10:00:00Z",
      thumbnail_path: "thumb-d1.png",
      deleted_at: null,
    });
    sb._tables.overlay_template_variants.rows.push({
      id: "tv1",
      overlay_key: "user-my-design",
      variant_id: "default",
      label: "user-my-design",
      html_path: "/overlay/v2/user/my-design",
      thumbnail_path: "thumb-tv1.png",
      active: true,
      kind: "dynamic",
      deleted_at: null,
    });
    const r = await listPublishedUserDesigns(
      sb as unknown as Parameters<typeof listPublishedUserDesigns>[0],
    );
    expect(r.length).toBe(1);
    expect(r[0].slug).toBe("my-design");
    expect(r[0].overlayKey).toBe("user-my-design");
    expect(r[0].title).toBe("My Design");
  });

  it("filters out unpublished designs", async () => {
    sb._tables.overlay_user_designs.rows.push({
      id: "d1",
      slug: "draft-design",
      title: "Draft",
      status: "draft",
      updated_at: "2026-05-17T10:00:00Z",
      thumbnail_path: null,
      deleted_at: null,
    });
    sb._tables.overlay_template_variants.rows.push({
      id: "tv1",
      overlay_key: "user-draft-design",
      variant_id: "default",
      label: "user-draft-design",
      html_path: "/overlay/v2/user/draft-design",
      active: false,
      kind: "dynamic",
      deleted_at: null,
    });
    const r = await listPublishedUserDesigns(
      sb as unknown as Parameters<typeof listPublishedUserDesigns>[0],
    );
    expect(r).toEqual([]);
  });

  it("filters out soft-deleted designs", async () => {
    sb._tables.overlay_user_designs.rows.push({
      id: "d1",
      slug: "deleted-design",
      title: "Deleted",
      status: "published",
      updated_at: "2026-05-17T10:00:00Z",
      thumbnail_path: null,
      deleted_at: "2026-05-17T11:00:00Z",
    });
    sb._tables.overlay_template_variants.rows.push({
      id: "tv1",
      overlay_key: "user-deleted-design",
      variant_id: "default",
      label: "user-deleted-design",
      html_path: "/overlay/v2/user/deleted-design",
      active: true,
      kind: "dynamic",
      deleted_at: null,
    });
    const r = await listPublishedUserDesigns(
      sb as unknown as Parameters<typeof listPublishedUserDesigns>[0],
    );
    expect(r).toEqual([]);
  });
});
