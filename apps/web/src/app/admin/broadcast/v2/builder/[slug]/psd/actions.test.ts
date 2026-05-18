import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the gate helper + the bridge module before importing actions.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn().mockResolvedValue(undefined),
  PermissionError: class PermissionError extends Error {},
}));
vi.mock("@/lib/api-rate-limit", () => ({
  enforceAuthedWrite: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "auth-1" } } }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { id: "user-1" }, error: null }),
    })),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: vi.fn(() => ({ __svc: true })),
}));

const savePsdBytesMock = vi.fn();
vi.mock("@/server/overlays/builder/photopea-bridge", () => ({
  savePsdBytes: (...args: unknown[]) => savePsdBytesMock(...args),
}));

// Wave 2A parser dep — bound at action wrapper level.
vi.mock("@/server/overlays/builder/psd-parser", () => ({
  parsePsdAndStoreSprites: vi.fn(),
}));

describe("savePsdFromPhotopeaAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it("validates form input, gates perms, invokes savePsdBytes", async () => {
    savePsdBytesMock.mockResolvedValue({
      assetId: "11111111-1111-4111-8111-111111111111",
      historyId: "h-1",
      flatPngAssetId: "flat-1",
      spriteAssetIds: [],
      newSizeBytes: 4,
    });

    const { savePsdFromPhotopeaAction } = await import("./actions");

    const form = new FormData();
    form.set("assetId", "11111111-1111-4111-8111-111111111111");
    form.set("note", "via Photopea");
    const psdBytes = new Uint8Array([0x38, 0x42, 0x50, 0x53]);
    form.set(
      "psd",
      new File([psdBytes], "edit.psd", {
        type: "image/vnd.adobe.photoshop",
      }),
    );

    const result = await savePsdFromPhotopeaAction(form);
    expect(result.assetId).toBe("11111111-1111-4111-8111-111111111111");
    expect(savePsdBytesMock).toHaveBeenCalledOnce();
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
  });

  it("rejects when PSD file is missing", async () => {
    const { savePsdFromPhotopeaAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", "11111111-1111-4111-8111-111111111111");
    await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
      /psd file/i,
    );
  });

  it("rejects when PSD file lacks 8BPS magic", async () => {
    const { savePsdFromPhotopeaAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", "11111111-1111-4111-8111-111111111111");
    form.set(
      "psd",
      new File([new Uint8Array([0x00, 0x00, 0x00, 0x00])], "fake.psd"),
    );
    await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
      /8BPS magic/i,
    );
  });

  it("propagates rate-limit short-circuit as throw", async () => {
    const { enforceAuthedWrite } = await import("@/lib/api-rate-limit");
    (enforceAuthedWrite as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "rate_limited_response",
    );
    const { savePsdFromPhotopeaAction } = await import("./actions");
    const form = new FormData();
    form.set("assetId", "11111111-1111-4111-8111-111111111111");
    form.set(
      "psd",
      new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], "x.psd"),
    );
    await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
      /rate_limited/i,
    );
  });
});
