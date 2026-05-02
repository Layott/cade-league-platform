import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock `next/cache` BEFORE importing the helper so the import-time
// resolution picks up the mocked binding. Vitest hoists vi.mock() calls
// above imports, so this lands first.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { revalidateSquadSurfaces } from "./revalidate";

describe("revalidateSquadSurfaces", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  it("busts every squad-related surface when given a full input", () => {
    revalidateSquadSurfaces({
      playerId: "player-abc",
      matchDayId: "md-xyz",
      submissionId: "sub-123",
    });

    const calls = vi.mocked(revalidatePath).mock.calls;
    const paths = calls.map((c) => c[0]);
    // Player-facing.
    expect(paths).toContain("/player/squad");
    expect(paths).toContain("/players/player-abc");
    // Admin-facing.
    expect(paths).toContain("/admin/squads");
    expect(paths).toContain("/admin/squads/sub-123");
    // Broadcast preview surfaces.
    expect(paths).toContain("/admin/broadcast/v2");
    expect(paths).toContain("/admin/broadcast/v2/design");
  });

  it("uses 'page' form for player + admin pages", () => {
    revalidateSquadSurfaces({
      playerId: "p1",
      submissionId: "s1",
    });
    const calls = vi.mocked(revalidatePath).mock.calls;
    const playerCall = calls.find((c) => c[0] === "/player/squad");
    expect(playerCall?.[1]).toBe("page");
    const adminListCall = calls.find((c) => c[0] === "/admin/squads");
    expect(adminListCall?.[1]).toBe("page");
    const adminDetailCall = calls.find((c) => c[0] === "/admin/squads/s1");
    expect(adminDetailCall?.[1]).toBe("page");
  });

  it("uses 'layout' form for admin broadcast routes (cache-component subtree)", () => {
    revalidateSquadSurfaces({ playerId: "p1" });
    const calls = vi.mocked(revalidatePath).mock.calls;
    const hubCall = calls.find((c) => c[0] === "/admin/broadcast/v2");
    expect(hubCall?.[1]).toBe("layout");
    const designCall = calls.find(
      (c) => c[0] === "/admin/broadcast/v2/design",
    );
    expect(designCall?.[1]).toBe("layout");
  });

  it("skips the per-detail admin route when no submissionId is supplied", () => {
    revalidateSquadSurfaces({
      playerId: "p1",
      matchDayId: "md-xyz",
      submissionId: null,
    });
    const calls = vi.mocked(revalidatePath).mock.calls;
    const detailCalls = calls.filter((c) =>
      typeof c[0] === "string" && c[0].startsWith("/admin/squads/"),
    );
    expect(detailCalls).toHaveLength(0);
  });

  it("skips the public profile when no playerId is supplied", () => {
    // playerId is required by the type; pass empty string to confirm guard.
    revalidateSquadSurfaces({ playerId: "" });
    const calls = vi.mocked(revalidatePath).mock.calls;
    const profileCalls = calls.filter((c) =>
      typeof c[0] === "string" && c[0].startsWith("/players/"),
    );
    expect(profileCalls).toHaveLength(0);
  });
});
