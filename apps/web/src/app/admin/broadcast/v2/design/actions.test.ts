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

/**
 * Service-client `.from()` mock. Wave 2 Stage 3 actions use the SELECT-
 * then-INSERT-or-UPDATE pattern directly against the client because the
 * partner tables have partial unique indexes that don't work with
 * Supabase JS upsert. We therefore have to fake the chained query
 * builders for each of: maybeSingle (SELECT), insert, update.
 */
type FakeQuery = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const fromMaybeSingleMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: null, error: null }),
);
const fromInsertMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: null, error: null }),
);
const fromUpdateMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: null, error: null }),
);
const fromMock = vi.hoisted(() => {
  return vi.fn(() => {
    const q: FakeQuery = {
      select: vi.fn().mockReturnThis() as unknown as FakeQuery["select"],
      eq: vi.fn().mockReturnThis() as unknown as FakeQuery["eq"],
      is: vi.fn().mockReturnThis() as unknown as FakeQuery["is"],
      maybeSingle: fromMaybeSingleMock,
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };
    // Make insert + update reroute through the shared mocks so tests
    // can introspect them.
    q.insert = vi.fn((_row: unknown) => fromInsertMock());
    q.update = vi.fn((_row: unknown) => ({
      eq: vi.fn().mockReturnValue(fromUpdateMock()),
    })) as unknown as FakeQuery["update"];
    return q;
  });
});

vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: () => ({
    storage: { from: storageFromMock },
    from: fromMock,
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
  // Mirror the runtime allowlist + helper exports so the action
  // module's `import { TEXT_KINDS } from ...` resolves under vitest's
  // module mock. Kept in sync with `TEXT_KINDS` in
  // apps/web/src/server/overlays/text/elements.ts (any drift here will
  // surface as a fresh test failure rather than a silent regression).
  TEXT_KINDS: [
    "heading",
    "subheading",
    "eyebrow",
    "title",
    "subtitle",
    "caption",
    "number",
    "label",
    "body",
    "image",
    "layout",
    "text",
    "score-number",
    "player-name",
    "player-photo",
    "player-box",
    "sponsor-logo-strip",
    "sponsor-logo-floating",
    "partner-strip-container",
    "bg-image",
    "bg-vignette",
    "box",
  ],
  isValidTextKind: (v: unknown) =>
    typeof v === "string" &&
    [
      "heading",
      "subheading",
      "eyebrow",
      "title",
      "subtitle",
      "caption",
      "number",
      "label",
      "body",
      "image",
      "layout",
      "text",
      "score-number",
      "player-name",
      "player-photo",
      "player-box",
      "sponsor-logo-strip",
      "sponsor-logo-floating",
      "partner-strip-container",
      "bg-image",
      "bg-vignette",
      "box",
    ].includes(v),
}));

// Wave 2 Stage 3 — partner-logo CRUD mocks. (Strip-layout + logo
// override write paths now go through the action layer's own SELECT-
// then-INSERT-or-UPDATE pattern instead of the server-module wrappers
// because the partial unique index makes ON CONFLICT inference fail —
// see the JSDoc on setStripLayoutAction.)
const createPartnerLogoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "row-1", partnerKey: "p" }),
);
const deletePartnerLogoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
vi.mock("@/server/overlays/partners/logos", () => ({
  createPartnerLogo: createPartnerLogoMock,
  deletePartnerLogo: deletePartnerLogoMock,
}));

// Wave 2 Stage 4 — animation mocks. `setAnimationAction` writes
// directly via the shared service-role `fromMock` (SELECT-then-
// INSERT-or-UPDATE pattern from b7b3deff — Supabase JS .upsert()
// throws PG 42P10 against the partial unique index). Only
// `deleteAnimation` is still routed through the server module
// (clearAnimationAction).
const deleteAnimationMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
vi.mock("@/server/overlays/animations/elements", () => ({
  deleteAnimation: deleteAnimationMock,
}));

// `sharp` mock — partner-logo upload runs uploads through
// `processImage`, which delegates to sharp under the hood. We mock
// `processImage` directly below so this `sharp` mock is now only a
// safety net (any code path that still imports sharp at module load
// gets a no-op).
const sharpMetadataMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ width: 600, height: 300 }),
);
const sharpDefaultMock = vi.hoisted(() => {
  return vi.fn(() => ({
    metadata: sharpMetadataMock,
  }));
});
vi.mock("sharp", () => ({ default: sharpDefaultMock }));

// 2026-05-01 — partner-logo upload now ALWAYS resizes raster inputs
// via processImage (no dimension validation). Mock returns a small
// fake PNG buffer so the storage upload path stays exercised.
const processImageMock = vi.hoisted(() =>
  vi.fn(async (_buf: Buffer) => Buffer.from("fake-png-bytes")),
);
const recipeForMock = vi.hoisted(() =>
  vi.fn((useCase: string) => {
    if (useCase === "partner-strip") {
      return { w: 600, h: 300, fit: "contain", bg: { r: 0, g: 0, b: 0, alpha: 0 } };
    }
    if (useCase === "org-logo") {
      return { w: 800, h: 800, fit: "contain", bg: { r: 0, g: 0, b: 0, alpha: 0 } };
    }
    return { w: 512, h: 512, fit: "cover", bg: { r: 0, g: 0, b: 0, alpha: 0 } };
  }),
);
vi.mock("@/lib/image-processing", () => ({
  processImage: processImageMock,
  recipeFor: recipeForMock,
}));

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
  setAnimationAction,
  clearAnimationAction,
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
  createPartnerLogoMock.mockReset().mockResolvedValue({
    id: "row-1",
    partnerKey: "p",
  });
  deletePartnerLogoMock.mockReset().mockResolvedValue(undefined);
  sharpMetadataMock.mockReset().mockResolvedValue({ width: 600, height: 300 });
  sharpDefaultMock.mockClear();
  processImageMock
    .mockReset()
    .mockImplementation(async () => Buffer.from("fake-png-bytes"));
  recipeForMock.mockClear();
  storageUploadMock.mockReset().mockResolvedValue({ data: {}, error: null });
  storagePublicUrlMock.mockReset().mockReturnValue({
    data: { publicUrl: "https://supabase.local/partner-logos/test.png" },
  });
  storageFromMock.mockClear();
  fromMock.mockClear();
  fromMaybeSingleMock.mockReset().mockResolvedValue({
    data: null,
    error: null,
  });
  fromInsertMock.mockReset().mockResolvedValue({ data: null, error: null });
  fromUpdateMock.mockReset().mockResolvedValue({ data: null, error: null });
  deleteAnimationMock.mockReset().mockResolvedValue(undefined);
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
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects unknown overlayKey", async () => {
    await expect(
      setStripLayoutAction(fdLayout("not-a-real-key")),
    ).rejects.toThrow();
    expect(fromInsertMock).not.toHaveBeenCalled();
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

  it("INSERTs when no row exists + revalidates", async () => {
    fromMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    await setStripLayoutAction(
      fdLayout("01-brb", {
        anchor: "top-right",
        positionXPx: "1820",
        positionYPx: "100",
        scalePct: "150",
      }),
    );
    expect(fromInsertMock).toHaveBeenCalledTimes(1);
    expect(fromUpdateMock).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/design",
    );
    expect(revalidateMock).toHaveBeenCalledWith("/overlay/v2/01-brb", "page");
  });

  it("UPDATEs when an existing row is found", async () => {
    fromMaybeSingleMock.mockResolvedValueOnce({
      data: { id: "row-1" },
      error: null,
    });
    await setStripLayoutAction(fdLayout("01-brb", { anchor: "top-left" }));
    expect(fromUpdateMock).toHaveBeenCalledTimes(1);
    expect(fromInsertMock).not.toHaveBeenCalled();
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

  it("auto-resizes under-sized raster (was rejection pre-2026-05-01)", async () => {
    // Even tiny inputs now succeed because processImage upscales /
    // letterboxes to the recipe target (600×300). The DB row records
    // the SHIPPED dimensions, not the raw input dimensions.
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(true);
    expect(processImageMock).toHaveBeenCalledTimes(1);
    expect(processImageMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      "partner-strip",
    );
    const callInput = createPartnerLogoMock.mock.calls[0][2];
    expect(callInput).toMatchObject({
      partnerKey: "newpartner",
      dimensionWPx: 600,
      dimensionHPx: 300,
    });
  });

  it("auto-resizes oversized raster (was rejection pre-2026-05-01)", async () => {
    // 1200×600 input — pre-2026-05-01 this rejected with `actualDimensions`;
    // post-fix we letterbox via processImage and ship at 600×300.
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(true);
    expect(processImageMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      "partner-strip",
    );
  });

  it("uploads PNG buffer + content-type after processing raster", async () => {
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(true);
    expect(storageUploadMock).toHaveBeenCalledTimes(1);
    const uploadCall = storageUploadMock.mock.calls[0];
    // (filename, buffer, opts) — opts.contentType should be image/png
    expect(uploadCall[2]).toMatchObject({ contentType: "image/png" });
    // filename suffix flips to .png even for image/jpeg input.
    expect(uploadCall[0]).toMatch(/\.png$/);
  });

  it("bypasses processImage for SVG (vector preserved)", async () => {
    const svg = makeFile(2048, "image/svg+xml", "x.svg");
    const r = await uploadPartnerLogoAction(fdUpload({ file: svg }));
    expect(r.ok).toBe(true);
    // SVG path skips processImage entirely.
    expect(processImageMock).not.toHaveBeenCalled();
    expect(createPartnerLogoMock).toHaveBeenCalledTimes(1);
    const callInput = createPartnerLogoMock.mock.calls[0][2];
    expect(callInput).toMatchObject({
      partnerKey: "newpartner",
      dimensionWPx: 600,
      dimensionHPx: 300,
    });
    // Storage upload for SVG keeps original content-type + .svg ext.
    const uploadCall = storageUploadMock.mock.calls[0];
    expect(uploadCall[2]).toMatchObject({ contentType: "image/svg+xml" });
    expect(uploadCall[0]).toMatch(/\.svg$/);
  });

  it("surfaces processImage failures", async () => {
    processImageMock.mockRejectedValueOnce(new Error("sharp blew up"));
    const r = await uploadPartnerLogoAction(fdUpload());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/image processing failed/i);
    expect(storageUploadMock).not.toHaveBeenCalled();
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

  it("INSERTs override (visible=false) when no row exists + revalidates", async () => {
    fromMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    await setLogoOverrideAction(fdOverride({ visible: "false" }));
    expect(fromInsertMock).toHaveBeenCalledTimes(1);
    expect(fromUpdateMock).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/overlay/v2/01-brb", "page");
  });

  it("UPDATEs when override row exists", async () => {
    fromMaybeSingleMock.mockResolvedValueOnce({
      data: { id: "row-1" },
      error: null,
    });
    await setLogoOverrideAction(fdOverride({ visible: "false" }));
    expect(fromUpdateMock).toHaveBeenCalledTimes(1);
    expect(fromInsertMock).not.toHaveBeenCalled();
  });

  it("accepts numeric sortOverride", async () => {
    fromMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    await setLogoOverrideAction(fdOverride({ sortOverride: "3" }));
    expect(fromInsertMock).toHaveBeenCalledTimes(1);
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

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 4 — animation actions                                 *
 * ------------------------------------------------------------------ */

function fdAnim(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("overlayKey", "07-leaderboard");
  fd.set("variantId", "default");
  fd.set("elementId", "title");
  fd.set("animPhase", "entry");
  fd.set("enabled", "true");
  fd.set("animType", "slide-left");
  fd.set("durationMs", "420");
  fd.set("delayMs", "60");
  fd.set("easing", "cubic-bezier(0.16,1,0.3,1)");
  fd.set("iterationCount", "1");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function fdClearAnim(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("overlayKey", "07-leaderboard");
  fd.set("variantId", "default");
  fd.set("elementId", "title");
  fd.set("animPhase", "entry");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

describe("setAnimationAction (Wave 2 Stage 4)", () => {
  it("rejects when actor lacks overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    await expect(setAnimationAction(fdAnim())).rejects.toThrow(
      /Forbidden|overlay\.design\.manage/,
    );
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects unknown overlayKey", async () => {
    await expect(
      setAnimationAction(fdAnim({ overlayKey: "not-a-real-key" })),
    ).rejects.toThrow();
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects invalid elementId (not kebab-case)", async () => {
    await expect(
      setAnimationAction(fdAnim({ elementId: "Bad_Id" })),
    ).rejects.toThrow();
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects invalid anim_phase enum", async () => {
    await expect(
      setAnimationAction(fdAnim({ animPhase: "spinning" })),
    ).rejects.toThrow();
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects unknown anim_type", async () => {
    await expect(
      setAnimationAction(fdAnim({ animType: "explode" })),
    ).rejects.toThrow();
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects durationMs out of range", async () => {
    await expect(
      setAnimationAction(fdAnim({ durationMs: "10000" })),
    ).rejects.toThrow();
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects delayMs out of range", async () => {
    await expect(
      setAnimationAction(fdAnim({ delayMs: "-1" })),
    ).rejects.toThrow();
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("inserts a new row on the happy path when none exists", async () => {
    fromMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    await setAnimationAction(fdAnim());
    expect(fromInsertMock).toHaveBeenCalledTimes(1);
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("updates an existing row when one is found", async () => {
    fromMaybeSingleMock.mockResolvedValueOnce({
      data: { id: "anim-existing" },
      error: null,
    });
    await setAnimationAction(fdAnim());
    expect(fromUpdateMock).toHaveBeenCalledTimes(1);
    expect(fromInsertMock).not.toHaveBeenCalled();
  });

  it("inserts on happy path with sanitized customCssKeyframes for custom-css", async () => {
    fromMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    await setAnimationAction(
      fdAnim({
        animType: "custom-css",
        customCssKeyframes: "0% { opacity: 0 } 100% { opacity: 1 }",
      }),
    );
    expect(fromInsertMock).toHaveBeenCalledTimes(1);
  });

  it("rejects custom-css with empty / missing customCssKeyframes payload", async () => {
    await expect(
      setAnimationAction(
        fdAnim({
          animType: "custom-css",
          // No customCssKeyframes field at all → fdAnim drops to undefined.
        }),
      ),
    ).rejects.toThrow(/custom-css.*requires customCssKeyframes/i);
    expect(fromInsertMock).not.toHaveBeenCalled();
  });

  it("drops customCssKeyframes payload for non-custom anim types (still inserts)", async () => {
    fromMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    await setAnimationAction(
      fdAnim({
        animType: "fade",
        customCssKeyframes: "0% { opacity: 0 }",
      }),
    );
    expect(fromInsertMock).toHaveBeenCalledTimes(1);
  });

  it("rate-limited request throws rate_limited", async () => {
    enforceAuthedWriteMock.mockResolvedValueOnce(true);
    await expect(setAnimationAction(fdAnim())).rejects.toThrow(/rate_limited/);
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects custom-css with forbidden url() construct via sanitizer", async () => {
    await expect(
      setAnimationAction(
        fdAnim({
          animType: "custom-css",
          customCssKeyframes: "0% { background: url(http://attacker/x.gif) }",
        }),
      ),
    ).rejects.toThrow(/sanitize failed/);
    expect(fromInsertMock).not.toHaveBeenCalled();
    expect(fromUpdateMock).not.toHaveBeenCalled();
  });
});

describe("clearAnimationAction (Wave 2 Stage 4)", () => {
  it("rejects when actor lacks overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new FakePermissionError("missing permission: overlay.design.manage"),
    );
    await expect(clearAnimationAction(fdClearAnim())).rejects.toThrow(
      /Forbidden|overlay\.design\.manage/,
    );
    expect(deleteAnimationMock).not.toHaveBeenCalled();
  });

  it("rejects bad elementId", async () => {
    await expect(
      clearAnimationAction(fdClearAnim({ elementId: "Bad" })),
    ).rejects.toThrow();
    expect(deleteAnimationMock).not.toHaveBeenCalled();
  });

  it("rejects bad anim_phase", async () => {
    await expect(
      clearAnimationAction(fdClearAnim({ animPhase: "spinning" })),
    ).rejects.toThrow();
    expect(deleteAnimationMock).not.toHaveBeenCalled();
  });

  it("calls deleteAnimation on the happy path", async () => {
    await clearAnimationAction(fdClearAnim());
    expect(deleteAnimationMock).toHaveBeenCalledTimes(1);
    const call = deleteAnimationMock.mock.calls[0];
    // (sb, actor, overlayKey, variantId, elementId, phase)
    expect(call[2]).toBe("07-leaderboard");
    expect(call[3]).toBe("default");
    expect(call[4]).toBe("title");
    expect(call[5]).toBe("entry");
  });
});
