import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parsePsd,
  parsePsdAndStoreSprites,
  MAX_PSD_BYTES,
  SOFT_WARN_PSD_BYTES,
} from "./psd-parser";
import * as agPsd from "ag-psd";

const FIXTURE = path.join(__dirname, "__fixtures__", "tiny.psd");

describe("parsePsd", () => {
  it("constants are 100 MB / 50 MB", () => {
    expect(MAX_PSD_BYTES).toBe(100 * 1024 * 1024);
    expect(SOFT_WARN_PSD_BYTES).toBe(50 * 1024 * 1024);
  });

  it("extracts every layer from a 2-layer fixture PSD", async () => {
    const buffer = await readFile(FIXTURE);
    const result = await parsePsd(buffer);
    expect(result.flatPng).toBeInstanceOf(Buffer);
    expect(result.flatPng.byteLength).toBeGreaterThan(0);
    expect(result.flatPng.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(result.layers.length).toBeGreaterThanOrEqual(2);
    for (const layer of result.layers) {
      expect(typeof layer.name).toBe("string");
      expect(layer.bounds).toEqual(
        expect.objectContaining({
          left: expect.any(Number),
          top: expect.any(Number),
          right: expect.any(Number),
          bottom: expect.any(Number),
        }),
      );
      expect(layer.png).toBeInstanceOf(Buffer);
      expect(layer.png.byteLength).toBeGreaterThan(0);
      expect(layer.png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it("returns canvas dimensions", async () => {
    const buffer = await readFile(FIXTURE);
    const result = await parsePsd(buffer);
    expect(result.canvasWidth).toBeGreaterThan(0);
    expect(result.canvasHeight).toBeGreaterThan(0);
  });

  it("rejects buffers above MAX_PSD_BYTES", async () => {
    const huge = Buffer.alloc(MAX_PSD_BYTES + 1, 0);
    await expect(parsePsd(huge)).rejects.toThrow(/exceeds 100/i);
  });

  it("rejects empty / non-PSD buffers gracefully", async () => {
    await expect(parsePsd(Buffer.alloc(0))).rejects.toThrow();
    await expect(parsePsd(Buffer.from("not a psd"))).rejects.toThrow();
  });

  it("OOM / unexpected parser exceptions wrap into PsdParseError with friendly message", async () => {
    // Buffer must be >=26 bytes and start with '8BPS' magic to pass pre-checks,
    // but contain garbage content so ag-psd raises during parsing.
    const garbage = Buffer.alloc(64);
    garbage.write("8BPS", 0, "ascii");    // magic
    garbage.writeUInt16BE(1, 4);          // version = 1 (PSD)
    // rest is zeroes — ag-psd will fail on malformed section lengths
    await expect(parsePsd(garbage)).rejects.toMatchObject({
      name: "PsdParseError",
      message: expect.stringMatching(/could not parse/i),
    });
  });
});

describe("parsePsd — OOM safety net", () => {
  it("wraps V8 RangeError (out-of-memory) into PsdParseError", async () => {
    const spy = vi.spyOn(agPsd, "readPsd").mockImplementationOnce(() => {
      throw new RangeError("Invalid string length");
    });
    const validHeader = Buffer.concat([
      Buffer.from([0x38, 0x42, 0x50, 0x53]), // 8BPS
      Buffer.alloc(30, 0),
    ]);
    try {
      await expect(parsePsd(validHeader)).rejects.toMatchObject({
        name: "PsdParseError",
        message: expect.stringMatching(/parser raised/i),
      });
    } finally {
      spy.mockRestore();
    }
  });
});

// ─────────────────── parsePsdAndStoreSprites ───────────────────
//
// In-memory Supabase double mirroring the `makeMockSupabase` pattern in
// `assets.test.ts`. The real `parsePsd` runs against the tiny fixture
// (no ag-psd mock needed) so we exercise the full storage + DB write
// path. Per-test overrides on `sb.__failOn` simulate storage / DB
// failures at specific points.

type Row = Record<string, unknown>;

type FailOn = Partial<{
  flatUpload: { message: string };
  layerUpload: { layerIndex: number; message: string };
  flatInsert: { message: string };
  layerInsert: { layerIndex: number; message: string };
}>;

function makeMockSupabaseForSprites(failOn: FailOn = {}) {
  const tables: Record<string, Row[]> = { overlay_user_assets: [] };
  const storage: Record<string, Buffer> = {};
  let insertCounter = -1; // -1 = next insert is flat; >=0 = layer index
  let layerUploadCounter = -1; // -1 = next upload is flat; >=0 = layer index
  const sb = {
    from(table: string) {
      return {
        insert(row: Row) {
          insertCounter += 1;
          const isFlat = insertCounter === 0;
          if (isFlat && failOn.flatInsert) {
            return { error: failOn.flatInsert };
          }
          if (!isFlat && failOn.layerInsert) {
            // insertCounter == 1 means first layer (layerIndex 0)
            if (insertCounter - 1 === failOn.layerInsert.layerIndex) {
              return { error: { message: failOn.layerInsert.message } };
            }
          }
          tables[table].push({ ...row });
          return { error: null };
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          upload: async (key: string, body: Buffer) => {
            layerUploadCounter += 1;
            const isFlat = layerUploadCounter === 0;
            if (isFlat && failOn.flatUpload) {
              return { error: failOn.flatUpload };
            }
            if (!isFlat && failOn.layerUpload) {
              if (layerUploadCounter - 1 === failOn.layerUpload.layerIndex) {
                return { error: { message: failOn.layerUpload.message } };
              }
            }
            storage[`${bucket}/${key}`] = body;
            return { error: null };
          },
        };
      },
    },
    __tables: tables,
    __storage: storage,
  };
  return sb;
}

describe("parsePsdAndStoreSprites", () => {
  it("inserts flat row + N sprite rows; returns valid UUIDs", async () => {
    const sb = makeMockSupabaseForSprites();
    const bytes = new Uint8Array(await readFile(FIXTURE));
    const parentAssetId = "11111111-1111-4111-8111-111111111111";

    const result = await parsePsdAndStoreSprites(sb as never, {
      parentAssetId,
      psdBytes: bytes,
    });

    expect(result.flatPngAssetId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.spriteAssetIds.length).toBeGreaterThanOrEqual(2);
    for (const id of result.spriteAssetIds) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
    // 1 flat + N sprite rows written.
    const rows = sb.__tables.overlay_user_assets;
    expect(rows.length).toBe(1 + result.spriteAssetIds.length);
    const flat = rows.find((r) => r.id === result.flatPngAssetId);
    expect(flat).toMatchObject({
      asset_type: "image",
      psd_parent_asset_id: parentAssetId,
      psd_layer_index: null,
    });
    for (let i = 0; i < result.spriteAssetIds.length; i++) {
      const sprite = rows.find((r) => r.id === result.spriteAssetIds[i]);
      expect(sprite).toMatchObject({
        asset_type: "image",
        psd_parent_asset_id: parentAssetId,
      });
      expect(typeof sprite!.psd_layer_index).toBe("number");
    }
    // Flat PNG + per-layer PNGs written to storage under the right keys.
    expect(
      sb.__storage[`overlay-user-assets/psd/${parentAssetId}-flat.png`],
    ).toBeInstanceOf(Buffer);
    expect(
      Object.keys(sb.__storage).filter((k) =>
        k.startsWith(`overlay-user-assets/psd/${parentAssetId}-layer-`),
      ).length,
    ).toBe(result.spriteAssetIds.length);
  });

  it("throws /flat PNG upload failed/ when flat upload errors", async () => {
    const sb = makeMockSupabaseForSprites({
      flatUpload: { message: "5xx" },
    });
    const bytes = new Uint8Array(await readFile(FIXTURE));
    await expect(
      parsePsdAndStoreSprites(sb as never, {
        parentAssetId: "11111111-1111-4111-8111-111111111111",
        psdBytes: bytes,
      }),
    ).rejects.toThrow(/flat PNG upload failed/i);
    // No DB rows written if storage step 1 already failed.
    expect(sb.__tables.overlay_user_assets.length).toBe(0);
  });

  it("throws /layer 1 PNG upload failed/ when second sprite upload errors after flat OK", async () => {
    const sb = makeMockSupabaseForSprites({
      layerUpload: { layerIndex: 1, message: "5xx" },
    });
    const bytes = new Uint8Array(await readFile(FIXTURE));
    await expect(
      parsePsdAndStoreSprites(sb as never, {
        parentAssetId: "11111111-1111-4111-8111-111111111111",
        psdBytes: bytes,
      }),
    ).rejects.toThrow(/layer 1 PNG upload failed/i);
    // Flat PNG already uploaded; orphan blob acceptable per impl comment.
    expect(
      sb.__storage[
        "overlay-user-assets/psd/11111111-1111-4111-8111-111111111111-flat.png"
      ],
    ).toBeInstanceOf(Buffer);
    // No DB rows written yet — storage failure happens before DB step.
    expect(sb.__tables.overlay_user_assets.length).toBe(0);
  });

  it("throws /flat PNG row insert failed/ when flat row insert errors", async () => {
    const sb = makeMockSupabaseForSprites({
      flatInsert: { message: "uniq violation" },
    });
    const bytes = new Uint8Array(await readFile(FIXTURE));
    await expect(
      parsePsdAndStoreSprites(sb as never, {
        parentAssetId: "11111111-1111-4111-8111-111111111111",
        psdBytes: bytes,
      }),
    ).rejects.toThrow(/flat PNG row insert failed/i);
    // All PNGs were uploaded before the DB step; rows are zero.
    expect(sb.__tables.overlay_user_assets.length).toBe(0);
  });

  it("throws /sprite \\d+ row insert failed/ when first sprite row insert errors after flat row OK", async () => {
    const sb = makeMockSupabaseForSprites({
      layerInsert: { layerIndex: 0, message: "uniq violation" },
    });
    const bytes = new Uint8Array(await readFile(FIXTURE));
    await expect(
      parsePsdAndStoreSprites(sb as never, {
        parentAssetId: "11111111-1111-4111-8111-111111111111",
        psdBytes: bytes,
      }),
    ).rejects.toThrow(/sprite 0 row insert failed/i);
    // Flat row was inserted before the failing sprite row.
    expect(sb.__tables.overlay_user_assets.length).toBe(1);
    expect(sb.__tables.overlay_user_assets[0]).toMatchObject({
      psd_layer_index: null,
    });
  });
});
