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

const serviceClientMock = vi.hoisted(() => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: () => serviceClientMock,
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

import {
  saveTokensAction,
  setActiveTemplateAction,
  revertToSnapshotAction,
  setTextElementAction,
  clearTextElementAction,
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
