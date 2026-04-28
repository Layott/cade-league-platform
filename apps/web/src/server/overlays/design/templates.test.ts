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
  listTemplates,
  setActiveTemplate,
  createTemplate,
} from "./templates";

type Row = {
  id: string;
  overlay_key: string;
  variant_id: string;
  label: string;
  description: string | null;
  html_path: string;
  thumbnail_path: string | null;
  active: boolean;
};

const ACTOR = { userId: "u-1", roles: ["admin"] };

const ROW_DEFAULT: Row = {
  id: "tv-1",
  overlay_key: "07-leaderboard",
  variant_id: "default",
  label: "07-leaderboard",
  description: null,
  html_path: "apps/web/public/overlays/v2/07-leaderboard/index.html",
  thumbnail_path: null,
  active: true,
};
const ROW_BOLD: Row = {
  id: "tv-2",
  overlay_key: "07-leaderboard",
  variant_id: "bold",
  label: "Bold",
  description: "High-contrast leaderboard",
  html_path: "apps/web/public/overlays/v2/07-leaderboard/templates/bold/index.html",
  thumbnail_path: null,
  active: false,
};

// ---- listTemplates -------------------------------------------------------

describe("listTemplates", () => {
  it("returns all rows ordered by overlay_key + variant_id", async () => {
    const orderInner = vi.fn().mockReturnThis();
    const orderOuter = vi
      .fn()
      .mockResolvedValue({ data: [ROW_DEFAULT, ROW_BOLD], error: null });
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          is: vi.fn(() => ({
            order: orderInner.mockReturnValue({ order: orderOuter }),
          })),
        })),
      })),
    };
    const out = await listTemplates(sb as never);
    expect(out).toHaveLength(2);
    expect(out[0].variantId).toBe("default");
    expect(out[1].variantId).toBe("bold");
  });

  it("filters by overlayKey when provided", async () => {
    const orderOuter = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [ROW_DEFAULT], error: null }) });
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          is: vi.fn(() => ({
            order: vi.fn(() => ({ order: orderOuter })),
          })),
        })),
      })),
    };
    const out = await listTemplates(sb as never, "07-leaderboard");
    expect(out).toHaveLength(1);
    expect(out[0].overlayKey).toBe("07-leaderboard");
  });

  it("propagates supabase error", async () => {
    const orderOuter = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          is: vi.fn(() => ({
            order: vi.fn(() => ({ order: orderOuter })),
          })),
        })),
      })),
    };
    await expect(listTemplates(sb as never)).rejects.toThrow(/listTemplates: boom/);
  });
});

// ---- setActiveTemplate ---------------------------------------------------

/**
 * Build a Supabase mock for setActiveTemplate.
 *
 * State machine drives both the prior-active SELECT (returns
 * `priorVariantId` or null) and the demote/promote UPDATE chains. Each
 * UPDATE returns the configured error so we can drive the compensating
 * branch.
 */
function mkSetActiveSb(opts: {
  priorVariantId: string | null;
  demoteError?: { message: string } | null;
  promoteError?: { message: string } | null;
}) {
  const priorRow =
    opts.priorVariantId === null ? null : { variant_id: opts.priorVariantId };
  const priorMaybe = vi
    .fn()
    .mockResolvedValue({ data: priorRow, error: null });

  // Both UPDATEs end with .eq().eq().is(); .is is the awaited last call.
  // Build a chain factory that returns three nested .eq calls then .is.
  const makeUpdateChain = (
    returnErr: { message: string } | null | undefined,
  ) => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn().mockResolvedValue({ error: returnErr ?? null }),
      })),
    })),
  });

  let demoteCalls = 0;
  let promoteCalls = 0;

  const sb = {
    from: vi.fn(() => ({
      // SELECT chain for prior-active row.
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({ maybeSingle: priorMaybe })),
          })),
        })),
      })),
      update: vi.fn((payload: { active: boolean }) => {
        if (payload.active === false) {
          demoteCalls += 1;
          return makeUpdateChain(opts.demoteError);
        }
        promoteCalls += 1;
        // Promote chain may run TWICE on compensation: first promote,
        // then if it failed, the compensating re-promote of the prior
        // row. We surface promoteError only on the FIRST promote call;
        // compensation always succeeds.
        const err = promoteCalls === 1 ? opts.promoteError : null;
        return makeUpdateChain(err);
      }),
    })),
    _calls: {
      get demote() {
        return demoteCalls;
      },
      get promote() {
        return promoteCalls;
      },
    },
  };
  return sb;
}

describe("setActiveTemplate", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  it("rejects without overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkSetActiveSb({ priorVariantId: "default" });
    await expect(
      setActiveTemplate(sb as never, ACTOR, "07-leaderboard", "bold"),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });

  it("short-circuits when target variant is already active", async () => {
    const sb = mkSetActiveSb({ priorVariantId: "bold" });
    await setActiveTemplate(sb as never, ACTOR, "07-leaderboard", "bold");
    // Neither demote nor promote should run.
    expect(sb._calls.demote).toBe(0);
    expect(sb._calls.promote).toBe(0);
  });

  it("demotes prior + promotes target on happy path", async () => {
    const sb = mkSetActiveSb({ priorVariantId: "default" });
    await setActiveTemplate(sb as never, ACTOR, "07-leaderboard", "bold");
    expect(sb._calls.demote).toBe(1);
    expect(sb._calls.promote).toBe(1);
  });

  it("skips demote when no prior active row exists", async () => {
    const sb = mkSetActiveSb({ priorVariantId: null });
    await setActiveTemplate(sb as never, ACTOR, "07-leaderboard", "bold");
    expect(sb._calls.demote).toBe(0);
    expect(sb._calls.promote).toBe(1);
  });

  it("compensates by re-promoting the prior row when promote fails", async () => {
    const sb = mkSetActiveSb({
      priorVariantId: "default",
      promoteError: { message: "FK violation" },
    });
    await expect(
      setActiveTemplate(sb as never, ACTOR, "07-leaderboard", "bold"),
    ).rejects.toThrow(/FK violation/);
    // Demote ran once; promote ran twice (initial + compensating re-promote).
    expect(sb._calls.demote).toBe(1);
    expect(sb._calls.promote).toBe(2);
  });
});

// ---- createTemplate ------------------------------------------------------

describe("createTemplate", () => {
  beforeEach(() => requirePermAsyncMock.mockReset().mockResolvedValue(undefined));

  function mkInsertSb(returnRow: Row | null, error?: { message: string }) {
    const single = vi
      .fn()
      .mockResolvedValue({ data: returnRow, error: error ?? null });
    return {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({ single })),
        })),
      })),
    };
  }

  it("inserts new variant with active=false by default", async () => {
    const sb = mkInsertSb(ROW_BOLD);
    const out = await createTemplate(sb as never, ACTOR, {
      overlayKey: "07-leaderboard",
      variantId: "bold",
      label: "Bold",
      description: "High-contrast leaderboard",
      htmlPath:
        "apps/web/public/overlays/v2/07-leaderboard/templates/bold/index.html",
      thumbnailPath: null,
    });
    expect(out.variantId).toBe("bold");
    expect(out.active).toBe(false);
  });

  it("rejects duplicate (overlay_key, variant_id) with a friendly error", async () => {
    const sb = mkInsertSb(null, {
      message: 'duplicate key value violates unique constraint "overlay_template_variants_..."',
    });
    await expect(
      createTemplate(sb as never, ACTOR, {
        overlayKey: "07-leaderboard",
        variantId: "default",
        label: "07-leaderboard",
        description: null,
        htmlPath: "apps/web/public/overlays/v2/07-leaderboard/index.html",
        thumbnailPath: null,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects when actor lacks overlay.design.manage", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: overlay.design.manage"),
    );
    const sb = mkInsertSb(ROW_BOLD);
    await expect(
      createTemplate(sb as never, ACTOR, {
        overlayKey: "07-leaderboard",
        variantId: "bold",
        label: "Bold",
        description: null,
        htmlPath: "x",
        thumbnailPath: null,
      }),
    ).rejects.toThrow(/overlay\.design\.manage/);
  });
});
