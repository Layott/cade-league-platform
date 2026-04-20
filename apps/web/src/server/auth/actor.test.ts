import { describe, it, expect, vi, beforeEach } from "vitest";
import { getActorFromSession } from "./actor";

type SbUser = { id: string } | null;
type RoleRow = { role: string };

function mockSupabase(user: SbUser, roles: RoleRow[]) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: user ? { id: user.id } : null },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ data: roles, error: null }),
        })),
      })),
    })),
  };
}

describe("getActorFromSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when not authenticated", async () => {
    const sb = mockSupabase(null, []);
    const actor = await getActorFromSession(sb as never);
    expect(actor).toBeNull();
  });

  it("returns actor with userId + roles when authenticated", async () => {
    const sb = mockSupabase({ id: "auth-123" }, [{ role: "admin" }, { role: "player" }]);
    const actor = await getActorFromSession(sb as never, { userId: "pub-456" });
    expect(actor).toEqual({ userId: "pub-456", roles: ["admin", "player"] });
  });
});
