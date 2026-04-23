import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  requestOverlayUploadUrl,
  AssetUploadError,
  buildStoragePath,
  IMAGE_EXTS,
  VIDEO_EXTS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from "./asset_upload";

// Mock perms-db at the module boundary so we can flip the perm check on/off.
vi.mock("@/lib/perms-db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/perms-db")>(
    "@/lib/perms-db",
  );
  return {
    ...actual,
    requirePermAsync: vi.fn(async () => {}),
  };
});

import { requirePermAsync, PermissionError } from "@/lib/perms-db";

type MockStorage = {
  from: ReturnType<typeof vi.fn>;
  createSignedUploadUrl: ReturnType<typeof vi.fn>;
  getPublicUrl: ReturnType<typeof vi.fn>;
};

function makeSupabaseMock(
  opts: {
    signedUrlResult?: {
      data: { signedUrl: string; token: string; path: string } | null;
      error: { message: string } | null;
    };
    publicUrl?: string;
  } = {},
): {
  sb: unknown;
  storage: MockStorage;
} {
  const createSignedUploadUrl = vi.fn().mockResolvedValue(
    opts.signedUrlResult ?? {
      data: {
        signedUrl:
          "https://example.supabase.co/storage/v1/object/upload/sign/overlay-assets/xxx?token=tok",
        token: "tok",
        path: "images/2026/01/1700000000000-abc123-test.png",
      },
      error: null,
    },
  );
  const getPublicUrl = vi.fn().mockReturnValue({
    data: {
      publicUrl:
        opts.publicUrl ??
        "https://example.supabase.co/storage/v1/object/public/overlay-assets/images/2026/01/1700000000000-abc123-test.png",
    },
  });
  const from = vi
    .fn()
    .mockReturnValue({ createSignedUploadUrl, getPublicUrl });
  const storage: MockStorage = {
    from,
    createSignedUploadUrl,
    getPublicUrl,
  };
  const sb = { storage: { from } };
  return { sb, storage };
}

describe("buildStoragePath", () => {
  it("prefixes images/<year>/<month>", () => {
    const p = buildStoragePath("image", "logo.png", new Date("2026-02-15T00:00:00Z"));
    expect(p).toMatch(/^images\/2026\/02\/\d+-[a-z0-9]{6}-logo\.png$/);
  });

  it("prefixes videos/<year>/<month>", () => {
    const p = buildStoragePath("video", "ad.mp4", new Date("2026-11-01T00:00:00Z"));
    expect(p).toMatch(/^videos\/2026\/11\/\d+-[a-z0-9]{6}-ad\.mp4$/);
  });

  it("sanitizes weird filenames", () => {
    const p = buildStoragePath("image", "My Player Shot!! (final).JPG", new Date());
    // Spaces, punctuation → hyphens; lowercased; ext preserved lowercase.
    expect(p).toMatch(/my-player-shot-final\.jpg$/);
  });
});

describe("requestOverlayUploadUrl", () => {
  const actor = { userId: "user-1", roles: ["production"] as readonly string[] };

  beforeEach(() => {
    vi.mocked(requirePermAsync).mockReset();
    vi.mocked(requirePermAsync).mockResolvedValue(undefined);
  });

  it("happy path — image", async () => {
    const { sb, storage } = makeSupabaseMock();
    const result = await requestOverlayUploadUrl({
      sb: sb as never,
      actor,
      kind: "image",
      filename: "player.png",
      bytes: 500_000,
    });
    expect(result.uploadUrl).toContain("overlay-assets");
    expect(result.publicUrl).toContain("overlay-assets");
    expect(result.storagePath).toMatch(/^images\/.*\.png$/);
    expect(storage.from).toHaveBeenCalledWith("overlay-assets");
  });

  it("happy path — video", async () => {
    const { sb } = makeSupabaseMock();
    const result = await requestOverlayUploadUrl({
      sb: sb as never,
      actor,
      kind: "video",
      filename: "ad.mp4",
      bytes: 5_000_000,
    });
    expect(result.storagePath).toMatch(/^videos\/.*\.mp4$/);
  });

  it("refuses oversize image", async () => {
    const { sb } = makeSupabaseMock();
    await expect(
      requestOverlayUploadUrl({
        sb: sb as never,
        actor,
        kind: "image",
        filename: "huge.png",
        bytes: MAX_IMAGE_BYTES + 1,
      }),
    ).rejects.toMatchObject({
      code: "too_large",
      name: "AssetUploadError",
    });
  });

  it("refuses oversize video", async () => {
    const { sb } = makeSupabaseMock();
    await expect(
      requestOverlayUploadUrl({
        sb: sb as never,
        actor,
        kind: "video",
        filename: "huge.mp4",
        bytes: MAX_VIDEO_BYTES + 1,
      }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("refuses bad image extension", async () => {
    const { sb } = makeSupabaseMock();
    await expect(
      requestOverlayUploadUrl({
        sb: sb as never,
        actor,
        kind: "image",
        filename: "evil.exe",
        bytes: 1000,
      }),
    ).rejects.toMatchObject({ code: "bad_extension" });
  });

  it("refuses bad video extension", async () => {
    const { sb } = makeSupabaseMock();
    await expect(
      requestOverlayUploadUrl({
        sb: sb as never,
        actor,
        kind: "video",
        filename: "thing.mov",
        bytes: 1000,
      }),
    ).rejects.toMatchObject({ code: "bad_extension" });
  });

  it("refuses missing extension", async () => {
    const { sb } = makeSupabaseMock();
    await expect(
      requestOverlayUploadUrl({
        sb: sb as never,
        actor,
        kind: "image",
        filename: "noext",
        bytes: 1000,
      }),
    ).rejects.toMatchObject({ code: "bad_filename" });
  });

  it("refuses invalid kind", async () => {
    const { sb } = makeSupabaseMock();
    await expect(
      requestOverlayUploadUrl({
        sb: sb as never,
        actor,
        kind: "audio",
        filename: "beep.wav",
        bytes: 1000,
      }),
    ).rejects.toMatchObject({ code: "bad_kind" });
  });

  it("raises perm_denied when broadcast.trigger missing", async () => {
    vi.mocked(requirePermAsync).mockRejectedValueOnce(
      new PermissionError("missing permission: broadcast.trigger"),
    );
    const { sb } = makeSupabaseMock();
    await expect(
      requestOverlayUploadUrl({
        sb: sb as never,
        actor: { userId: "u", roles: ["viewer"] as readonly string[] },
        kind: "image",
        filename: "ok.png",
        bytes: 1000,
      }),
    ).rejects.toMatchObject({ code: "perm_denied" });
  });

  it("bubbles storage error", async () => {
    const { sb } = makeSupabaseMock({
      signedUrlResult: { data: null, error: { message: "disk full" } },
    });
    await expect(
      requestOverlayUploadUrl({
        sb: sb as never,
        actor,
        kind: "image",
        filename: "ok.png",
        bytes: 1000,
      }),
    ).rejects.toMatchObject({
      code: "storage_error",
      message: expect.stringContaining("disk full"),
    });
  });

  it("exposes expected extension lists", () => {
    expect(IMAGE_EXTS).toContain("png");
    expect(IMAGE_EXTS).toContain("webp");
    expect(VIDEO_EXTS).toContain("mp4");
    expect(VIDEO_EXTS).toContain("webm");
  });

  it("AssetUploadError has name+code", () => {
    const e = new AssetUploadError("bad_kind", "x");
    expect(e.name).toBe("AssetUploadError");
    expect(e.code).toBe("bad_kind");
  });
});
