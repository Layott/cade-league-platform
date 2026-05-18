import { describe, expect, it, vi } from "vitest";
import { mintPsdSignedUrl } from "./photopea-signed-url";

describe("mintPsdSignedUrl", () => {
  it("returns a 60-second signed URL for an existing PSD asset", async () => {
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "22222222-2222-4222-8222-222222222222",
            asset_type: "psd",
            file_path: "psd/22222222-2222-4222-8222-222222222222.psd",
            deleted_at: null,
          },
          error: null,
        }),
      })),
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi
            .fn()
            .mockResolvedValue({
              data: { signedUrl: "https://supabase/signed?token=abc" },
              error: null,
            }),
        })),
      },
    } as unknown as Parameters<typeof mintPsdSignedUrl>[0];

    const url = await mintPsdSignedUrl(sb, {
      assetId: "22222222-2222-4222-8222-222222222222",
    });
    expect(url).toBe("https://supabase/signed?token=abc");

    const storage = (sb as unknown as { storage: { from: ReturnType<typeof vi.fn> } })
      .storage.from as ReturnType<typeof vi.fn>;
    const call = (storage("overlay-user-assets") as unknown as {
      createSignedUrl: ReturnType<typeof vi.fn>;
    }).createSignedUrl;
    expect(call).toBeDefined();
  });

  it("rejects when the asset is missing", async () => {
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
      storage: { from: vi.fn() },
    } as unknown as Parameters<typeof mintPsdSignedUrl>[0];

    await expect(
      mintPsdSignedUrl(sb, {
        assetId: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toThrow(/asset not found/i);
  });

  it("rejects when the asset is not a PSD", async () => {
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "33333333-3333-4333-8333-333333333333",
            asset_type: "image",
            file_path: "img/x.png",
            deleted_at: null,
          },
          error: null,
        }),
      })),
      storage: { from: vi.fn() },
    } as unknown as Parameters<typeof mintPsdSignedUrl>[0];

    await expect(
      mintPsdSignedUrl(sb, {
        assetId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toThrow(/not a psd asset/i);
  });
});
