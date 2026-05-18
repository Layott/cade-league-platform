import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so mocks are available when vi.mock factories run.
const {
  gateMock,
  savePsdBytesMock,
  parsePsdAndStoreSpritesMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  gateMock: vi.fn(),
  savePsdBytesMock: vi.fn(),
  parsePsdAndStoreSpritesMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("../../assets-actions-gate", () => ({ gate: gateMock }));
vi.mock("@/server/overlays/builder/photopea-bridge", () => ({
  savePsdBytes: (...args: unknown[]) => savePsdBytesMock(...args),
}));
vi.mock("@/server/overlays/builder/psd-parser", () => ({
  parsePsdAndStoreSprites: parsePsdAndStoreSpritesMock,
}));

// Default sb stub used in tests that don't override it. Each describe
// block can swap in a more specific mock if it needs the inner
// `sb.from(...)` / `sb.storage.from(...)` chains.
function defaultSb(): unknown {
  return {
    from: vi.fn(),
    storage: { from: vi.fn() },
  };
}

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  gateMock.mockResolvedValue({
    sb: defaultSb(),
    actor: { userId: "user-1", roles: ["admin"] },
  });
});

afterEach(() => {
  vi.resetModules();
});

describe("savePsdFromPhotopeaAction", () => {
  it("validates form input, gates perms, invokes savePsdBytes", async () => {
    savePsdBytesMock.mockResolvedValue({
      assetId: ASSET_ID,
      historyId: "h-1",
      flatPngAssetId: "flat-1",
      spriteAssetIds: [],
      newSizeBytes: 4,
    });

    const { savePsdFromPhotopeaAction } = await import("./actions");

    const form = new FormData();
    form.set("assetId", ASSET_ID);
    form.set("note", "via Photopea");
    const psdBytes = new Uint8Array([0x38, 0x42, 0x50, 0x53]);
    form.set(
      "psd",
      new File([psdBytes], "edit.psd", {
        type: "image/vnd.adobe.photoshop",
      }),
    );

    const result = await savePsdFromPhotopeaAction(form);
    expect(result.assetId).toBe(ASSET_ID);
    expect(gateMock).toHaveBeenCalledOnce();
    expect(savePsdBytesMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/builder",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/builder/[slug]/psd",
      "page",
    );
  });

  it("rejects when assetId is missing", async () => {
    const { savePsdFromPhotopeaAction } = await import("./actions");
    const form = new FormData();
    form.set(
      "psd",
      new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], "x.psd"),
    );
    await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
      /assetId/i,
    );
    expect(gateMock).not.toHaveBeenCalled();
  });

  it("rejects when PSD file is missing", async () => {
    const { savePsdFromPhotopeaAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", ASSET_ID);
    await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
      /psd file/i,
    );
    expect(gateMock).not.toHaveBeenCalled();
  });

  it("rejects when PSD file lacks 8BPS magic", async () => {
    const { savePsdFromPhotopeaAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", ASSET_ID);
    form.set(
      "psd",
      new File([new Uint8Array([0x00, 0x00, 0x00, 0x00])], "fake.psd"),
    );
    await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
      /8BPS magic/i,
    );
    expect(gateMock).not.toHaveBeenCalled();
  });

  it("propagates rate-limit short-circuit as throw", async () => {
    // Shared gate throws `Error("rate_limited")` when enforceAuthedWrite
    // returns a NextResponse (e.g. `{ status: 429 }`). Simulate by
    // having gateMock itself throw — the shared gate's logic is exercised
    // in assets-actions-gate's own unit tests.
    gateMock.mockRejectedValueOnce(new Error("rate_limited"));
    const { savePsdFromPhotopeaAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", ASSET_ID);
    form.set(
      "psd",
      new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], "x.psd"),
    );
    await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
      /rate_limited/i,
    );
    expect(savePsdBytesMock).not.toHaveBeenCalled();
  });

  it("propagates PermissionError as Forbidden", async () => {
    // The shared gate translates PermissionError into
    // `Error("Forbidden: missing overlay.design.manage")`. Mirror that
    // throw shape at the gate boundary.
    gateMock.mockRejectedValueOnce(
      new Error("Forbidden: missing overlay.design.manage"),
    );
    const { savePsdFromPhotopeaAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", ASSET_ID);
    form.set(
      "psd",
      new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], "x.psd"),
    );
    await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
      /Forbidden/i,
    );
    expect(savePsdBytesMock).not.toHaveBeenCalled();
  });
});

describe("revertToAssetSnapshotAction", () => {
  function makeSbWithSnapshot(opts: {
    histRow?: { storage_path: string } | null;
    histErr?: { message: string } | null;
    blob?: { arrayBuffer: () => Promise<ArrayBuffer> } | null;
    dlErr?: { message: string } | null;
  }) {
    return {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.histRow ?? null,
          error: opts.histErr ?? null,
        }),
      })),
      storage: {
        from: vi.fn(() => ({
          download: vi.fn().mockResolvedValue({
            data: opts.blob ?? null,
            error: opts.dlErr ?? null,
          }),
        })),
      },
    };
  }

  it("downloads snapshot, calls savePsdBytes with revert note", async () => {
    const psdBytes = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00]);
    const sb = makeSbWithSnapshot({
      histRow: { storage_path: "psd/history/abc/2026-05-18.psd" },
      blob: {
        arrayBuffer: () =>
          Promise.resolve(
            psdBytes.buffer.slice(
              psdBytes.byteOffset,
              psdBytes.byteOffset + psdBytes.byteLength,
            ) as ArrayBuffer,
          ),
      },
    });
    gateMock.mockResolvedValueOnce({
      sb,
      actor: { userId: "user-1", roles: ["admin"] },
    });
    savePsdBytesMock.mockResolvedValue({
      assetId: ASSET_ID,
      historyId: "h-2",
      flatPngAssetId: "flat-2",
      spriteAssetIds: [],
      newSizeBytes: psdBytes.byteLength,
    });

    const { revertToAssetSnapshotAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", ASSET_ID);
    form.set("snapshotId", SNAPSHOT_ID);

    const result = await revertToAssetSnapshotAction(form);
    expect(result.assetId).toBe(ASSET_ID);
    expect(savePsdBytesMock).toHaveBeenCalledOnce();
    const callArgs = savePsdBytesMock.mock.calls[0][2] as {
      input: { note: string };
    };
    expect(callArgs.input.note).toBe(`revert to snapshot ${SNAPSHOT_ID}`);
  });

  it("throws when snapshot row not found", async () => {
    const sb = makeSbWithSnapshot({ histRow: null });
    gateMock.mockResolvedValueOnce({
      sb,
      actor: { userId: "user-1", roles: ["admin"] },
    });

    const { revertToAssetSnapshotAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", ASSET_ID);
    form.set("snapshotId", SNAPSHOT_ID);

    await expect(revertToAssetSnapshotAction(form)).rejects.toThrow(
      /snapshot not found/i,
    );
    expect(savePsdBytesMock).not.toHaveBeenCalled();
  });

  it("throws when snapshot download fails", async () => {
    const sb = makeSbWithSnapshot({
      histRow: { storage_path: "psd/history/abc/2026-05-18.psd" },
      dlErr: { message: "object missing" },
    });
    gateMock.mockResolvedValueOnce({
      sb,
      actor: { userId: "user-1", roles: ["admin"] },
    });

    const { revertToAssetSnapshotAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", ASSET_ID);
    form.set("snapshotId", SNAPSHOT_ID);

    await expect(revertToAssetSnapshotAction(form)).rejects.toThrow(
      /snapshot download failed/i,
    );
    expect(savePsdBytesMock).not.toHaveBeenCalled();
  });

  it("rejects when snapshotId is missing", async () => {
    const { revertToAssetSnapshotAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", ASSET_ID);
    await expect(revertToAssetSnapshotAction(form)).rejects.toThrow(
      /snapshotId/i,
    );
    expect(gateMock).not.toHaveBeenCalled();
  });
});
