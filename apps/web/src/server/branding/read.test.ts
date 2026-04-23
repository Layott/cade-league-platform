import { describe, it, expect, vi } from "vitest";
import { getBrandConfig, listAllBrandAssets } from "./read";

/**
 * Plan 47 — read.test.ts. Mocks the Supabase client as a thenable
 * builder chain to cover:
 *  - fallback colors when brand_settings is empty
 *  - overlay of partner.* assets on top of the static map
 *  - admin-listing surfaces hidden rows
 */

type Builder = {
  select: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  then: (cb: (x: { data: unknown[]; error: null }) => void) => void;
};

function mockClient(tables: {
  brand_settings: unknown[];
  brand_assets: unknown[];
}) {
  function builderFor(data: unknown[]): Builder {
    const b: Builder = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      then: (cb) => {
        cb({ data, error: null });
      },
    };
    return b;
  }
  return {
    from: vi.fn((table: string) => {
      if (table === "brand_settings") return builderFor(tables.brand_settings);
      if (table === "brand_assets") return builderFor(tables.brand_assets);
      throw new Error(`unexpected table: ${table}`);
    }),
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn/${path}` },
        }),
      }),
    },
  } as unknown as Parameters<typeof getBrandConfig>[0];
}

describe("getBrandConfig", () => {
  it("falls back to static tokens when brand_settings row is missing", async () => {
    const sb = mockClient({ brand_settings: [], brand_assets: [] });
    const cfg = await getBrandConfig(sb);
    expect(cfg.primaryColor).toBe("#6bcd06");
    expect(cfg.secondaryColor).toBe("#fe036d");
    expect(cfg.primaryLogos.cade).toBe("/brand/logos/primary/cade.png");
    expect(cfg.partnerLogos).toEqual([]);
  });

  it("uses DB colors when brand_settings row exists", async () => {
    const sb = mockClient({
      brand_settings: [
        { id: 1, primary_color: "#123abc", secondary_color: "#abcdef" },
      ],
      brand_assets: [],
    });
    const cfg = await getBrandConfig(sb);
    expect(cfg.primaryColor).toBe("#123abc");
    expect(cfg.secondaryColor).toBe("#abcdef");
  });

  it("overlays primary.cade asset over the static map", async () => {
    const sb = mockClient({
      brand_settings: [],
      brand_assets: [
        {
          id: "a1",
          slot: "primary.cade",
          storage_path: "logos/cade-new.png",
          display_order: 0,
          visible: true,
          label: null,
        },
      ],
    });
    const cfg = await getBrandConfig(sb);
    expect(cfg.primaryLogos.cade).toBe("https://cdn/logos/cade-new.png");
    // Non-overridden keys still fall back
    expect(cfg.primaryLogos.proLeague).toBe(
      "/brand/logos/primary/pro-league.png",
    );
  });

  it("returns partner.* assets as a sorted visible list", async () => {
    const sb = mockClient({
      brand_settings: [],
      brand_assets: [
        {
          id: "a1",
          slot: "partner.trace_tv",
          storage_path: "logos/trace.png",
          display_order: 1,
          visible: true,
          label: "Trace",
        },
        {
          id: "a2",
          slot: "partner.hidden",
          storage_path: "logos/hidden.png",
          display_order: 2,
          visible: false,
          label: "Hidden",
        },
      ],
    });
    const cfg = await getBrandConfig(sb);
    expect(cfg.partnerLogos).toHaveLength(1);
    expect(cfg.partnerLogos[0].slot).toBe("partner.trace_tv");
  });
});

describe("listAllBrandAssets", () => {
  it("returns hidden rows so the admin editor can toggle them", async () => {
    const sb = mockClient({
      brand_settings: [],
      brand_assets: [
        {
          id: "a1",
          slot: "partner.trace_tv",
          storage_path: "logos/trace.png",
          display_order: 1,
          visible: true,
          label: "Trace",
        },
        {
          id: "a2",
          slot: "partner.hidden",
          storage_path: "logos/hidden.png",
          display_order: 2,
          visible: false,
          label: "Hidden",
        },
      ],
    });
    const all = await listAllBrandAssets(sb);
    expect(all).toHaveLength(2);
    expect(all.find((a) => a.slot === "partner.hidden")?.visible).toBe(false);
  });
});
