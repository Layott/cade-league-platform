import { describe, expect, it, vi, beforeEach } from "vitest";

// Module-level mocks for the dependencies the actions call.
const requirePermAsyncMock = vi.fn();
const enforceAuthedWriteMock = vi.fn();
const getServerSupabaseMock = vi.fn();
const getServiceRoleSupabaseMock = vi.fn();
const revalidatePathMock = vi.fn();

const addSceneMock = vi.fn();
const updateSceneMock = vi.fn();
const reorderScenesMock = vi.fn();
const deleteSceneMock = vi.fn();
const cloneSceneMock = vi.fn();

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: (...args: unknown[]) => requirePermAsyncMock(...args),
  PermissionError: class PermissionError extends Error {},
}));
vi.mock("@/lib/api-rate-limit", () => ({
  enforceAuthedWrite: (...args: unknown[]) => enforceAuthedWriteMock(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: () => getServerSupabaseMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: () => getServiceRoleSupabaseMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/server/overlays/builder/scenes", () => ({
  addScene: (...args: unknown[]) => addSceneMock(...args),
  updateScene: (...args: unknown[]) => updateSceneMock(...args),
  reorderScenes: (...args: unknown[]) => reorderScenesMock(...args),
  deleteScene: (...args: unknown[]) => deleteSceneMock(...args),
  cloneScene: (...args: unknown[]) => cloneSceneMock(...args),
}));

import {
  addSceneAction,
  updateSceneAction,
  reorderScenesAction,
  deleteSceneAction,
  cloneSceneAction,
} from "./actions";

// Fully mocks the supabase user-client chain that gate() walks:
//   userClient.auth.getUser()
//   userClient.from("users").select("id").eq(...).maybeSingle()
//   userClient.from("user_roles").select("role").eq(...).is(...)
const fakeSb = {
  auth: {
    getUser: async () => ({
      data: { user: { id: "auth-1" } },
      error: null,
    }),
  },
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { id: "user-1" } }),
        is: async () => ({ data: [{ role: "admin" }] }),
      }),
    }),
  }),
};

const fakeServiceSb = { __mock: "service-role" };

describe("scene actions", () => {
  beforeEach(() => {
    requirePermAsyncMock.mockReset().mockResolvedValue(true);
    enforceAuthedWriteMock.mockReset().mockResolvedValue(null);
    getServerSupabaseMock.mockReset().mockResolvedValue(fakeSb);
    getServiceRoleSupabaseMock.mockReset().mockReturnValue(fakeServiceSb);
    revalidatePathMock.mockReset();
    addSceneMock.mockReset();
    updateSceneMock.mockReset();
    reorderScenesMock.mockReset();
    deleteSceneMock.mockReset();
    cloneSceneMock.mockReset();
  });

  it("addSceneAction gates on perm + rate-limit + calls scenes.addScene", async () => {
    addSceneMock.mockResolvedValueOnce({
      id: "s-new",
      designId: "d-1",
      orderIndex: 1,
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [],
    });
    const result = await addSceneAction({
      designId: "00000000-0000-4000-8000-000000000001",
      designSlug: "test-slug",
      afterOrderIndex: 0,
    });
    expect(requirePermAsyncMock).toHaveBeenCalled();
    expect(enforceAuthedWriteMock).toHaveBeenCalled();
    expect(addSceneMock).toHaveBeenCalledWith(fakeServiceSb, "00000000-0000-4000-8000-000000000001", expect.objectContaining({ afterOrderIndex: 0 }));
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/admin/broadcast/v2/builder/test-slug/edit",
    );
    expect(result.ok).toBe(true);
    expect(result.scene?.id).toBe("s-new");
  });

  it("updateSceneAction passes patch through", async () => {
    const r = await updateSceneAction({
      sceneId: "00000000-0000-4000-8000-000000000010",
      designSlug: "test-slug",
      patch: { durationMs: 8000, transitionIn: "slide-left" },
    });
    expect(updateSceneMock).toHaveBeenCalledWith(fakeServiceSb, "00000000-0000-4000-8000-000000000010", {
      durationMs: 8000,
      transitionIn: "slide-left",
    });
    expect(r.ok).toBe(true);
  });

  it("reorderScenesAction passes the ordered id list through", async () => {
    const r = await reorderScenesAction({
      designId: "00000000-0000-4000-8000-000000000001",
      designSlug: "test-slug",
      sceneIdOrder: [
        "00000000-0000-4000-8000-000000000010",
        "00000000-0000-4000-8000-000000000011",
        "00000000-0000-4000-8000-000000000012",
      ],
    });
    expect(reorderScenesMock).toHaveBeenCalledWith(
      fakeServiceSb,
      "00000000-0000-4000-8000-000000000001",
      [
        "00000000-0000-4000-8000-000000000010",
        "00000000-0000-4000-8000-000000000011",
        "00000000-0000-4000-8000-000000000012",
      ],
    );
    expect(r.ok).toBe(true);
  });

  it("deleteSceneAction calls scenes.deleteScene", async () => {
    const r = await deleteSceneAction({
      sceneId: "00000000-0000-4000-8000-000000000020",
      designSlug: "test-slug",
    });
    expect(deleteSceneMock).toHaveBeenCalledWith(fakeServiceSb, "00000000-0000-4000-8000-000000000020");
    expect(r.ok).toBe(true);
  });

  it("cloneSceneAction returns the cloned scene", async () => {
    cloneSceneMock.mockResolvedValueOnce({
      id: "s-clone",
      designId: "d-1",
      orderIndex: 3,
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [],
    });
    const r = await cloneSceneAction({
      sceneId: "00000000-0000-4000-8000-000000000010",
      designSlug: "test-slug",
    });
    expect(cloneSceneMock).toHaveBeenCalledWith(fakeServiceSb, "00000000-0000-4000-8000-000000000010");
    expect(r.ok).toBe(true);
    expect(r.scene?.id).toBe("s-clone");
  });

  it("rejects with Forbidden when perm denies", async () => {
    const { PermissionError } = await import("@/lib/perms-db");
    requirePermAsyncMock.mockRejectedValueOnce(
      new PermissionError("denied"),
    );
    await expect(
      addSceneAction({
        designId: "00000000-0000-4000-8000-000000000001",
        designSlug: "test-slug",
        afterOrderIndex: 0,
      }),
    ).rejects.toThrow();
  });

  it("rejects invalid afterOrderIndex (negative beyond -1)", async () => {
    await expect(
      addSceneAction({
        designId: "00000000-0000-4000-8000-000000000001",
        designSlug: "test-slug",
        afterOrderIndex: -5,
      }),
    ).rejects.toThrow(/afterOrderIndex/);
  });

  it("rejects invalid transition in updateSceneAction", async () => {
    await expect(
      updateSceneAction({
        sceneId: "00000000-0000-4000-8000-000000000010",
        designSlug: "test-slug",
        patch: { transitionIn: "warp-speed" as never },
      }),
    ).rejects.toThrow(/transition/);
  });

  it("rejects duration_ms outside [200, 60000]", async () => {
    await expect(
      updateSceneAction({
        sceneId: "00000000-0000-4000-8000-000000000010",
        designSlug: "test-slug",
        patch: { durationMs: 50 },
      }),
    ).rejects.toThrow(/duration/);
  });
});
