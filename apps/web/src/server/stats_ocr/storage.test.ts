import { describe, it, expect, vi } from "vitest";
import {
  buildStoragePath,
  createSignedRead,
  createSignedUpload,
  downloadBuffer,
  extForMime,
  BUCKET,
} from "./storage";

describe("buildStoragePath / extForMime", () => {
  it("builds matches/<matchId>/<screenshotId>.png for PNG", () => {
    expect(buildStoragePath("m-1", "s-1", "image/png")).toBe(
      "matches/m-1/s-1.png"
    );
  });

  it("uses .jpg for JPEG and .webp for WebP", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/webp")).toBe("webp");
    expect(buildStoragePath("m", "s", "image/jpeg")).toBe("matches/m/s.jpg");
  });
});

function mkStorageStub(opts: {
  uploadData?: { signedUrl: string; token: string } | null;
  uploadError?: { message: string } | null;
  readUrl?: string | null;
  readError?: { message: string } | null;
}) {
  return {
    storage: {
      from: vi.fn((bucket: string) => {
        expect(bucket).toBe(BUCKET);
        return {
          createSignedUploadUrl: vi.fn().mockResolvedValue({
            data: opts.uploadData ?? null,
            error: opts.uploadError ?? null,
          }),
          createSignedUrl: vi.fn().mockResolvedValue({
            data: opts.readUrl ? { signedUrl: opts.readUrl } : null,
            error: opts.readError ?? null,
          }),
        };
      }),
    },
  };
}

describe("createSignedUpload", () => {
  it("returns url + token + computed path", async () => {
    const sb = mkStorageStub({
      uploadData: { signedUrl: "https://x/upload", token: "tkn" },
    });
    const out = await createSignedUpload(
      sb as never,
      "m-1",
      "s-1",
      "image/png"
    );
    expect(out).toEqual({
      url: "https://x/upload",
      token: "tkn",
      path: "matches/m-1/s-1.png",
    });
  });

  it("throws on error", async () => {
    const sb = mkStorageStub({
      uploadError: { message: "denied" },
    });
    await expect(
      createSignedUpload(sb as never, "m-1", "s-1", "image/png")
    ).rejects.toThrow(/denied/);
  });
});

describe("createSignedRead", () => {
  it("default TTL is 300s", async () => {
    const createSignedUrlMock = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://x/read" }, error: null });
    const sb = {
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: createSignedUrlMock,
        })),
      },
    };
    const out = await createSignedRead(sb as never, "matches/m/s.png");
    expect(out).toBe("https://x/read");
    expect(createSignedUrlMock).toHaveBeenCalledWith("matches/m/s.png", 300);
  });

  it("respects custom TTL", async () => {
    const createSignedUrlMock = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://x/read" }, error: null });
    const sb = {
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: createSignedUrlMock,
        })),
      },
    };
    await createSignedRead(sb as never, "matches/m/s.png", 60);
    expect(createSignedUrlMock).toHaveBeenCalledWith("matches/m/s.png", 60);
  });
});

describe("downloadBuffer", () => {
  it("returns Buffer from downloaded Blob", async () => {
    const blob = {
      arrayBuffer: vi.fn().mockResolvedValue(
        new Uint8Array([1, 2, 3, 4]).buffer
      ),
    };
    const sb = {
      storage: {
        from: vi.fn(() => ({
          download: vi.fn().mockResolvedValue({ data: blob, error: null }),
        })),
      },
    };
    const buf = await downloadBuffer(sb as never, "matches/m/s.png");
    expect(buf.length).toBe(4);
    expect(buf[0]).toBe(1);
    expect(buf[3]).toBe(4);
  });
});
