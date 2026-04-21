import { describe, it, expect, vi } from "vitest";
import {
  buildScreenshotPath,
  createSignedUpload,
  createSignedRead,
  SQUAD_SCREENSHOTS_BUCKET,
} from "./storage";

describe("buildScreenshotPath", () => {
  it("formats the storage key with season / player / week / filename", () => {
    expect(
      buildScreenshotPath({
        seasonId: "s-1",
        playerId: "p-1",
        weekStartDate: "2026-04-16",
        filename: "abc.png",
      }),
    ).toBe("seasons/s-1/players/p-1/weeks/2026-04-16/abc.png");
  });

  it("exposes the bucket name constant", () => {
    expect(SQUAD_SCREENSHOTS_BUCKET).toBe("squad-screenshots");
  });
});

describe("createSignedUpload / createSignedRead", () => {
  function mkStorage() {
    return {
      storage: {
        from: vi.fn(() => ({
          createSignedUploadUrl: vi.fn(async (path: string) => ({
            data: { path, signedUrl: `https://cdn/${path}?u=1`, token: "t" },
            error: null,
          })),
          createSignedUrl: vi.fn(async (path: string, ttl: number) => ({
            data: { signedUrl: `https://cdn/${path}?ttl=${ttl}` },
            error: null,
          })),
        })),
      },
    };
  }

  it("signed upload returns the path + url", async () => {
    const sb = mkStorage();
    const out = await createSignedUpload(
      sb as never,
      "seasons/x/players/y/weeks/2026-04-16/a.png",
    );
    expect(out.path).toBe("seasons/x/players/y/weeks/2026-04-16/a.png");
    expect(out.signedUrl).toContain("https://cdn/");
  });

  it("signed read defaults to 300s TTL", async () => {
    const sb = mkStorage();
    const url = await createSignedRead(sb as never, "abc");
    expect(url).toContain("ttl=300");
  });
});
