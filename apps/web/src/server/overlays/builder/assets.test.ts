import { describe, expect, it, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  uploadPsd,
  listPsdAssets,
  listPsdLayers,
  getAsset,
  softDeleteAsset,
} from "./assets";

const TINY_PSD = path.join(__dirname, "__fixtures__", "tiny.psd");

type Row = Record<string, unknown>;

function makeMockSupabase() {
  const tables: Record<string, Row[]> = { overlay_user_assets: [] };
  const storage: Record<string, Buffer> = {};
  const sb: {
    from: (table: string) => unknown;
    storage: { from: (bucket: string) => unknown };
    __tables: typeof tables;
    __storage: typeof storage;
  } = {
    from(table: string) {
      return {
        insert(rows: Row | Row[]) {
          const arr = Array.isArray(rows) ? rows : [rows];
          const inserted = arr.map((r) => ({
            id: r.id ?? `id-${tables[table].length + 1}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
            ...r,
          }));
          tables[table].push(...inserted);
          return {
            select: () => ({
              maybeSingle: async () => ({ data: inserted[0], error: null }),
            }),
          };
        },
        select(_cols: string) {
          let filterFn: (r: Row) => boolean = () => true;
          // eslint-disable-next-line prefer-const -- proxy must be let so chain methods can reference it via closure before proxy is assigned
          let proxy: typeof chain;
          const chain = {
            eq(col: string, val: unknown) {
              const prev = filterFn;
              filterFn = (r) => prev(r) && r[col] === val;
              return proxy;
            },
            is(col: string, val: unknown) {
              const prev = filterFn;
              filterFn = (r) => prev(r) && r[col] === val;
              return proxy;
            },
            order(_col: string, _opts: unknown) {
              return proxy;
            },
            maybeSingle: async () => {
              const hit = (tables[table] ?? []).filter(filterFn)[0] ?? null;
              return { data: hit, error: null };
            },
            then: undefined as never,
          };
          // Make `await proxy` return the filtered rows via the then-trap
          proxy = new Proxy(chain, {
            get(target, prop) {
              if (prop === "then") {
                return (resolve: (v: { data: Row[]; error: null }) => void) =>
                  resolve({ data: (tables[table] ?? []).filter(filterFn), error: null });
              }
              return (target as Record<string | symbol, unknown>)[prop as string];
            },
          });
          return proxy;
        },
        update(patch: Row) {
          let filterFn: (r: Row) => boolean = () => true;
          const chain = {
            eq(col: string, val: unknown) {
              const prev = filterFn;
              filterFn = (r) => prev(r) && r[col] === val;
              return chain;
            },
            catch: (fn: (e: unknown) => void) => {
              void fn;
              return Promise.resolve({ data: null, error: null });
            },
            then: (resolve: (v: { data: null; error: null }) => void) => {
              for (const r of tables[table] ?? []) {
                if (filterFn(r)) Object.assign(r, patch);
              }
              return resolve({ data: null, error: null });
            },
          };
          return chain;
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          upload: async (key: string, body: Buffer) => {
            storage[`${bucket}/${key}`] = body;
            return { data: { path: key }, error: null };
          },
          remove: async (keys: string[]) => {
            for (const k of keys) delete storage[`${bucket}/${k}`];
            return { data: null, error: null };
          },
        };
      },
    },
    __tables: tables,
    __storage: storage,
  };
  return sb;
}

describe("uploadPsd", () => {
  let sb: ReturnType<typeof makeMockSupabase>;
  beforeEach(() => {
    sb = makeMockSupabase();
  });

  it("writes a parent PSD asset + flat PNG asset + N layer sprites", async () => {
    const bytes = await readFile(TINY_PSD);
    const result = await uploadPsd(sb as never, {
      bytes,
      filename: "tiny.psd",
      ownerUserId: "u-1",
    });
    expect(result.parentAssetId).toBeTruthy();
    expect(result.flatAssetId).toBeTruthy();
    expect(result.layerAssetIds.length).toBeGreaterThanOrEqual(2);
    expect(result.canvasWidth).toBeGreaterThan(0);
    expect(result.canvasHeight).toBeGreaterThan(0);

    const rows = sb.__tables.overlay_user_assets;
    expect(rows.length).toBe(2 + result.layerAssetIds.length);
    const parent = rows.find((r) => r.id === result.parentAssetId);
    expect(parent).toMatchObject({
      asset_type: "psd",
      mime_type: "image/vnd.adobe.photoshop",
      flat_png_asset_id: result.flatAssetId,
    });
    const flat = rows.find((r) => r.id === result.flatAssetId);
    expect(flat).toMatchObject({
      asset_type: "image",
      psd_parent_asset_id: result.parentAssetId,
    });
    for (const layerId of result.layerAssetIds) {
      const sprite = rows.find((r) => r.id === layerId);
      expect(sprite).toMatchObject({
        asset_type: "image",
        psd_parent_asset_id: result.parentAssetId,
      });
      expect(sprite!.psd_layer_index).toBeTypeOf("number");
    }
  });

  it("writes every byte payload into storage under psd/<uuid> keys", async () => {
    const bytes = await readFile(TINY_PSD);
    const result = await uploadPsd(sb as never, {
      bytes,
      filename: "tiny.psd",
      ownerUserId: "u-1",
    });
    const psdKeys = Object.keys(sb.__storage).filter((k) =>
      k.startsWith("overlay-user-assets/psd/"),
    );
    expect(psdKeys.length).toBe(2 + result.layerAssetIds.length);
    expect(psdKeys.some((k) => k.endsWith(".psd"))).toBe(true);
    expect(psdKeys.some((k) => k.endsWith("-flat.png"))).toBe(true);
    expect(psdKeys.filter((k) => /-layer-\d+\.png$/.test(k)).length).toBe(
      result.layerAssetIds.length,
    );
  });

  it("rejects bytes > MAX_PSD_BYTES", async () => {
    const huge = Buffer.alloc(101 * 1024 * 1024, 0);
    await expect(
      uploadPsd(sb as never, {
        bytes: huge,
        filename: "huge.psd",
        ownerUserId: "u-1",
      }),
    ).rejects.toThrow(/exceeds 100/i);
  });

  it("rejects non-PSD MIME / extension", async () => {
    await expect(
      uploadPsd(sb as never, {
        bytes: Buffer.from("not a psd"),
        filename: "bad.png",
        ownerUserId: "u-1",
      }),
    ).rejects.toThrow(/extension/i);
  });

  it("wraps parsePsd failures into PsdUploadError without writing partial rows", async () => {
    const garbage = Buffer.alloc(64);
    garbage.write("8BPS", 0, "ascii");
    garbage.writeUInt16BE(1, 4);
    await expect(
      uploadPsd(sb as never, {
        bytes: garbage,
        filename: "broken.psd",
        ownerUserId: "u-1",
      }),
    ).rejects.toMatchObject({ name: "PsdUploadError" });
    expect(sb.__tables.overlay_user_assets.length).toBe(0);
  });
});

describe("listPsdAssets", () => {
  it("returns rows with layerCount aggregated from sprites", async () => {
    const sb = makeMockSupabase();
    const bytes = await readFile(TINY_PSD);
    await uploadPsd(sb as never, { bytes, filename: "tiny.psd", ownerUserId: "u-1" });
    const list = await listPsdAssets(sb as never);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({
      originalFilename: "tiny.psd",
      layerCount: expect.any(Number),
    });
    expect(list[0].layerCount).toBeGreaterThanOrEqual(2);
  });

  it("excludes soft-deleted rows", async () => {
    const sb = makeMockSupabase();
    const bytes = await readFile(TINY_PSD);
    const r = await uploadPsd(sb as never, {
      bytes,
      filename: "tiny.psd",
      ownerUserId: "u-1",
    });
    await softDeleteAsset(sb as never, r.parentAssetId);
    const list = await listPsdAssets(sb as never);
    expect(list).toHaveLength(0);
  });
});

describe("listPsdLayers", () => {
  it("returns every layer sprite for a parent PSD ordered by psd_layer_index", async () => {
    const sb = makeMockSupabase();
    const bytes = await readFile(TINY_PSD);
    const r = await uploadPsd(sb as never, {
      bytes,
      filename: "tiny.psd",
      ownerUserId: "u-1",
    });
    const layers = await listPsdLayers(sb as never, r.parentAssetId);
    expect(layers.length).toBe(r.layerAssetIds.length);
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i].psdLayerIndex).toBeGreaterThanOrEqual(layers[i - 1].psdLayerIndex);
    }
  });
});

describe("getAsset / softDeleteAsset", () => {
  it("getAsset returns null for unknown id", async () => {
    const sb = makeMockSupabase();
    const a = await getAsset(sb as never, "nope");
    expect(a).toBeNull();
  });

  it("softDeleteAsset cascades to flat PNG + every sprite under the parent", async () => {
    const sb = makeMockSupabase();
    const bytes = await readFile(TINY_PSD);
    const r = await uploadPsd(sb as never, {
      bytes,
      filename: "tiny.psd",
      ownerUserId: "u-1",
    });
    await softDeleteAsset(sb as never, r.parentAssetId);
    const rows = sb.__tables.overlay_user_assets;
    expect(rows.every((row) => row.deleted_at !== null)).toBe(true);
  });
});
