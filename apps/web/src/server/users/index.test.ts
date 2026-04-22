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
  PermissionError: class PermissionError extends Error {},
}));

import {
  createUser,
  updateUser,
  resetUserPassword,
  softDeleteUser,
  restoreUser,
} from "./index";

beforeEach(() => {
  permAllow.value = true;
});

type Call = {
  table?: string;
  op: string;
  body?: unknown;
  where?: Record<string, unknown>;
};

function chain(table: string, calls: Call[], handlers: {
  selectResult?: { data: unknown; error: unknown };
  insertResult?: { data?: unknown; error: unknown };
  updateResult?: { error: unknown };
  upsertResult?: { error: unknown };
} = {}) {
  const where: Record<string, unknown> = {};

  const selectChain = {
    eq(col: string, val: unknown) {
      where[col] = val;
      return selectChain;
    },
    is(col: string, val: unknown) {
      where[col] = val;
      return selectChain;
    },
    maybeSingle() {
      calls.push({ table, op: "select", where: { ...where } });
      return Promise.resolve(
        handlers.selectResult ?? { data: null, error: null },
      );
    },
    single() {
      calls.push({ table, op: "select", where: { ...where } });
      return Promise.resolve(
        handlers.selectResult ?? { data: null, error: null },
      );
    },
  };

  return {
    select: () => selectChain,
    insert: (body: unknown) => {
      calls.push({ table, op: "insert", body });
      return Promise.resolve(
        handlers.insertResult ?? { error: null },
      );
    },
    upsert: (body: unknown) => {
      calls.push({ table, op: "upsert", body });
      return Promise.resolve(
        handlers.upsertResult ?? { error: null },
      );
    },
    update: (body: unknown) => {
      const where2: Record<string, unknown> = {};
      const term = {
        eq(col: string, val: unknown) {
          where2[col] = val;
          return termAfterEq;
        },
      };
      const termAfterEq = {
        eq(col: string, val: unknown) {
          where2[col] = val;
          return termAfterEq;
        },
        is(col: string, val: unknown) {
          where2[col] = val;
          calls.push({ table, op: "update", body, where: where2 });
          return Promise.resolve(handlers.updateResult ?? { error: null });
        },
        then(cb: (v: unknown) => unknown) {
          calls.push({ table, op: "update", body, where: where2 });
          return cb(handlers.updateResult ?? { error: null });
        },
      };
      return term;
    },
  };
}

function mkSb(opts: {
  // Mirror lookup result for createUser path: returns {id} after auth create.
  mirroredUserId?: string;
  // Result of users.select (single) by id (for resetUserPassword).
  userSelectResult?: { data: unknown; error: unknown };
  // Result of players.select (used by updateUser).
  playersSelectResult?: { data: unknown; error: unknown };
  // auth.admin handlers.
  authCreate?: ReturnType<typeof vi.fn>;
  authUpdate?: ReturnType<typeof vi.fn>;
} = {}) {
  const calls: Call[] = [];

  const tableHandlers: Record<
    string,
    { selectResult?: { data: unknown; error: unknown } }
  > = {};

  if (opts.mirroredUserId) {
    tableHandlers.users_first_lookup = {
      selectResult: {
        data: { id: opts.mirroredUserId },
        error: null,
      },
    };
  }

  let usersSelectsSeen = 0;

  const from = vi.fn((table: string) => {
    if (table === "users") {
      usersSelectsSeen += 1;
      const sel =
        opts.mirroredUserId && usersSelectsSeen === 1
          ? {
              data: { id: opts.mirroredUserId },
              error: null,
            }
          : opts.userSelectResult ?? { data: null, error: null };
      return chain(table, calls, { selectResult: sel });
    }
    if (table === "players") {
      return chain(table, calls, {
        selectResult: opts.playersSelectResult ?? {
          data: null,
          error: null,
        },
      });
    }
    return chain(table, calls);
  });

  const auth = {
    admin: {
      createUser:
        opts.authCreate ??
        vi.fn(async () => ({
          data: {
            user: { id: "auth-uid-1", email: "x@y.z" },
          },
          error: null,
        })),
      updateUserById:
        opts.authUpdate ??
        vi.fn(async () => ({ data: {}, error: null })),
    },
  };

  return {
    sb: { from, auth } as unknown as Parameters<typeof createUser>[0],
    calls,
    auth,
  };
}

const adminActor = { userId: "admin-id", roles: ["admin"] };

describe("createUser", () => {
  it("requires users.create perm", async () => {
    permAllow.value = false;
    const { sb } = mkSb({ mirroredUserId: "u-1" });
    await expect(
      createUser(sb, adminActor, {
        email: "a@b.co",
        displayName: "A",
      }),
    ).rejects.toThrow(/missing permission/);
  });

  it("calls auth.admin.createUser with email_confirm=true", async () => {
    const { sb, auth } = mkSb({ mirroredUserId: "u-1" });
    await createUser(sb, adminActor, {
      email: "new@cade.local",
      displayName: "Newbie",
    });
    expect(auth.admin.createUser).toHaveBeenCalledWith({
      email: "new@cade.local",
      password: expect.any(String),
      email_confirm: true,
    });
  });

  it("auto-generates a random password when password missing (Plan 39)", async () => {
    const { sb, auth } = mkSb({ mirroredUserId: "u-1" });
    const created = await createUser(sb, adminActor, {
      email: "new@cade.local",
      displayName: "Newbie",
    });
    const args = (auth.admin.createUser as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // Never the old hardcoded value.
    expect(args.password).not.toBe("dev-temp-2026");
    // base64url, comfortably long.
    expect(args.password).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(args.password.length).toBeGreaterThanOrEqual(12);
    // The generated password is surfaced ONCE in the response so the UI
    // can show a one-time flash.
    expect(created.usedGeneratedPassword).toBe(true);
    expect(created.generatedPassword).toBe(args.password);
  });

  it("does NOT surface a generated password when admin supplies one", async () => {
    const { sb } = mkSb({ mirroredUserId: "u-1" });
    const created = await createUser(sb, adminActor, {
      email: "new@cade.local",
      displayName: "Newbie",
      password: "supersecret-value-from-admin",
    });
    expect(created.usedGeneratedPassword).toBe(false);
    expect(created.generatedPassword).toBeNull();
  });

  it("updates display_name on the mirrored row", async () => {
    const { sb, calls } = mkSb({ mirroredUserId: "u-1" });
    await createUser(sb, adminActor, {
      email: "new@cade.local",
      displayName: "Real Name",
    });
    const upd = calls.find(
      (c) => c.table === "users" && c.op === "update",
    );
    expect(upd).toBeTruthy();
    expect((upd!.body as { display_name?: string }).display_name).toBe(
      "Real Name",
    );
    expect(upd!.where).toMatchObject({ id: "u-1" });
  });

  it("inserts a players row when gamerTag or jersey provided", async () => {
    const { sb, calls } = mkSb({ mirroredUserId: "u-1" });
    await createUser(sb, adminActor, {
      email: "new@cade.local",
      displayName: "Real Name",
      gamerTag: "RN",
      jerseyNumber: 7,
    });
    const ins = calls.find(
      (c) => c.table === "players" && c.op === "insert",
    );
    expect(ins).toBeTruthy();
    expect(ins!.body).toMatchObject({
      user_id: "u-1",
      gamer_tag: "RN",
      jersey_number: 7,
    });
  });

  it("upserts user_roles for every supplied role", async () => {
    const { sb, calls } = mkSb({ mirroredUserId: "u-1" });
    await createUser(sb, adminActor, {
      email: "new@cade.local",
      displayName: "Real Name",
      roles: ["player", "moderator"],
    });
    const ups = calls.find(
      (c) => c.table === "user_roles" && c.op === "upsert",
    );
    expect(ups).toBeTruthy();
    expect(ups!.body).toEqual([
      expect.objectContaining({ user_id: "u-1", role: "player" }),
      expect.objectContaining({ user_id: "u-1", role: "moderator" }),
    ]);
  });

  it("propagates auth.admin.createUser errors", async () => {
    const { sb } = mkSb({
      mirroredUserId: "u-1",
      authCreate: vi.fn(async () => ({
        data: null,
        error: { message: "email already exists" },
      })),
    });
    await expect(
      createUser(sb, adminActor, {
        email: "dup@cade.local",
        displayName: "Dup",
      }),
    ).rejects.toThrow(/email already exists/);
  });
});

describe("updateUser", () => {
  it("requires users.edit perm", async () => {
    permAllow.value = false;
    const { sb } = mkSb();
    await expect(
      updateUser(sb, adminActor, {
        id: "11111111-1111-4111-8111-111111111111",
        displayName: "X",
      }),
    ).rejects.toThrow(/missing permission/);
  });

  it("writes only the supplied fields on users", async () => {
    const { sb, calls } = mkSb();
    await updateUser(sb, adminActor, {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Updated",
    });
    const upd = calls.find(
      (c) => c.table === "users" && c.op === "update",
    );
    expect(upd).toBeTruthy();
    const body = upd!.body as Record<string, unknown>;
    expect(body.display_name).toBe("Updated");
    // Did not write gamer_tag or jersey on users.
    expect(body.gamer_tag).toBeUndefined();
    expect(body.jersey_number).toBeUndefined();
  });

  it("updates the existing players row when gamer_tag changes", async () => {
    const { sb, calls } = mkSb({
      playersSelectResult: { data: { id: "p-1" }, error: null },
    });
    await updateUser(sb, adminActor, {
      id: "11111111-1111-4111-8111-111111111111",
      gamerTag: "NewTag",
    });
    const upd = calls.find(
      (c) => c.table === "players" && c.op === "update",
    );
    expect(upd).toBeTruthy();
    expect((upd!.body as { gamer_tag?: string }).gamer_tag).toBe("NewTag");
    expect(upd!.where).toMatchObject({ id: "p-1" });
  });
});

describe("resetUserPassword", () => {
  it("requires users.edit perm", async () => {
    permAllow.value = false;
    const { sb } = mkSb();
    await expect(
      resetUserPassword(sb, adminActor, {
        id: "11111111-1111-4111-8111-111111111111",
        newPassword: "abcd1234",
      }),
    ).rejects.toThrow(/missing permission/);
  });

  it("calls auth.admin.updateUserById with the new password", async () => {
    const { sb, auth } = mkSb({
      userSelectResult: {
        data: { supabase_auth_id: "auth-uid-9" },
        error: null,
      },
    });
    await resetUserPassword(sb, adminActor, {
      id: "11111111-1111-4111-8111-111111111111",
      newPassword: "abcd1234",
    });
    expect(auth.admin.updateUserById).toHaveBeenCalledWith("auth-uid-9", {
      password: "abcd1234",
    });
  });
});

describe("softDeleteUser", () => {
  it("requires users.delete perm", async () => {
    permAllow.value = false;
    const { sb } = mkSb();
    await expect(
      softDeleteUser(sb, adminActor, {
        id: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toThrow(/missing permission/);
  });

  it("sets deleted_at on users + user_roles + players", async () => {
    const { sb, calls } = mkSb();
    await softDeleteUser(sb, adminActor, {
      id: "11111111-1111-4111-8111-111111111111",
    });
    const userUpd = calls.find(
      (c) => c.table === "users" && c.op === "update",
    );
    const rolesUpd = calls.find(
      (c) => c.table === "user_roles" && c.op === "update",
    );
    const playersUpd = calls.find(
      (c) => c.table === "players" && c.op === "update",
    );
    expect(userUpd).toBeTruthy();
    expect(rolesUpd).toBeTruthy();
    expect(playersUpd).toBeTruthy();
    for (const c of [userUpd!, rolesUpd!, playersUpd!]) {
      const body = c.body as { deleted_at: string | null };
      expect(body.deleted_at).toBeTruthy();
    }
  });

  it("does NOT touch auth.users", async () => {
    const { sb, auth } = mkSb();
    await softDeleteUser(sb, adminActor, {
      id: "11111111-1111-4111-8111-111111111111",
    });
    // No deleteUser method should ever be called.
    expect(
      (auth.admin as unknown as Record<string, unknown>).deleteUser,
    ).toBeUndefined();
  });
});

describe("restoreUser", () => {
  it("clears deleted_at on users", async () => {
    const { sb, calls } = mkSb();
    await restoreUser(sb, adminActor, {
      id: "11111111-1111-4111-8111-111111111111",
    });
    const upd = calls.find(
      (c) => c.table === "users" && c.op === "update",
    );
    expect(upd).toBeTruthy();
    expect((upd!.body as { deleted_at: string | null }).deleted_at).toBeNull();
  });
});
