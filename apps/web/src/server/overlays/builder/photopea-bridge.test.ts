import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { savePsdBytes } from "./photopea-bridge";

/**
 * Per CLAUDE.md testing strategy — mock Supabase client; never hit DB.
 *
 * Mock shape mirrors real supabase-js: `.update(...)` returns a chainable
 * PostgrestFilterBuilder so `.eq(...)` is a real method that resolves to
 * `{data, error}` (NOT a Promise from `.update()` itself). Each test can
 * override per-operation results via the `update*` opts.
 */

type SbResult<T> = { data: T | null; error: { message: string } | null };

type MockOpts = {
  assetRow?: Record<string, unknown> | null;
  historyInsertResult?: SbResult<{ id: string }>;
  /** Result returned by `.update({size_bytes, updated_at}).eq("id", assetId)` (step 5). */
  updateSizeResult?: SbResult<null>;
  /** Result returned by `.update({deleted_at}).eq("psd_parent_asset_id", assetId)` (step 6). */
  softDeleteSpritesResult?: SbResult<null>;
  /** Result returned by `.update({flat_png_asset_id}).eq("id", assetId)` (step 8). */
  relinkFlatResult?: SbResult<null>;
  /** Result returned by `storage.move(livePath, historyPath)` (step 2). */
  moveForwardResult?: { data: unknown; error: { message: string } | null };
  /** Result returned by `storage.upload(...)` (step 4). */
  uploadResult?: { data: unknown; error: { message: string } | null };
};

function makeMockSupabase(opts: MockOpts = {}) {
  const fromCalls: string[] = [];

  // Storage mock. `move` is stateful: forward call returns whatever was
  // pre-seeded via `moveForwardResult`; subsequent (rollback) calls fall
  // through to the default success result.
  const moveMock = vi.fn(async () => ({ data: null, error: null }));
  if (opts.moveForwardResult !== undefined) {
    moveMock.mockResolvedValueOnce(opts.moveForwardResult);
  }
  const uploadMock = vi.fn(async () => opts.uploadResult ?? { data: { path: "ok" }, error: null });
  const removeMock = vi.fn(async () => ({ data: null, error: null }));
  const storage = {
    move: moveMock,
    upload: uploadMock,
    remove: removeMock,
  };

  // Last-eq tracker for `update().eq()` chains: the test can read which
  // column / value was passed to assert correctness.
  const updateCalls: Array<{
    patch: Record<string, unknown>;
    eqCol: string;
    eqVal: unknown;
  }> = [];

  const sb = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      if (table === "overlay_user_assets") {
        return {
          // Lookup chain (select → eq → is → maybeSingle).
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.assetRow ?? null,
            error: null,
          }),
          // Update chain. Must mirror real supabase-js shape:
          //   `.update(patch)` returns a PostgrestFilterBuilder with
          //   chainable `.eq(col, val)` that resolves to `{data, error}`.
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn((eqCol: string, eqVal: unknown) => {
              updateCalls.push({ patch, eqCol, eqVal });
              // Route to the correct mock result based on what's being patched.
              if (
                "flat_png_asset_id" in patch &&
                opts.relinkFlatResult !== undefined
              ) {
                return Promise.resolve(opts.relinkFlatResult);
              }
              if ("size_bytes" in patch) {
                return Promise.resolve(
                  opts.updateSizeResult ?? { data: null, error: null },
                );
              }
              if (
                "deleted_at" in patch &&
                eqCol === "psd_parent_asset_id"
              ) {
                return Promise.resolve(
                  opts.softDeleteSpritesResult ?? { data: null, error: null },
                );
              }
              if (
                "flat_png_asset_id" in patch ||
                ("updated_at" in patch && eqCol === "id")
              ) {
                return Promise.resolve(
                  opts.relinkFlatResult ?? { data: null, error: null },
                );
              }
              return Promise.resolve({ data: null, error: null });
            }),
          })),
        };
      }
      if (table === "overlay_user_asset_history") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(
            opts.historyInsertResult ?? {
              data: { id: "h-1" },
              error: null,
            },
          ),
          // Soft-delete chain for the history-rollback path on upload failure.
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn((eqCol: string, eqVal: unknown) => {
              updateCalls.push({ patch, eqCol, eqVal });
              return Promise.resolve({ data: null, error: null });
            }),
          })),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    }),
    storage: {
      from: vi.fn(() => storage),
    },
  } as unknown as SupabaseClient;

  return { sb, storage, fromCalls, updateCalls };
}

describe("savePsdBytes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const psdMagic = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x01]);
  const actor = {
    userId: "00000000-0000-0000-0000-000000000001",
    roles: ["admin"],
  };
  const assetId = "22222222-2222-4222-8222-222222222222";
  const assetRow = {
    id: assetId,
    asset_type: "psd",
    file_path: `psd/${assetId}.psd`,
    size_bytes: 100,
    deleted_at: null,
  };

  it("rejects when the asset row is missing", async () => {
    const { sb } = makeMockSupabase({ assetRow: null });
    const parser = vi.fn();
    await expect(
      savePsdBytes(sb, actor, {
        input: { assetId, psdBytes: psdMagic },
        parsePsd: parser,
      }),
    ).rejects.toThrow(/asset not found/i);
    expect(parser).not.toHaveBeenCalled();
  });

  it("rejects when the asset_type is not psd", async () => {
    const { sb } = makeMockSupabase({
      assetRow: { ...assetRow, asset_type: "image" },
    });
    await expect(
      savePsdBytes(sb, actor, {
        input: { assetId, psdBytes: psdMagic },
        parsePsd: vi.fn(),
      }),
    ).rejects.toThrow(/not a psd asset/i);
  });

  it("snapshots prior path, uploads new bytes, runs parser, returns result", async () => {
    const { sb, storage } = makeMockSupabase({ assetRow });

    const parser = vi.fn().mockResolvedValue({
      flatPngAssetId: "flat-1",
      spriteAssetIds: ["s-1", "s-2"],
    });

    const result = await savePsdBytes(sb, actor, {
      input: { assetId, psdBytes: psdMagic, note: "round-trip 1" },
      parsePsd: parser,
    });

    // Storage rename + upload happened.
    expect(storage.move).toHaveBeenCalledOnce();
    const [moveFrom, moveTo] = storage.move.mock.calls[0];
    expect(moveFrom).toBe(`psd/${assetId}.psd`);
    expect(moveTo).toMatch(
      new RegExp(`^psd/history/${assetId}/\\d{4}-\\d{2}-\\d{2}T.*\\.psd$`),
    );
    expect(storage.upload).toHaveBeenCalledOnce();

    // Parser invoked with the new bytes.
    expect(parser).toHaveBeenCalledOnce();
    const parserArg = parser.mock.calls[0][1];
    expect(parserArg.parentAssetId).toBe(assetId);
    expect(parserArg.psdBytes).toBe(psdMagic);

    // Result shape.
    expect(result).toEqual({
      assetId,
      historyId: "h-1",
      flatPngAssetId: "flat-1",
      spriteAssetIds: ["s-1", "s-2"],
      newSizeBytes: psdMagic.byteLength,
    });
  });

  it("propagates parser failure as a wrapped error", async () => {
    const { sb } = makeMockSupabase({ assetRow });
    const parser = vi.fn().mockRejectedValue(new Error("ag-psd OOM"));
    await expect(
      savePsdBytes(sb, actor, {
        input: { assetId, psdBytes: psdMagic },
        parsePsd: parser,
      }),
    ).rejects.toThrow(/parser failed.*ag-psd OOM/i);
  });

  it("step 8 happy path calls update({flat_png_asset_id}).eq('id', assetId)", async () => {
    const { sb, updateCalls } = makeMockSupabase({ assetRow });
    const parser = vi.fn().mockResolvedValue({
      flatPngAssetId: "flat-1",
      spriteAssetIds: ["s-1"],
    });

    await savePsdBytes(sb, actor, {
      input: { assetId, psdBytes: psdMagic },
      parsePsd: parser,
    });

    const relinkCall = updateCalls.find(
      (c) => "flat_png_asset_id" in c.patch && c.eqCol === "id",
    );
    expect(relinkCall).toBeDefined();
    expect(relinkCall?.patch.flat_png_asset_id).toBe("flat-1");
    expect(relinkCall?.eqVal).toBe(assetId);
  });

  it("step 8 relink failure surfaces as load-bearing error", async () => {
    const { sb } = makeMockSupabase({
      assetRow,
      relinkFlatResult: {
        data: null,
        error: { message: "RLS denied" },
      },
    });
    const parser = vi.fn().mockResolvedValue({
      flatPngAssetId: "flat-1",
      spriteAssetIds: ["s-1"],
    });

    await expect(
      savePsdBytes(sb, actor, {
        input: { assetId, psdBytes: psdMagic },
        parsePsd: parser,
      }),
    ).rejects.toThrow(/flat_png_asset_id relink failed.*RLS denied/i);
  });

  it("steps 5 + 6 errors are best-effort (logged, not thrown)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sb } = makeMockSupabase({
      assetRow,
      updateSizeResult: { data: null, error: { message: "tx aborted" } },
      softDeleteSpritesResult: {
        data: null,
        error: { message: "perms" },
      },
    });
    const parser = vi.fn().mockResolvedValue({
      flatPngAssetId: "flat-1",
      spriteAssetIds: ["s-1"],
    });

    // Function must STILL succeed — steps 5+6 are best-effort.
    const result = await savePsdBytes(sb, actor, {
      input: { assetId, psdBytes: psdMagic },
      parsePsd: parser,
    });
    expect(result.flatPngAssetId).toBe("flat-1");

    // Both errors logged via console.warn.
    expect(warn).toHaveBeenCalledTimes(2);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => /size_bytes update failed.*tx aborted/i.test(m))).toBe(
      true,
    );
    expect(messages.some((m) => /sprite soft-delete failed.*perms/i.test(m))).toBe(
      true,
    );
    warn.mockRestore();
  });

  it("history insert failure rolls back the storage move", async () => {
    const { sb, storage } = makeMockSupabase({
      assetRow,
      historyInsertResult: {
        data: null,
        error: { message: "block_mutation" },
      },
    });
    const parser = vi.fn();

    await expect(
      savePsdBytes(sb, actor, {
        input: { assetId, psdBytes: psdMagic },
        parsePsd: parser,
      }),
    ).rejects.toThrow(/block_mutation|history insert failed/i);

    // Move called TWICE: forward (live -> history), then reverse rollback.
    expect(storage.move).toHaveBeenCalledTimes(2);
    const [firstFrom, firstTo] = storage.move.mock.calls[0];
    const [secondFrom, secondTo] = storage.move.mock.calls[1];
    expect(firstFrom).toBe(`psd/${assetId}.psd`);
    expect(firstTo).toMatch(
      new RegExp(`^psd/history/${assetId}/.*\\.psd$`),
    );
    // Reverse — historyPath back to livePath.
    expect(secondFrom).toBe(firstTo);
    expect(secondTo).toBe(`psd/${assetId}.psd`);

    // Parser must NOT have been invoked — we bailed before step 7.
    expect(parser).not.toHaveBeenCalled();
  });

  it("upload failure rolls back move + soft-deletes orphaned history row", async () => {
    const { sb, storage, updateCalls } = makeMockSupabase({
      assetRow,
      uploadResult: {
        data: null,
        error: { message: "storage 500" },
      },
    });
    const parser = vi.fn();

    await expect(
      savePsdBytes(sb, actor, {
        input: { assetId, psdBytes: psdMagic },
        parsePsd: parser,
      }),
    ).rejects.toThrow(/upload failed.*storage 500|storage 500/i);

    // Move called TWICE: forward, then rollback after upload failed.
    expect(storage.move).toHaveBeenCalledTimes(2);
    const [, firstTo] = storage.move.mock.calls[0];
    const [secondFrom, secondTo] = storage.move.mock.calls[1];
    expect(secondFrom).toBe(firstTo);
    expect(secondTo).toBe(`psd/${assetId}.psd`);

    // History row soft-deleted.
    const historyRollback = updateCalls.find(
      (c) => "deleted_at" in c.patch && c.eqCol === "id" && c.eqVal === "h-1",
    );
    expect(historyRollback).toBeDefined();

    // Parser never invoked.
    expect(parser).not.toHaveBeenCalled();
  });
});
