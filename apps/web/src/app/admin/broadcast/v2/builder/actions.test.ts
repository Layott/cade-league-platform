import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock every external boundary so the test exercises only the action
// handlers' control flow: arg parsing, perm gate, calls into server module.
// vi.mock calls are hoisted — use vi.hoisted() so mocks are available at
// factory call time.

const {
  mockGetServerSupabase,
  mockGetServiceRoleSupabase,
  mockRequirePermAsync,
  mockEnforceAuthedWrite,
  mockCreateDesign,
  mockUpdateDesign,
  mockPublishDesign,
  mockUnpublishDesign,
  mockSoftDeleteDesign,
  mockSnapshotDesign,
  mockUpdateScenes,
  mockUpdateElements,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockGetServerSupabase: vi.fn(),
  mockGetServiceRoleSupabase: vi.fn(),
  mockRequirePermAsync: vi.fn(),
  mockEnforceAuthedWrite: vi.fn(),
  mockCreateDesign: vi.fn(),
  mockUpdateDesign: vi.fn(),
  mockPublishDesign: vi.fn(),
  mockUnpublishDesign: vi.fn(),
  mockSoftDeleteDesign: vi.fn(),
  mockSnapshotDesign: vi.fn(),
  mockUpdateScenes: vi.fn(),
  mockUpdateElements: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: mockGetServerSupabase }));
vi.mock("@/lib/supabase/service", () => ({ getServiceRoleSupabase: mockGetServiceRoleSupabase }));
vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: mockRequirePermAsync,
  PermissionError: class PermissionError extends Error {},
}));
vi.mock("@/lib/api-rate-limit", () => ({ enforceAuthedWrite: mockEnforceAuthedWrite }));
vi.mock("@/server/overlays/builder/designs", () => ({
  createDesign: mockCreateDesign,
  updateDesign: mockUpdateDesign,
  publishDesign: mockPublishDesign,
  unpublishDesign: mockUnpublishDesign,
  softDeleteDesign: mockSoftDeleteDesign,
}));
vi.mock("@/server/overlays/builder/history", () => ({
  snapshotDesign: mockSnapshotDesign,
}));
vi.mock("@/server/overlays/builder/scenes", () => ({
  updateScenes: mockUpdateScenes,
}));
vi.mock("@/server/overlays/builder/elements", () => ({
  updateElements: mockUpdateElements,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import {
  createDesignAction,
  saveDesignAction,
  publishDesignAction,
  unpublishDesignAction,
  softDeleteDesignAction,
} from "./actions";

function makeFD(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

const goodGate = () => {
  mockGetServerSupabase.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "auth-1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { id: "pub-1" } }),
          is: () => Promise.resolve({ data: [{ role: "admin" }] }),
        }),
      }),
    }),
  });
  mockGetServiceRoleSupabase.mockReturnValue({ __mock: "service-role" });
  mockRequirePermAsync.mockResolvedValue(undefined);
  mockEnforceAuthedWrite.mockResolvedValue(null);
};

beforeEach(() => {
  vi.clearAllMocks();
  goodGate();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("createDesignAction", () => {
  it("validates title + mode and calls createDesign", async () => {
    mockCreateDesign.mockResolvedValue({ id: "d-1", slug: "my-design" });
    const fd = makeFD({ title: "My Design", mode: "single" });
    const result = await createDesignAction(fd);
    expect(mockRequirePermAsync).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "pub-1", roles: ["admin"] },
      "overlay.design.manage",
    );
    expect(mockEnforceAuthedWrite).toHaveBeenCalledWith("pub-1");
    expect(mockCreateDesign).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "pub-1", roles: ["admin"] },
      expect.objectContaining({ title: "My Design", mode: "single" }),
    );
    expect(result).toEqual({ id: "d-1", slug: "my-design" });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/broadcast/v2/builder");
  });

  it("rejects invalid mode", async () => {
    const fd = makeFD({ title: "X", mode: "lol" });
    await expect(createDesignAction(fd)).rejects.toThrow(/mode/);
    expect(mockCreateDesign).not.toHaveBeenCalled();
  });

  it("rejects missing title", async () => {
    const fd = makeFD({ mode: "single" });
    await expect(createDesignAction(fd)).rejects.toThrow(/title/);
    expect(mockCreateDesign).not.toHaveBeenCalled();
  });
});

describe("saveDesignAction", () => {
  const validDesignJson = JSON.stringify({
    id: "d-1",
    slug: "my-design",
    title: "My Design",
    description: null,
    mode: "single",
    status: "draft",
    canvas_width: 1920,
    canvas_height: 1080,
    scenes: [
      {
        id: "s-1",
        order_index: 0,
        name: "main",
        duration_ms: 5000,
        transition_in: "fade",
        transition_out: "fade",
        elements: [],
      },
    ],
  });

  it("snapshots first, then updates scenes + elements", async () => {
    mockSnapshotDesign.mockResolvedValue({ id: "snap-1" });
    mockUpdateDesign.mockResolvedValue(undefined);
    mockUpdateScenes.mockResolvedValue([]);
    mockUpdateElements.mockResolvedValue([]);
    const fd = makeFD({ designId: "d-1", design: validDesignJson });
    await saveDesignAction(fd);
    expect(mockSnapshotDesign).toHaveBeenCalledBefore(
      mockUpdateScenes as unknown as ReturnType<typeof vi.fn>,
    );
    expect(mockUpdateScenes).toHaveBeenCalled();
    expect(mockUpdateElements).toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/broadcast/v2/builder");
  });

  it("rejects malformed JSON", async () => {
    const fd = makeFD({ designId: "d-1", design: "{not json" });
    await expect(saveDesignAction(fd)).rejects.toThrow(/JSON/);
  });

  it("rejects when zod parse fails", async () => {
    const fd = makeFD({
      designId: "d-1",
      design: JSON.stringify({ id: "d-1", title: "X" }), // missing required fields
    });
    await expect(saveDesignAction(fd)).rejects.toThrow();
  });
});

describe("publishDesignAction", () => {
  it("calls publishDesign with id", async () => {
    mockPublishDesign.mockResolvedValue(undefined);
    await publishDesignAction("d-1");
    expect(mockPublishDesign).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "pub-1", roles: ["admin"] },
      "d-1",
    );
  });
});

describe("unpublishDesignAction", () => {
  it("calls unpublishDesign with id", async () => {
    mockUnpublishDesign.mockResolvedValue(undefined);
    await unpublishDesignAction("d-1");
    expect(mockUnpublishDesign).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "pub-1", roles: ["admin"] },
      "d-1",
    );
  });
});

describe("softDeleteDesignAction", () => {
  it("calls softDeleteDesign with id", async () => {
    mockSoftDeleteDesign.mockResolvedValue(undefined);
    await softDeleteDesignAction("d-1");
    expect(mockSoftDeleteDesign).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "pub-1", roles: ["admin"] },
      "d-1",
    );
  });
});

describe("perm gate", () => {
  it("throws when permission denied", async () => {
    const { PermissionError } = await import("@/lib/perms-db");
    mockRequirePermAsync.mockRejectedValueOnce(new PermissionError("nope"));
    const fd = makeFD({ title: "X", mode: "single" });
    await expect(createDesignAction(fd)).rejects.toThrow(/Forbidden/);
  });

  it("throws when rate limited", async () => {
    mockEnforceAuthedWrite.mockResolvedValueOnce({ status: 429 });
    const fd = makeFD({ title: "X", mode: "single" });
    await expect(createDesignAction(fd)).rejects.toThrow(/rate_limited/);
  });
});
