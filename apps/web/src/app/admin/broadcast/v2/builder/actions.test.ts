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
  mockAddSceneCrud,
  mockUpdateScenes,
  mockDeleteSceneCrud,
  mockAddElementCrud,
  mockUpdateElements,
  mockDeleteElementCrud,
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
  mockAddSceneCrud: vi.fn(),
  mockUpdateScenes: vi.fn(),
  mockDeleteSceneCrud: vi.fn(),
  mockAddElementCrud: vi.fn(),
  mockUpdateElements: vi.fn(),
  mockDeleteElementCrud: vi.fn(),
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
  addScene: mockAddSceneCrud,
  updateScenes: mockUpdateScenes,
  deleteScene: mockDeleteSceneCrud,
  // Other scene CRUD entrypoints unused by saveDesignAction but imported
  // by other actions in the same file — surface harmless no-ops.
  updateScene: vi.fn(),
  reorderScenes: vi.fn(),
  cloneScene: vi.fn(),
}));
vi.mock("@/server/overlays/builder/elements", () => ({
  addElement: mockAddElementCrud,
  updateElements: mockUpdateElements,
  deleteElement: mockDeleteElementCrud,
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

/**
 * Build a tiny query-builder stub that supports the .from().select()
 * .eq()/.in()/.is() chain `saveDesignAction` uses to list existing
 * scenes + elements. Returns `Promise<{ data, error }>` shapes for the
 * `await` site at the end of each chain.
 *
 * `rowsByTable` lets each test override the rows returned per table —
 * default empty array. Useful for asserting INSERT / UPDATE / DELETE
 * fan-out in the save flow.
 */
function makeServiceSb(rowsByTable: Record<string, Array<Record<string, unknown>>> = {}) {
  function builder(table: string) {
    const rows = rowsByTable[table] ?? [];
    const promise = Promise.resolve({ data: rows, error: null });
    const proxy = {
      select: () => proxy,
      eq: () => proxy,
      in: () => proxy,
      is: () => proxy,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: promise.then.bind(promise) as Promise<unknown>["then"],
    };
    return proxy;
  }
  return { from: builder } as unknown as { from: (t: string) => unknown };
}

const goodGate = (rowsByTable: Record<string, Array<Record<string, unknown>>> = {}) => {
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
  mockGetServiceRoleSupabase.mockReturnValue(makeServiceSb(rowsByTable));
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
    // Seed the service-role mock with the existing scene so the diff
    // resolves it as "in DB" and routes through updateScenes.
    goodGate({ overlay_user_design_scenes: [{ id: "s-1" }] });
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

  it("INSERTs payload elements that are not in DB (Bug 4 fix)", async () => {
    // Existing scene in DB but NO elements. Payload carries one new
    // element — it must be routed to addElement, not updateElements.
    goodGate({
      overlay_user_design_scenes: [{ id: "s-1" }],
      overlay_user_design_elements: [],
    });
    mockSnapshotDesign.mockResolvedValue({ id: "snap-1" });
    mockUpdateDesign.mockResolvedValue(undefined);
    mockUpdateScenes.mockResolvedValue([]);
    mockUpdateElements.mockResolvedValue([]);
    mockAddElementCrud.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });

    const newElementJson = JSON.stringify({
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
          elements: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              element_type: "rect",
              z_index: 0,
              locked: false,
              visible: true,
              transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
              style: { fill: "#6bcd06" },
              content: {},
              binding: null,
              animation: null,
            },
          ],
        },
      ],
    });
    const fd = makeFD({ designId: "d-1", design: newElementJson });
    await saveDesignAction(fd);
    expect(mockAddElementCrud).toHaveBeenCalledTimes(1);
    expect(mockAddElementCrud).toHaveBeenCalledWith(
      expect.anything(),
      "s-1",
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        elementType: "rect",
        parentGroupId: null,
      }),
    );
    // Existing-elements update path must NOT swallow the new element.
    expect(mockUpdateElements).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "d-1",
      [], // empty — the only payload element is brand new.
    );
  });

  it("UPDATEs payload elements already present in DB", async () => {
    goodGate({
      overlay_user_design_scenes: [{ id: "s-1" }],
      overlay_user_design_elements: [{ id: "22222222-2222-4222-8222-222222222222" }],
    });
    mockSnapshotDesign.mockResolvedValue({ id: "snap-1" });
    mockUpdateDesign.mockResolvedValue(undefined);
    mockUpdateScenes.mockResolvedValue([]);
    mockUpdateElements.mockResolvedValue([]);
    const existingElementJson = JSON.stringify({
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
          elements: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              element_type: "rect",
              z_index: 0,
              locked: false,
              visible: true,
              transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
              style: { fill: "#fe036d" },
              content: {},
              binding: null,
              animation: null,
            },
          ],
        },
      ],
    });
    const fd = makeFD({ designId: "d-1", design: existingElementJson });
    await saveDesignAction(fd);
    expect(mockAddElementCrud).not.toHaveBeenCalled();
    expect(mockUpdateElements).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "d-1",
      expect.arrayContaining([
        expect.objectContaining({ id: "22222222-2222-4222-8222-222222222222" }),
      ]),
    );
  });

  it("soft-DELETEs elements removed from payload", async () => {
    goodGate({
      overlay_user_design_scenes: [{ id: "s-1" }],
      overlay_user_design_elements: [
        { id: "22222222-2222-4222-8222-222222222222" },
        { id: "33333333-3333-4333-8333-333333333333" },
      ],
    });
    mockSnapshotDesign.mockResolvedValue({ id: "snap-1" });
    mockUpdateDesign.mockResolvedValue(undefined);
    mockUpdateScenes.mockResolvedValue([]);
    mockUpdateElements.mockResolvedValue([]);
    mockDeleteElementCrud.mockResolvedValue(undefined);
    // Payload only carries one of the two DB rows — the other must be
    // soft-deleted.
    const trimmedJson = JSON.stringify({
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
          elements: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              element_type: "rect",
              z_index: 0,
              locked: false,
              visible: true,
              transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
              style: {},
              content: {},
              binding: null,
              animation: null,
            },
          ],
        },
      ],
    });
    const fd = makeFD({ designId: "d-1", design: trimmedJson });
    await saveDesignAction(fd);
    expect(mockDeleteElementCrud).toHaveBeenCalledWith(
      expect.anything(),
      "33333333-3333-4333-8333-333333333333",
    );
    expect(mockDeleteElementCrud).not.toHaveBeenCalledWith(
      expect.anything(),
      "22222222-2222-4222-8222-222222222222",
    );
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
