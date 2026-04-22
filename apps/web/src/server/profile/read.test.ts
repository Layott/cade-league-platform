import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the runtime perm check so tests pivot allow/deny by setting
// `permAllow`. Hoisted so vi.mock can close over it cleanly.
const { permAllow } = vi.hoisted(() => ({ permAllow: { value: true } }));

vi.mock("@/lib/perms-db", () => ({
  hasPermAsync: vi.fn(async () => permAllow.value),
  requirePermAsync: vi.fn(async () => {
    if (!permAllow.value) {
      const e = new Error("missing permission");
      (e as Error & { name: string }).name = "PermissionError";
      throw e;
    }
  }),
  PermissionError: class PermissionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PermissionError";
    }
  },
}));

import { getProfileView, PermissionError } from "./read";

beforeEach(() => {
  permAllow.value = true;
});

type Row = Record<string, unknown> | null;

function mkSb(opts: {
  user?: Row;
  player?: Row;
  roles?: Array<{ role: string }>;
  userErr?: unknown;
  playerErr?: unknown;
  rolesErr?: unknown;
}) {
  const selects: string[] = [];
  const filters: Array<{ table: string; col: string; val: unknown }> = [];

  function makeChain(
    table: string,
    result: { data: unknown; error: unknown },
    opts: { single: boolean },
  ) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn((sel: string) => {
      selects.push(`${table}:${sel}`);
      return chain;
    });
    chain.eq = vi.fn((col: string, val: unknown) => {
      filters.push({ table, col, val });
      return chain;
    });
    chain.is = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve(result));
    // For non-single reads (user_roles) `await chain` should resolve to result.
    if (!opts.single) {
      (chain as unknown as { then: unknown }).then = (
        cb: (v: unknown) => unknown,
      ) => cb(result);
    }
    return chain;
  }

  const from = vi.fn((table: string) => {
    if (table === "users") {
      return makeChain(
        table,
        { data: opts.user ?? null, error: opts.userErr ?? null },
        { single: true },
      );
    }
    if (table === "players") {
      return makeChain(
        table,
        { data: opts.player ?? null, error: opts.playerErr ?? null },
        { single: true },
      );
    }
    if (table === "user_roles") {
      return makeChain(
        table,
        { data: opts.roles ?? [], error: opts.rolesErr ?? null },
        { single: false },
      );
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { sb: { from } as never, selects, filters };
}

describe("getProfileView", () => {
  it("returns full self view when targetUserId omitted", async () => {
    const actor = { userId: "user-self", roles: ["player"] };
    const { sb } = mkSb({
      user: {
        id: "user-self",
        email: "self@cade.local",
        display_name: "Self Player",
      },
      player: {
        gamer_tag: "SELFY",
        jersey_number: 7,
        photo_url: "https://example.com/self.jpg",
        bio: "Striker.",
        organization_id: "org-1",
      },
      roles: [{ role: "player" }, { role: "team_manager" }],
    });

    const view = await getProfileView(sb, actor);

    expect(view).toEqual({
      userId: "user-self",
      displayName: "Self Player",
      email: "self@cade.local",
      photoUrl: "https://example.com/self.jpg",
      bio: "Striker.",
      gamerTag: "SELFY",
      jerseyNumber: 7,
      organizationId: "org-1",
      // Roles returned sorted alphabetically so the UI chips render stable.
      roles: ["player", "team_manager"],
      hasPlayerRow: true,
    });
  });

  it("allows admin to view a different user's profile", async () => {
    permAllow.value = true; // admin wildcard grants users.edit.any
    const actor = { userId: "admin-id", roles: ["admin"] };
    const { sb } = mkSb({
      user: {
        id: "other-id",
        email: "faruk@cade.local",
        display_name: "Faruk",
      },
      player: null, // user without a player row (non-player role)
      roles: [{ role: "moderator" }],
    });

    const view = await getProfileView(sb, actor, "other-id");

    expect(view.userId).toBe("other-id");
    expect(view.displayName).toBe("Faruk");
    expect(view.hasPlayerRow).toBe(false);
    expect(view.photoUrl).toBeNull();
    expect(view.bio).toBeNull();
    expect(view.roles).toEqual(["moderator"]);
  });

  it("throws PermissionError when a non-admin views someone else", async () => {
    permAllow.value = false;
    const actor = { userId: "player-1", roles: ["player"] };
    const { sb } = mkSb({
      user: {
        id: "player-2",
        email: "other@cade.local",
        display_name: "Other",
      },
    });

    await expect(
      getProfileView(sb, actor, "player-2"),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("treats targetUserId === actor.userId as a self view (no perm check)", async () => {
    permAllow.value = false; // would block cross-view, but self is allowed
    const actor = { userId: "user-self", roles: ["player"] };
    const { sb } = mkSb({
      user: {
        id: "user-self",
        email: "self@cade.local",
        display_name: "Self",
      },
      player: null,
      roles: [{ role: "player" }],
    });

    const view = await getProfileView(sb, actor, "user-self");
    expect(view.userId).toBe("user-self");
    expect(view.hasPlayerRow).toBe(false);
  });

  it("rejects unauthenticated actors", async () => {
    const actor = { userId: null, roles: [] };
    const { sb } = mkSb({});
    await expect(getProfileView(sb, actor)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });
});
