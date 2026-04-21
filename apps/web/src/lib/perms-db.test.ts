import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hasPermAsync, requirePermAsync, PermissionError } from "./perms-db";
import { __test as cacheTest } from "@/server/roles/cache";

function mkSb(rowsByRole: Record<string, string[]>) {
  const from = vi.fn((_table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: string) => {
      void col;
      const perms = (rowsByRole[val] ?? []).map((permission) => ({ permission }));
      return Promise.resolve({ data: perms, error: null });
    });
    return chain;
  });
  return { from } as unknown as { from: typeof from };
}

beforeEach(() => {
  cacheTest.clearAll();
});

afterEach(() => {
  cacheTest.clearAll();
});

describe("hasPermAsync", () => {
  it("admin wildcard via DB → grants any action", async () => {
    const sb = mkSb({ admin: ["*"] });
    const ok = await hasPermAsync(
      sb as never,
      { userId: "u", roles: ["admin"] },
      "matches.enter_score",
    );
    expect(ok).toBe(true);
  });

  it("player with matches.read gets matches.read true, users.delete false", async () => {
    const sb = mkSb({ player: ["matches.read", "standings.read"] });
    expect(
      await hasPermAsync(sb as never, { userId: "u", roles: ["player"] }, "matches.read"),
    ).toBe(true);
    expect(
      await hasPermAsync(sb as never, { userId: "u", roles: ["player"] }, "users.delete"),
    ).toBe(false);
  });

  it("viewer with zero DB rows still gets public perms from PUBLIC_PERMS without hitting DB", async () => {
    const sb = mkSb({ viewer: [] });
    // Unauthenticated (no roles) — still has public access via PUBLIC_PERMS.
    expect(
      await hasPermAsync(
        sb as never,
        { userId: null, roles: [] },
        "standings.read.public",
      ),
    ).toBe(true);
    // DB was never queried for that public check.
    expect((sb as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });

  it("empty-role (design) default-denies non-public actions", async () => {
    const sb = mkSb({ design: [] });
    expect(
      await hasPermAsync(
        sb as never,
        { userId: "u", roles: ["design"] },
        "punishments.issue",
      ),
    ).toBe(false);
  });

  it("multi-role actor unions permissions across roles", async () => {
    const sb = mkSb({
      player: ["matches.read"],
      moderator: ["punishments.issue", "attendance.mark"],
    });
    const ok = await hasPermAsync(
      sb as never,
      { userId: "u", roles: ["player", "moderator"] },
      "punishments.issue",
    );
    expect(ok).toBe(true);
  });

  it("cache hit on repeat call — second call does not re-query DB", async () => {
    const sb = mkSb({ admin: ["*"] });
    await hasPermAsync(sb as never, { userId: "u", roles: ["admin"] }, "anything.at.all");
    await hasPermAsync(sb as never, { userId: "u", roles: ["admin"] }, "another.action");
    // One DB fetch total (cached after first call).
    expect((sb as { from: ReturnType<typeof vi.fn> }).from).toHaveBeenCalledTimes(1);
  });
});

describe("requirePermAsync", () => {
  it("throws PermissionError when not permitted", async () => {
    const sb = mkSb({ player: [] });
    await expect(
      requirePermAsync(
        sb as never,
        { userId: "u", roles: ["player"] },
        "punishments.issue",
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("resolves silently when permitted", async () => {
    const sb = mkSb({ admin: ["*"] });
    await expect(
      requirePermAsync(sb as never, { userId: "u", roles: ["admin"] }, "x.y"),
    ).resolves.toBeUndefined();
  });
});
