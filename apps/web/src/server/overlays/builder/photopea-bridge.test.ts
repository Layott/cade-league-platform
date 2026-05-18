import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { savePsdBytes } from "./photopea-bridge";

/**
 * Per CLAUDE.md testing strategy — mock Supabase client; never hit DB.
 * The mock surfaces the minimal `.from(...).select/insert/update/eq/single`
 * chain the function under test consumes, plus a tiny storage mock.
 */

type MaybeSingle = ReturnType<typeof vi.fn>;

function makeMockSupabase(opts: {
  assetRow?: Record<string, unknown> | null;
  historyId?: string;
  parserResult?: {
    flatPngAssetId: string;
    spriteAssetIds: readonly string[];
  };
}) {
  const fromCalls: string[] = [];
  const storage = {
    move: vi.fn(async (_from: string, _to: string) => ({ data: null, error: null })),
    upload: vi.fn(async (_path: string, _bytes: Uint8Array) => ({
      data: { path: _path },
      error: null,
    })),
    remove: vi.fn(async (_paths: string[]) => ({ data: null, error: null })),
  };

  const sb = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      if (table === "overlay_user_assets") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.assetRow ?? null,
            error: null,
          }),
          update: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === "overlay_user_asset_history") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: opts.historyId ?? "h-1" },
            error: null,
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    }),
    storage: {
      from: vi.fn(() => storage),
    },
  } as unknown as SupabaseClient;

  return { sb, storage, fromCalls };
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
    const { sb, storage } = makeMockSupabase({
      assetRow,
      historyId: "h-42",
      parserResult: {
        flatPngAssetId: "flat-1",
        spriteAssetIds: ["s-1", "s-2"],
      },
    });

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
      historyId: "h-42",
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
});
