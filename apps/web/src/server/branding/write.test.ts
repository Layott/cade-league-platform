import { describe, it, expect, vi } from "vitest";
import {
  upsertBrandSettings,
  upsertBrandAsset,
  setBrandAssetVisible,
  deleteBrandAsset,
} from "./write";

describe("upsertBrandSettings", () => {
  it("validates hex format on primaryColor", async () => {
    const sb = { from: vi.fn() } as unknown as Parameters<
      typeof upsertBrandSettings
    >[0];
    await expect(
      upsertBrandSettings(sb, {
        primaryColor: "nope",
        userId: "u1",
      }),
    ).rejects.toThrow(/6-digit hex/);
  });

  it("validates hex format on secondaryColor", async () => {
    const sb = { from: vi.fn() } as unknown as Parameters<
      typeof upsertBrandSettings
    >[0];
    await expect(
      upsertBrandSettings(sb, {
        secondaryColor: "#fff",
        userId: "u1",
      }),
    ).rejects.toThrow(/6-digit hex/);
  });

  it("updates existing row when one exists", async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockResolvedValue({ error: null });
    const select = vi
      .fn()
      .mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [{ id: 1 }] }),
        }),
      });
    const sb = {
      from: vi.fn(() => ({ select, update, eq })),
    } as unknown as Parameters<typeof upsertBrandSettings>[0];
    // Wire the update-chain to resolve.
    update.mockReturnValue({ eq });
    await upsertBrandSettings(sb, {
      primaryColor: "#aabbcc",
      userId: "u1",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ primary_color: "#aabbcc", updated_by: "u1" }),
    );
    expect(eq).toHaveBeenCalledWith("id", 1);
  });

  it("inserts a fresh row when no settings exist", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const select = vi
      .fn()
      .mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [] }),
        }),
      });
    const sb = {
      from: vi.fn(() => ({ select, insert })),
    } as unknown as Parameters<typeof upsertBrandSettings>[0];
    await upsertBrandSettings(sb, {
      primaryColor: "#112233",
      secondaryColor: "#445566",
      userId: "u1",
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        primary_color: "#112233",
        secondary_color: "#445566",
        updated_by: "u1",
      }),
    );
  });
});

describe("upsertBrandAsset", () => {
  it("upserts on slot conflict and returns inserted id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "a1" }, error: null });
    const selectFn = vi.fn().mockReturnValue({ single });
    const upsertFn = vi.fn().mockReturnValue({ select: selectFn });
    const sb = {
      from: vi.fn(() => ({ upsert: upsertFn })),
    } as unknown as Parameters<typeof upsertBrandAsset>[0];

    const out = await upsertBrandAsset(sb, {
      slot: "primary.cade",
      storagePath: "logos/cade.png",
      userId: "u1",
    });
    expect(out.id).toBe("a1");
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        slot: "primary.cade",
        storage_path: "logos/cade.png",
        visible: true,
        updated_by: "u1",
      }),
      { onConflict: "slot" },
    );
  });
});

describe("setBrandAssetVisible + deleteBrandAsset", () => {
  it("setBrandAssetVisible patches visible + updated_by", async () => {
    const secondIs = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockReturnValue({ is: secondIs });
    const update = vi.fn().mockReturnValue({ eq });
    const sb = {
      from: vi.fn(() => ({ update })),
    } as unknown as Parameters<typeof setBrandAssetVisible>[0];
    await setBrandAssetVisible(sb, "a1", false, "u1");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ visible: false, updated_by: "u1" }),
    );
    expect(eq).toHaveBeenCalledWith("id", "a1");
  });

  it("deleteBrandAsset soft-deletes the row", async () => {
    const secondIs = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockReturnValue({ is: secondIs });
    const update = vi.fn().mockReturnValue({ eq });
    const sb = {
      from: vi.fn(() => ({ update })),
    } as unknown as Parameters<typeof deleteBrandAsset>[0];
    await deleteBrandAsset(sb, "a1", "u1");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String), updated_by: "u1" }),
    );
  });
});
