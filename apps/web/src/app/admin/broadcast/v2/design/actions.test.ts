import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 3 — overlay design actions tests.
 *
 * Covers (a) perm rejection, (b) input validation, (c) success path
 * delegating to the underlying server modules. Mocks the server-module
 * helpers because their own unit tests already cover token/template/
 * history behaviour — these tests exist to lock the action layer's
 * gate + zod + revalidate contract.
 */

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    const e = new Error(`NEXT_REDIRECT;${url}`);
    (e as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${url};303`;
    throw e;
  }),
);
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const revalidateMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

const userClientMock = vi.hoisted(() => {
  const usersQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { id: "pub-user-1" }, error: null }),
  };
  const rolesQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi
      .fn()
      .mockResolvedValue({ data: [{ role: "admin" }], error: null }),
  };
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "auth-user-1" } } }),
    },
    from: vi.fn((table: string) => {
      if (table === "users") return usersQuery;
      if (table === "user_roles") return rolesQuery;
      throw new Error(`unexpected table: ${table}`);
    }),
  };
});
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: () => userClientMock,
}));

const storageUploadMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: {}, error: null }),
);
const storagePublicUrlMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    data: { publicUrl: "https://supabase.local/partner-logos/test.png" },
  }),
);
const storageFromMock = vi.hoisted(() =>
  vi.fn(() => ({
    upload: storageUploadMock,
    getPublicUrl: storagePublicUrlMock,
  })),
);
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: () => ({
    storage: { from: storageFromMock },
  }),
}));

const { requirePermAsyncMock, FakePermissionError } = vi.hoisted(() => {
  class FakePermissionError extends Error {
    constructor(m: string) {
      super(m);
      this.name = "PermissionError";
    }
  }
  return {
    requirePermAsyncMock: vi.fn().mockResolvedValue(undefined),
    FakePermissionError,
  };
});
vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: requirePermAsyncMock,
  PermissionError: FakePermissionError,
}));

const enforceAuthedWriteMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock("@/lib/api-rate-limit", () => ({
  enforceAuthedWrite: enforceAuthedWriteMock,
}));

const setDesignTokenMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const clearDesignTokenMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/server/overlays/design/tokens", () => ({
  setDesignToken: setDesignTokenMock,
  clearDesignToken: clearDesignTokenMock,
}));

const setActiveTemplateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/server/overlays/design/templates", () => ({
  setActiveTemplate: setActiveTemplateMock,
}));

const revertToSnapshotMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/server/overlays/design/history", () => ({
  revertToSnapshot: revertToSnapshotMock,
}));

// Wave 2 Stage 2 — text element CRUD mocks.
const upsertTextElementMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "row-1" }),
);
const getTextElementMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("@/server/overlays/text/elements", () => ({
  upsertTextElement: upsertTextElementMock,
  getTextElement: getTextElementMock,
}));

// Wave 2 Stage 3 — partner-strip + logo CRUD mocks.
const upsertStripLayoutMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "row-1" }),
);
vi.mock("@/server/overlays/partners/strip", () => ({
  upsertStripLayout: upsertStripLayoutMock,
}));

const createPartnerLogoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "row-1", partnerKey: "p" }),
);
const deletePartnerLogoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const setLogoOverrideMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "row-1" }),
);
vi.mock("@/server/overlays/partners/logos", () => ({
  createPartnerLogo: createPartnerLogoMock,
  deletePartnerLogo: deletePartnerLogoMock,
  setLogoOverride: setLogoOverrideMock,
}));

// `sharp` mock — yields configurable metadata so we can simulate good
// dimensions (600×300), under-sized, oversize, and "could not read".
const sharpMetadataMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ width: 600, height: 300 }),
);
const sharpDefaultMock = vi.hoisted(() => {
  return vi.fn(() => ({
    metadata: sharpMetadataMock,
  }));
});
vi.mock("sharp", () => ({ default: sharpDefaultMock }));

import {
  saveTokensAction,
  setActiveTemplateAction,
  revertToSnapshotAction,
  setTextElementAction,
  clearTextElementAction,
  setStripLayoutAction,
  uploadPartnerLogoAction,
  removePartnerLogoAction,
  setLogoOverrideAction,
} from "./actions";

beforeEach(() => {
  redirectMock.mockClear();
  revalidateMock.mockClear();
  requirePermAsyncMock.mockReset().mockResolvedValue(undefined);
  enforceAuthedWriteMock.mockReset().mockResolvedValue(false);
  setDesignTokenMock.mockClear().mockResolvedValue({});
  clearDesignTokenMock.mockClear().mockResolvedValue(undefined);
  setActiveTemplateMock.mockClear().mockResolvedValue(undefined);
  revertToSnapshotMock.mockClear().mockResolvedValue(undefined);
  upsertTextElementMock.mockReset().mockResolvedValue({ id: "row-1" });
  getTextElementMock.mockReset().mockResolvedValue(null);
  upsertStripLayoutMock.mockReset().mockResolvedValue({ id: "row-1" });
  createPartnerLogoMock.mockReset().mockResolvedValue({
    id: "row-1",
    partnerKey: "p",
  });
  deletePartnerLogoMock.mockReset().mockResolvedValue(undefined);
  setLogoOverrideMock.mockReset().mockResolvedValue({ id: "row-1" });
  sharpMetadataMock.mockReset().mockResolvedValue({ width: 600, height: 300 });
  sharpDefaultMock.mockClear();
  storageUploadMock.mockReset().mockResolvedValue({ data: {}, error: null });
  storagePublicUrlMock.mockReset().mockReturnValue({
    data: { publicUrl: "https://supabase.local/partner-logos/test.png" },
  });
  storageFromMock.mockClear();
});

function fdSave(overlayKey: string, variantId: string, tokens: object): FormData {
  const fd = new FormData();
  fd.set("overlayKey", overlayKey);
  fd.set("variantId", variantId);
  fd.set("tokens", JSON.stringify(tokens));
  return fd;
}

describe("saveTokensAction", () => {
  it("rejects when actor lacks overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    await expect(
      saveTokensAction(fdSave("07-leaderboard", "default", { "accent-color": "#fe036d" })),
    ).rejects.toThrow(/Forbidden: missing overlay\.design\.manage/);
    expect(setDesignTokenMock).not.toHaveBeenCalled();
  });

  it("rejects unknown overlayKey", async () => {
    await expect(
      saveTokensAction(fdSave("not-a-real-key", "default", { "accent-color": "#fe036d" })),
    ).rejects.toThrow();
    expect(setDesignTokenMock).not.toHaveBeenCalled();
  });

  it("rejects malformed tokens JSON", async () => {
    const fd = new FormData();
    fd.set("overlayKey", "07-leaderboard");
    fd.set("variantId", "default");
    fd.set("tokens", "not-json{");
    await expect(saveTokensAction(fd)).rejects.toThrow(/valid JSON/);
  });

  it("rejects values containing CSS metacharacters", async () => {
    await expect(
      saveTokensAction(
        fdSave("07-leaderboard", "default", {
          "accent-color": "red; }/*hack",
        }),
      ),
    ).rejects.toThrow(/forbidden|invalid token/i);
  });

  it("calls setDesignToken with the catalog-derived type on success", async () => {
    await saveTokensAction(
      fdSave("07-leaderboard", "default", {
        "accent-color": "#fe036d",
        scale: "1.25",
      }),
    );
    expect(setDesignTokenMock).toHaveBeenCalledTimes(2);
    const calls = setDesignTokenMock.mock.calls.map((c) => ({
      key: c[4],
      value: c[5],
      type: c[6],
    }));
    expect(calls).toEqual(
      expect.arrayContaining([
        { key: "accent-color", value: "#fe036d", type: "color" },
        { key: "scale", value: "1.25", type: "number" },
      ]),
    );
    expect(revalidateMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/design",
    );
    expect(revalidateMock).toHaveBeenCalledWith(
      "/overlay/v2/07-leaderboard",
      "page",
    );
  });

  it("clears tokens whose value is empty string instead of upserting", async () => {
    await saveTokensAction(
      fdSave("07-leaderboard", "default", { "accent-color": "" }),
    );
    expect(setDesignTokenMock).not.toHaveBeenCalled();
    expect(clearDesignTokenMock).toHaveBeenCalledTimes(1);
    expect(clearDesignTokenMock.mock.calls[0][4]).toBe("accent-color");
  });

  it("silently drops unknown token keys", async () => {
    await saveTokensAction(
      fdSave("07-leaderboard", "default", {
        "accent-color": "#fe036d",
      }),
    );
    expect(setDesignTokenMock).toHaveBeenCalledTimes(1);
  });

  it("propagates rate_limited from enforceAuthedWrite", async () => {
    enforceAuthedWriteMock.mockResolvedValueOnce(true);
    await expect(
      saveTokensAction(fdSave("07-leaderboard", "default", { "accent-color": "#fe036d" })),
    ).rejects.toThrow(/rate_limited/);
  });
});

describe("setActiveTemplateAction", () => {
  it("rejects without perm", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    const fd = new FormData();
    fd.set("overlayKey", "09-secondary-score-bug");
    fd.set("variantId", "bold");
    await expect(setActiveTemplateAction(fd)).rejects.toThrow(
      /Forbidden: missing overlay\.design\.manage/,
    );
  });

  it("rejects unknown overlayKey", async () => {
    const fd = new FormData();
    fd.set("overlayKey", "not-a-real-key");
    fd.set("variantId", "default");
    await expect(setActiveTemplateAction(fd)).rejects.toThrow();
  });

  it("delegates to setActiveTemplate on success", async () => {
    const fd = new FormData();
    fd.set("overlayKey", "09-secondary-score-bug");
    fd.set("variantId", "bold");
    await setActiveTemplateAction(fd);
    expect(setActiveTemplateMock).toHaveBeenCalledTimes(1);
    expect(setActiveTemplateMock.mock.calls[0][2]).toBe("09-secondary-score-bug");
    expect(setActiveTemplateMock.mock.calls[0][3]).toBe("bold");
  });
});

describe("revertToSnapshotAction", () => {
  it("rejects without perm", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    const fd = new FormData();
    fd.set("snapshotId", "11111111-1111-4111-8111-111111111111");
    fd.set("overlayKey", "07-leaderboard");
    await expect(revertToSnapshotAction(fd)).rejects.toThrow(
      /Forbidden: missing overlay\.design\.manage/,
    );
  });

  it("rejects when snapshotId is not a uuid", async () => {
    const fd = new FormData();
    fd.set("snapshotId", "not-a-uuid");
    fd.set("overlayKey", "07-leaderboard");
    await expect(revertToSnapshotAction(fd)).rejects.toThrow();
  });

  it("delegates to revertToSnapshot on success", async () => {
    const fd = new FormData();
    fd.set("snapshotId", "11111111-1111-4111-8111-111111111111");
    fd.set("overlayKey", "07-leaderboard");
    await revertToSnapshotAction(fd);
    expect(revertToSnapshotMock).toHaveBeenCalledTimes(1);
    expect(revertToSnapshotMock.mock.calls[0][2]).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 2 — text-element editing                              *
 * ------------------------------------------------------------------ */

function fdText(
  overlayKey: string,
  elementId: string,
  fields: Partial<{
    variantId: string;
    kind: string;
    visible: string;
    content: string;
    color: string;
    fontFamily: string;
    fontWeight: string;
    fontSizePx: string;
    positionXPx: string;
    positionYPx: string;
    alignment: string;
    opacityPct: string;
  }> = {},
): FormData {
  const fd = new FormData();
  fd.set("overlayKey", overlayKey);
  fd.set("variantId", fields.variantId ?? "default");
  fd.set("elementId", elementId);
  if (fields.kind) fd.set("kind", fields.kind);
  if (fields.visible) fd.set("visible", fields.visible);
  if (fields.content != null) fd.set("content", fields.content);
  if (fields.color) fd.set("color", fields.color);
  if (fields.fontFamily) fd.set("fontFamily", fields.fontFamily);
  if (fields.fontWeight) fd.set("fontWeight", fields.fontWeight);
  if (fields.fontSizePx) fd.set("fontSizePx", fields.fontSizePx);
  if (fields.positionXPx) fd.set("positionXPx", fields.positionXPx);
  if (fields.positionYPx) fd.set("positionYPx", fields.positionYPx);
  if (fields.alignment) fd.set("alignment", fields.alignment);
  if (fields.opacityPct) fd.set("opacityPct", fields.opacityPct);
  return fd;
}

describe("setTextElementAction (Wave 2 Stage 2)", () => {
  it("rejects when actor lacks overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    await expect(
      setTextElementAction(
        fdText("07-leaderboard", "title", {
          content: "GAME ON",
          kind: "title",
        }),
      ),
    ).rejects.toThrow(/Forbidden|overlay\.design\.manage/);
    expect(upsertTextElementMock).not.toHaveBeenCalled();
  });

  it("rejects unknown overlayKey", async () => {
    await expect(
      setTextElementAction(
        fdText("not-a-real-key", "title", { content: "GAME ON" }),
      ),
    ).rejects.toThrow();
    expect(upsertTextElementMock).not.toHaveBeenCalled();
  });

  it("rejects non-kebab-case elementId", async () => {
    await expect(
      setTextElementAction(
        fdText("07-leaderboard", "Bad_Id_With_Caps", {
          content: "GAME ON",
        }),
      ),
    ).rejects.toThrow(/elementId|kebab/i);
    expect(upsertTextElementMock).not.toHaveBeenCalled();
  });

  it("upserts a text element on success — preserves seed kind from existing row", async () => {
    getTextElementMock.mockResolvedValueOnce({
      id: "row-1",
      overlayKey: "07-leaderboard",
      variantId: "default",
      elementId: "title",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      letterSpacing: null,
      lineHeight: null,
      color: null,
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
      setBy: "u-1",
      createdAt: "2026-04-29T08:00:00Z",
      updatedAt: "2026-04-29T08:00:00Z",
    });
    await setTextElementAction(
      fdText("07-leaderboard", "title", {
        content: "GAME ON",
        color: "#fe036d",
        fontSizePx: "120",
        fontWeight: "900",
      }),
    );
    expect(upsertTextElementMock).toHaveBeenCalledTimes(1);
    const callInput = upsertTextElementMock.mock.calls[0][2];
    expect(callInput).toMatchObject({
      overlayKey: "07-leaderboard",
      variantId: "default",
      elementId: "title",
      origin: "seed",
      kind: "title",
      content: "GAME ON",
      color: "#fe036d",
      fontSizePx: 120,
      fontWeight: 900,
    });
    expect(revalidateMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/design",
    );
    expect(revalidateMock).toHaveBeenCalledWith(
      "/overlay/v2/07-leaderboard",
      "page",
    );
  });

  it("defaults to runtime origin + body kind when no existing row", async () => {
    getTextElementMock.mockResolvedValueOnce(null);
    await setTextElementAction(
      fdText("07-leaderboard", "new-element", {
        content: "Hello world",
        kind: "caption",
        positionXPx: "200",
        positionYPx: "100",
      }),
    );
    expect(upsertTextElementMock).toHaveBeenCalledTimes(1);
    const callInput = upsertTextElementMock.mock.calls[0][2];
    expect(callInput).toMatchObject({
      origin: "runtime",
      kind: "caption",
      content: "Hello world",
      positionXPx: 200,
      positionYPx: 100,
    });
  });
});

describe("clearTextElementAction (Wave 2 Stage 2)", () => {
  it("rejects unknown overlayKey", async () => {
    await expect(
      clearTextElementAction(fdText("not-a-real-key", "title")),
    ).rejects.toThrow();
    expect(upsertTextElementMock).not.toHaveBeenCalled();
  });

  it("no-ops when row does not exist (still revalidates path)", async () => {
    getTextElementMock.mockResolvedValueOnce(null);
    await clearTextElementAction(fdText("07-leaderboard", "ghost"));
    expect(upsertTextElementMock).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/design",
    );
  });

  it("upserts the row with all-null typography on success", async () => {
    getTextElementMock.mockResolvedValueOnce({
      id: "row-1",
      overlayKey: "07-leaderboard",
      variantId: "default",
      elementId: "title",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "EXISTING CONTENT",
      fontFamily: "Agharti",
      fontWeight: 900,
      fontSizePx: 120,
      letterSpacing: null,
      lineHeight: null,
      color: "#fe036d",
      alignment: null,
      opacityPct: null,
      positionXPx: null,
      positionYPx: null,
      zIndex: null,
      sortOrder: 0,
      setBy: "u-1",
      createdAt: "2026-04-29T08:00:00Z",
      updatedAt: "2026-04-29T08:00:00Z",
    });
    await clearTextElementAction(fdText("07-leaderboard", "title"));
    expect(upsertTextElementMock).toHaveBeenCalledTimes(1);
    const callInput = upsertTextElementMock.mock.calls[0][2];
    expect(callInput).toMatchObject({
      overlayKey: "07-leaderboard",
      elementId: "title",
      origin: "seed",
      kind: "title",
      visible: true,
      content: "",
      fontFamily: null,
      fontWeight: null,
      fontSizePx: null,
      color: null,
    });
  });
});

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 3 — partner strip + logo manager                      *
 * ------------------------------------------------------------------ */

function fdLayout(
  overlayKey: string,
  fields: Partial<{
    variantId: string;
    visible: string;
    positionXPx: string;
    positionYPx: string;
    anchor: string;
    orientation: string;
    scalePct: string;
    itemSpacingPx: string;
    justification: string;
    zIndex: string;
  }> = {},
): FormData {
  const fd = new FormData();
  fd.set("overlayKey", overlayKey);
  fd.set("variantId", fields.variantId ?? "default");
  fd.set("visible", fields.visible ?? "true");
  fd.set("positionXPx", fields.positionXPx ?? "0");
  fd.set("positionYPx", fields.positionYPx ?? "1020");
  fd.set("anchor", fields.anchor ?? "bottom-center");
  fd.set("orientation", fields.orientation ?? "horizontal");
  fd.set("scalePct", fields.scalePct ?? "100");
  fd.set("itemSpacingPx", fields.itemSpacingPx ?? "64");
  fd.set("justification", fields.justification ?? "center");
  fd.set("zIndex", fields.zIndex ?? "12");
  return fd;
}

describe("setStripLayoutAction (Wave 2 Stage 3)", () => {
  it("rejects when actor lacks overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    await expect(setStripLayoutAction(fdLayout("01-brb"))).rejects.toThrow(
      /Forbidden|overlay\.design\.manage/,
    );
    expect(upsertStripLayoutMock).not.toHaveBeenCalled();
  });

  it("rejects unknown overlayKey", async () => {
    await expect(
      setStripLayoutAction(fdLayout("not-a-real-key")),
    ).rejects.toThrow();
    expect(upsertStripLayoutMock).not.toHaveBeenCalled();
  });

  it("rejects unknown anchor", async () => {
    await expect(
      setStripLayoutAction(fdLayout("01-brb", { anchor: "way-off" })),
    ).rejects.toThrow();
  });

  it("rejects scale out of range", async () => {
    await expect(
      setStripLayoutAction(fdLayout("01-brb", { scalePct: "999" })),
    ).rejects.toThrow();
  });

  it("propagates rate_limited", async () => {
    enforceAuthedWriteMock.mockResolvedValueOnce(true);
    await expect(setStripLayoutAction(fdLayout("01-brb"))).rejects.toThrow(
      /rate_limited/,
    );
  });

  it("delegates to upsertStripLayout on success + revalidates", async () => {
    await setStripLayoutAction(
      fdLayout("01-brb", {
        anchor: "top-right",
        positionXPx: "1820",
        positionYPx: "100",
        scalePct: "150",
      }),
    );
    expect(upsertStripLayoutMock).toHaveBeenCalledTimes(1);
    const call = upsertStripLayoutMock.mock.calls[0];
    expect(call[2]).toMatchObject({
      overlayKey: "01-brb",
      variantId: "default",
      anchor: "top-right",
      positionXPx: 1820,
      positionYPx: 100,
      scalePct: 150,
      visible: true,
    });
    expect(revalidateMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/design",
    );
    expect(revalidateMock).toHaveBeenCalledWith("/overlay/v2/01-brb", "page");
  });
});

function makeFile(
  bytes: number,
  type: string,
  name = "logo.png",
): File {
  const arr = new Uint8Array(bytes);
  return new File([arr], name, { type });
}

function fdUpload(
  overrides: Partial<{
    partnerKey: string;
    label: string;
    alt: string;
    sortOrder: string;
    file: File | string | null;
  }> = {},
): FormData {
  const fd = new FormData();
  fd.set("partnerKey", overrides.partnerKey ?? "newpartner");
  fd.set("label", overrides.label ?? "New Partner");
  fd.set("alt", overrides.alt ?? "New Partner logo");
  fd.set("sortOrder", overrides.sortOrder ?? "5");
  if (overrides.file !== null) {
    const f =
      overrides.file instanceof File
        ? overrides.file
        : makeFile(2048, "image/png");
    fd.set("file", f);
  }
  return fd;
}

describe("uploadPartnerLogoAction (Wave 2 Stage 3)", () => {
  it("rejects bad partnerKey", async () => {
    const r = await uploadPartnerLogoAction(
      fdUpload({ partnerKey: "Bad Key" }),
    );
    expect(r.ok).toBe(false);
    expect(createPartnerLogoMock).not.toHaveBeenCalled();
  });

  it("rejects empty label", async () => {
    const r = await uploadPartnerLogoAction(fdUpload({ label: "" }));
    expect(r.ok).toBe(false);
  });

  it("rejects unsupported MIME", async () => {
    const r = await uploadPartnerLogoAction(
      fdUpload({ file: makeFile(2048, "application/pdf", "x.pdf") }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/MIME/i);
  });

  it("rejects oversize file (>500 KB)", async () => {
    const big = makeFile(600 * 1024, "image/png");
    const r = await uploadPartnerLogoAction(fdUpload({ file: big }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/i);
  });

  it("rejects empty file", async () => {
    const empty = makeFile(0, "image/png");
    const r = await uploadPartnerLogoAction(fdUpload({ file: empty }));
    expect(r.ok).toBe(false);
  });

  it("rejects under-sized image", async () => {
    sharpMetadataMock.mockResolvedValueOnce({ width: 200, height: 100 });
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/600.*300/);
      expect(r.actualDimensions).toEqual({ w: 200, h: 100 });
    }
  });

  it("rejects oversized image", async () => {
    sharpMetadataMock.mockResolvedValueOnce({ width: 1200, height: 600 });
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.actualDimensions).toEqual({ w: 1200, h: 600 });
  });

  it("accepts on-tolerance image (660 × 270)", async () => {
    sharpMetadataMock.mockResolvedValueOnce({ width: 660, height: 270 });
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(true);
    expect(createPartnerLogoMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses dimension check for SVG", async () => {
    // SVG path skips sharp probe entirely; dimensions default to 600×300.
    const svg = makeFile(2048, "image/svg+xml", "x.svg");
    const r = await uploadPartnerLogoAction(fdUpload({ file: svg }));
    expect(r.ok).toBe(true);
    expect(sharpDefaultMock).not.toHaveBeenCalled();
    expect(createPartnerLogoMock).toHaveBeenCalledTimes(1);
    const callInput = createPartnerLogoMock.mock.calls[0][2];
    expect(callInput).toMatchObject({
      partnerKey: "newpartner",
      dimensionWPx: 600,
      dimensionHPx: 300,
    });
  });

  it("rejects when actor lacks overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(false);
    expect(createPartnerLogoMock).not.toHaveBeenCalled();
  });

  it("propagates rate_limited", async () => {
    enforceAuthedWriteMock.mockResolvedValueOnce(true);
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rate_limited/);
  });

  it("returns ok + URL on success and revalidates", async () => {
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.partnerKey).toBe("newpartner");
      expect(r.fileUrl).toContain("supabase.local");
    }
    expect(storageUploadMock).toHaveBeenCalledTimes(1);
    expect(createPartnerLogoMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/design",
    );
  });

  it("surfaces storage upload errors", async () => {
    storageUploadMock.mockResolvedValueOnce({
      data: null,
      error: { message: "bucket full" },
    });
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/bucket full/);
    expect(createPartnerLogoMock).not.toHaveBeenCalled();
  });
});

describe("removePartnerLogoAction (Wave 2 Stage 3)", () => {
  it("rejects bad partnerKey", async () => {
    const fd = new FormData();
    fd.set("partnerKey", "Bad Key");
    await expect(removePartnerLogoAction(fd)).rejects.toThrow();
    expect(deletePartnerLogoMock).not.toHaveBeenCalled();
  });

  it("rejects when actor lacks perm", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    const fd = new FormData();
    fd.set("partnerKey", "gameevo");
    await expect(removePartnerLogoAction(fd)).rejects.toThrow(
      /Forbidden|overlay\.design\.manage/,
    );
  });

  it("delegates to deletePartnerLogo on success", async () => {
    const fd = new FormData();
    fd.set("partnerKey", "gameevo");
    await removePartnerLogoAction(fd);
    expect(deletePartnerLogoMock).toHaveBeenCalledTimes(1);
    expect(deletePartnerLogoMock.mock.calls[0][2]).toBe("gameevo");
    expect(revalidateMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/design",
    );
  });
});

describe("setLogoOverrideAction (Wave 2 Stage 3)", () => {
  function fdOverride(
    overrides: Partial<{
      overlayKey: string;
      variantId: string;
      partnerKey: string;
      visible: string;
      sortOverride: string;
    }> = {},
  ): FormData {
    const fd = new FormData();
    fd.set("overlayKey", overrides.overlayKey ?? "01-brb");
    fd.set("variantId", overrides.variantId ?? "default");
    fd.set("partnerKey", overrides.partnerKey ?? "gameevo");
    fd.set("visible", overrides.visible ?? "true");
    if (overrides.sortOverride != null) {
      fd.set("sortOverride", overrides.sortOverride);
    }
    return fd;
  }

  it("rejects unknown overlayKey", async () => {
    await expect(
      setLogoOverrideAction(fdOverride({ overlayKey: "not-a-real-key" })),
    ).rejects.toThrow();
  });

  it("rejects bad partnerKey", async () => {
    await expect(
      setLogoOverrideAction(fdOverride({ partnerKey: "Bad Key" })),
    ).rejects.toThrow();
  });

  it("rejects sortOverride out of range", async () => {
    await expect(
      setLogoOverrideAction(fdOverride({ sortOverride: "1500" })),
    ).rejects.toThrow();
  });

  it("upserts override (visible=false) on success", async () => {
    await setLogoOverrideAction(fdOverride({ visible: "false" }));
    expect(setLogoOverrideMock).toHaveBeenCalledTimes(1);
    const callInput = setLogoOverrideMock.mock.calls[0][2];
    expect(callInput).toMatchObject({
      overlayKey: "01-brb",
      variantId: "default",
      partnerKey: "gameevo",
      visible: false,
      sortOverride: null,
    });
    expect(revalidateMock).toHaveBeenCalledWith("/overlay/v2/01-brb", "page");
  });

  it("accepts numeric sortOverride", async () => {
    await setLogoOverrideAction(fdOverride({ sortOverride: "3" }));
    const callInput = setLogoOverrideMock.mock.calls[0][2];
    expect(callInput).toMatchObject({ sortOverride: 3 });
  });

  it("rejects when actor lacks perm", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    await expect(setLogoOverrideAction(fdOverride())).rejects.toThrow(
      /Forbidden|overlay\.design\.manage/,
    );
  });
});
