import { describe, it, expect, vi, beforeEach } from "vitest";

const { requirePermAsyncMock } = vi.hoisted(() => ({
  requirePermAsyncMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: requirePermAsyncMock,
  PermissionError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = "PermissionError";
    }
  },
}));

import {
  listPartnerLogos,
  getPartnerLogo,
  createPartnerLogo,
  updatePartnerLogo,
  deletePartnerLogo,
  reorderPartnerLogos,
  getOverrides,
  setLogoOverride,
  clearLogoOverride,
  resolvePartnerLogos,
  validateLogoDimensions,
  type PartnerLogoInput,
} from "./logos";

const ACTOR = { userId: "u-1", roles: ["admin"] };
const KEY = "01-brb";
const VARIANT = "default";

type LogoRow = {
  id: string;
  partner_key: string;
  label: string;
  alt: string;
  display_label: string | null;
  file_url: string;
  file_size_bytes: number;
  dimension_w_px: number;
  dimension_h_px: number;
  sort_order: number;
  set_by: string;
  created_at: string;
  updated_at: string;
};
type OverrideRow = {
  id: string;
  overlay_key: string;
  variant_id: string;
  partner_key: string;
  visible: boolean;
  sort_override: number | null;
};

function mkLogo(overrides: Partial<LogoRow> = {}): LogoRow {
  return {
    id: "logo-1",
    partner_key: "gameevo",
    label: "GameEvo",
    alt: "GameEvo",
    display_label: null,
    file_url: "/x/gameevo.png",
    file_size_bytes: 150000,
    dimension_w_px: 600,
    dimension_h_px: 300,
    sort_order: 0,
    set_by: "u-1",
    created_at: "2026-04-29T08:00:00Z",
    updated_at: "2026-04-29T08:00:00Z",
    ...overrides,
  };
}
function mkOverride(overrides: Partial<OverrideRow> = {}): OverrideRow {
  return {
    id: "ov-1",
    overlay_key: KEY,
    variant_id: VARIANT,
    partner_key: "gameevo",
    visible: true,
    sort_override: null,
    ...overrides,
  };
}

function logosTable(rows: LogoRow[]) {
  const orderResult = vi.fn().mockResolvedValue({ data: rows, error: null });
  const maybeSingleResult = vi.fn().mockResolvedValue({
    data: rows[0] ?? null,
    error: null,
  });
  const insertSingle = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null });
  const updateSingle = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null });
  const updateBulk = vi.fn().mockResolvedValue({ error: null });

  const select = vi.fn(() => ({
    is: vi.fn(() => ({ order: orderResult })),
    eq: vi.fn(() => ({
      is: vi.fn(() => ({ maybeSingle: maybeSingleResult })),
    })),
  }));
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({ single: insertSingle })),
  }));
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      is: vi.fn(() => {
        return {
          select: vi.fn(() => ({ single: updateSingle })),
          // updateBulk path used by reorder + delete
          then: undefined,
        };
      }),
    })),
  }));
  // Unique pattern for soft-delete + reorder: just .eq().is() chain ending in awaitable
  const updateForDelete = vi.fn(() => ({
    eq: vi.fn(() => ({
      is: vi.fn(() => updateBulk()),
    })),
  }));
  return {
    select,
    insert,
    update: vi.fn((payload: Record<string, unknown>) => {
      // If payload is a soft-delete (deleted_at set) OR a reorder
      // (just sort_order + updated_at), use the "no .select().single()"
      // chain. Otherwise the patch path with .select().single().
      const isPatch =
        payload != null &&
        Object.keys(payload).some((k) =>
          ["label", "alt", "display_label", "file_url", "file_size_bytes",
           "dimension_w_px", "dimension_h_px"].includes(k),
        );
      if (isPatch) return update();
      return updateForDelete();
    }),
    _spies: { orderResult, maybeSingleResult, insertSingle, updateSingle, updateBulk },
  };
}

function overridesTable(rows: OverrideRow[]) {
  const eqIsResult = vi.fn().mockResolvedValue({ data: rows, error: null });
  const upsertSingle = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null });
  const updateClear = vi.fn().mockResolvedValue({ error: null });
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({ is: eqIsResult })),
    })),
  }));
  const upsert = vi.fn(() => ({
    select: vi.fn(() => ({ single: upsertSingle })),
  }));
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ is: vi.fn(() => updateClear()) })),
      })),
    })),
  }));
  return {
    select,
    upsert,
    update,
    _spies: { eqIsResult, upsertSingle, updateClear },
  };
}

function mkSb(logos: LogoRow[] = [], overrides: OverrideRow[] = []) {
  const lt = logosTable(logos);
  const ot = overridesTable(overrides);
  return {
    from: vi.fn((t: string) => {
      if (t === "overlay_partner_logos") return lt;
      if (t === "overlay_partner_logo_overrides") return ot;
      throw new Error(`unexpected table ${t}`);
    }),
    _logos: lt,
    _overrides: ot,
  };
}

const VALID_LOGO: PartnerLogoInput = {
  partnerKey: "newpartner",
  label: "New Partner",
  alt: "New Partner",
  fileUrl: "/x/new.png",
  fileSizeBytes: 100000,
  dimensionWPx: 600,
  dimensionHPx: 300,
  sortOrder: 99,
};

describe("validateLogoDimensions", () => {
  it("accepts exact 600×300", () => {
    expect(validateLogoDimensions(600, 300).ok).toBe(true);
  });
  it("accepts edges of ±10% band", () => {
    expect(validateLogoDimensions(540, 270).ok).toBe(true);
    expect(validateLogoDimensions(660, 330).ok).toBe(true);
  });
  it("rejects 800×400", () => {
    const r = validateLogoDimensions(800, 400);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/800×400/);
  });
  it("rejects too small", () => {
    expect(validateLogoDimensions(539, 300).ok).toBe(false);
  });
  it("bypasses check when isVector=true", () => {
    expect(validateLogoDimensions(99999, 99999, true).ok).toBe(true);
  });
});

describe("listPartnerLogos", () => {
  it("returns empty array when none exist", async () => {
    const sb = mkSb([]);
    const out = await listPartnerLogos(sb as never);
    expect(out).toEqual([]);
  });
  it("maps rows to camelCase logos", async () => {
    const sb = mkSb([mkLogo({ partner_key: "gameevo", sort_order: 1 })]);
    const out = await listPartnerLogos(sb as never);
    expect(out).toHaveLength(1);
    expect(out[0].partnerKey).toBe("gameevo");
    expect(out[0].sortOrder).toBe(1);
  });
});

describe("getPartnerLogo", () => {
  it("returns null when missing", async () => {
    const sb = mkSb([]);
    const out = await getPartnerLogo(sb as never, "ghost");
    expect(out).toBeNull();
  });
  it("returns the mapped logo when present", async () => {
    const sb = mkSb([mkLogo({ partner_key: "gameevo" })]);
    const out = await getPartnerLogo(sb as never, "gameevo");
    expect(out?.partnerKey).toBe("gameevo");
  });
});

describe("createPartnerLogo — perm + validation", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      createPartnerLogo(sb as never, ACTOR, VALID_LOGO),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("rejects bad partner key", async () => {
    const sb = mkSb([]);
    await expect(
      createPartnerLogo(sb as never, ACTOR, {
        ...VALID_LOGO,
        partnerKey: "Bad Key",
      }),
    ).rejects.toThrow(/kebab-case/);
  });

  it("rejects oversized file_size_bytes", async () => {
    const sb = mkSb([]);
    await expect(
      createPartnerLogo(sb as never, ACTOR, {
        ...VALID_LOGO,
        fileSizeBytes: 600000,
      }),
    ).rejects.toThrow(/fileSizeBytes/);
  });

  it("rejects out-of-tolerance PNG dimensions", async () => {
    const sb = mkSb([]);
    await expect(
      createPartnerLogo(sb as never, ACTOR, {
        ...VALID_LOGO,
        dimensionWPx: 800,
        dimensionHPx: 400,
      }),
    ).rejects.toThrow(/600×300/);
  });

  it("ALLOWS oddly-sized SVG (vector bypass)", async () => {
    const sb = mkSb([
      mkLogo({ partner_key: "newpartner", file_url: "/x/new.svg" }),
    ]);
    await expect(
      createPartnerLogo(sb as never, ACTOR, {
        ...VALID_LOGO,
        fileUrl: "/x/new.svg",
        dimensionWPx: 1000,
        dimensionHPx: 1000,
      }),
    ).resolves.toBeDefined();
  });

  it("inserts a valid logo", async () => {
    const sb = mkSb([mkLogo({ partner_key: "newpartner" })]);
    const out = await createPartnerLogo(sb as never, ACTOR, VALID_LOGO);
    expect(out.partnerKey).toBe("newpartner"); // mock returns first row
    expect(sb._logos.insert).toHaveBeenCalled();
  });
});

describe("updatePartnerLogo", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      updatePartnerLogo(sb as never, ACTOR, "gameevo", { label: "X" }),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("re-validates dimensions when patch updates them", async () => {
    const sb = mkSb([mkLogo()]);
    await expect(
      updatePartnerLogo(sb as never, ACTOR, "gameevo", {
        dimensionWPx: 800,
        dimensionHPx: 400,
      }),
    ).rejects.toThrow(/600×300/);
  });

  it("applies the patch when valid", async () => {
    const sb = mkSb([mkLogo({ label: "Updated" })]);
    const out = await updatePartnerLogo(sb as never, ACTOR, "gameevo", {
      label: "Updated",
    });
    expect(out.label).toBe("Updated");
  });
});

describe("deletePartnerLogo", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      deletePartnerLogo(sb as never, ACTOR, "gameevo"),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("soft-deletes the row", async () => {
    const sb = mkSb([mkLogo()]);
    await deletePartnerLogo(sb as never, ACTOR, "gameevo");
    expect(sb._logos.update).toHaveBeenCalled();
  });
});

describe("reorderPartnerLogos", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([]);
    await expect(
      reorderPartnerLogos(sb as never, ACTOR, ["gameevo"]),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("rejects bad partner keys", async () => {
    const sb = mkSb([]);
    await expect(
      reorderPartnerLogos(sb as never, ACTOR, ["Bad Key"]),
    ).rejects.toThrow(/invalid partner key/);
  });

  it("reorders the keys in array order", async () => {
    const sb = mkSb([mkLogo()]);
    await reorderPartnerLogos(sb as never, ACTOR, ["a", "b", "c"]);
    expect(sb._logos.update).toHaveBeenCalledTimes(3);
  });
});

describe("setLogoOverride / clearLogoOverride / getOverrides", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects setLogoOverride without perm", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSb([], []);
    await expect(
      setLogoOverride(sb as never, ACTOR, {
        overlayKey: KEY,
        variantId: VARIANT,
        partnerKey: "gameevo",
        visible: false,
        sortOverride: null,
      }),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("rejects unknown overlay key", async () => {
    const sb = mkSb([], []);
    await expect(
      setLogoOverride(sb as never, ACTOR, {
        overlayKey: "99-fake",
        variantId: VARIANT,
        partnerKey: "gameevo",
        visible: false,
        sortOverride: null,
      }),
    ).rejects.toThrow(/unknown overlay key/);
  });

  it("upserts an override", async () => {
    const sb = mkSb([], [mkOverride({ visible: false })]);
    const out = await setLogoOverride(sb as never, ACTOR, {
      overlayKey: KEY,
      variantId: VARIANT,
      partnerKey: "gameevo",
      visible: false,
      sortOverride: null,
    });
    expect(out.visible).toBe(false);
  });

  it("clearLogoOverride soft-deletes", async () => {
    const sb = mkSb([], [mkOverride()]);
    await clearLogoOverride(sb as never, ACTOR, KEY, VARIANT, "gameevo");
    expect(sb._overrides.update).toHaveBeenCalled();
  });

  it("getOverrides returns mapped rows", async () => {
    const sb = mkSb([], [mkOverride({ visible: false })]);
    const out = await getOverrides(sb as never, KEY, VARIANT);
    expect(out).toHaveLength(1);
    expect(out[0].visible).toBe(false);
  });
});

describe("resolvePartnerLogos — merge logic", () => {
  it("returns the global roster sorted ascending by sort_order", async () => {
    const sb = mkSb(
      [
        mkLogo({ partner_key: "a", sort_order: 1 }),
        mkLogo({ id: "b", partner_key: "b", sort_order: 0 }),
      ],
      [],
    );
    const out = await resolvePartnerLogos(sb as never, KEY, VARIANT);
    expect(out.map((l) => l.partnerKey)).toEqual(["b", "a"]);
  });

  it("filters out hidden partners via override", async () => {
    const sb = mkSb(
      [
        mkLogo({ id: "1", partner_key: "a", sort_order: 0 }),
        mkLogo({ id: "2", partner_key: "b", sort_order: 1 }),
      ],
      [mkOverride({ partner_key: "a", visible: false })],
    );
    const out = await resolvePartnerLogos(sb as never, KEY, VARIANT);
    expect(out.map((l) => l.partnerKey)).toEqual(["b"]);
  });

  it("uses sort_override to push a partner to the front", async () => {
    const sb = mkSb(
      [
        mkLogo({ id: "1", partner_key: "a", sort_order: 0 }),
        mkLogo({ id: "2", partner_key: "b", sort_order: 1 }),
      ],
      [mkOverride({ partner_key: "b", sort_override: -1 })],
    );
    const out = await resolvePartnerLogos(sb as never, KEY, VARIANT);
    expect(out.map((l) => l.partnerKey)).toEqual(["b", "a"]);
  });
});

/* ------------------------------------------------------------------ *
 * Universal element labels (post-2026-04-28)                         *
 * Migration: 20260620000011_overlay_partner_logos_display_label.sql  *
 * ------------------------------------------------------------------ */

describe("PartnerLogo displayLabel field", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("listPartnerLogos maps display_label to displayLabel", async () => {
    const sb = mkSb([
      mkLogo({ partner_key: "gameevo", display_label: "GameEvo Sponsor Logo" }),
    ]);
    const out = await listPartnerLogos(sb as never);
    expect(out[0].displayLabel).toBe("GameEvo Sponsor Logo");
  });

  it("listPartnerLogos coerces missing display_label to null", async () => {
    const sb = mkSb([mkLogo({ display_label: null })]);
    const out = await listPartnerLogos(sb as never);
    expect(out[0].displayLabel).toBeNull();
  });

  it("createPartnerLogo persists displayLabel", async () => {
    const sb = mkSb([mkLogo({ partner_key: "newpartner" })]);
    await createPartnerLogo(sb as never, ACTOR, {
      ...VALID_LOGO,
      displayLabel: "New Sponsor",
    });
    expect(sb._logos.insert).toHaveBeenCalled();
  });

  it("createPartnerLogo defaults displayLabel to alt when omitted", async () => {
    const sb = mkSb([mkLogo({ partner_key: "newpartner" })]);
    // Server default: when no displayLabel passed, the row carries `alt`.
    // Validation passes — confirms the default-fallback path doesn't trip.
    await expect(
      createPartnerLogo(sb as never, ACTOR, VALID_LOGO),
    ).resolves.toBeDefined();
  });

  it("createPartnerLogo rejects empty-string displayLabel", async () => {
    const sb = mkSb([]);
    await expect(
      createPartnerLogo(sb as never, ACTOR, {
        ...VALID_LOGO,
        displayLabel: "",
      }),
    ).rejects.toThrow(/displayLabel must be 1\.\.200/);
  });

  it("createPartnerLogo rejects displayLabel longer than 200 chars", async () => {
    const sb = mkSb([]);
    await expect(
      createPartnerLogo(sb as never, ACTOR, {
        ...VALID_LOGO,
        displayLabel: "X".repeat(201),
      }),
    ).rejects.toThrow(/displayLabel must be 1\.\.200/);
  });

  it("updatePartnerLogo accepts a displayLabel patch", async () => {
    const sb = mkSb([mkLogo({ display_label: "Old Label" })]);
    await expect(
      updatePartnerLogo(sb as never, ACTOR, "gameevo", {
        displayLabel: "New Label",
      }),
    ).resolves.toBeDefined();
  });

  it("updatePartnerLogo rejects empty-string displayLabel patch", async () => {
    const sb = mkSb([mkLogo()]);
    await expect(
      updatePartnerLogo(sb as never, ACTOR, "gameevo", {
        displayLabel: "",
      }),
    ).rejects.toThrow(/displayLabel must be 1\.\.200/);
  });
});
