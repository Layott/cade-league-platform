import { describe, it, expect, vi } from "vitest";
import { listUsersWithRoles, assignRole, removeRole } from "./users";

function mkListSb(opts: {
  users?: Array<{
    id: string;
    email: string;
    display_name: string | null;
    last_login_at: string | null;
  }>;
  userRoles?: Array<{ user_id: string; role: string }>;
}) {
  const users = opts.users ?? [];
  const userRoles = opts.userRoles ?? [];

  const from = vi.fn((table: string) => {
    if (table === "users") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.is = vi.fn(() => chain);
      chain.order = vi.fn(() => Promise.resolve({ data: users, error: null }));
      return chain;
    }
    if (table === "user_roles") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.is = vi.fn(() =>
        Promise.resolve({ data: userRoles, error: null }),
      );
      chain.in = vi.fn(() => chain);
      return chain;
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { from } as unknown as { from: typeof from };
}

function mkMutSb() {
  const calls: Array<{
    table: string;
    op: string;
    body?: unknown;
    where?: Record<string, unknown>;
  }> = [];

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};

    chain.upsert = vi.fn((body: unknown) => {
      calls.push({ table, op: "upsert", body });
      return Promise.resolve({ error: null });
    });

    chain.insert = vi.fn((body: unknown) => {
      calls.push({ table, op: "insert", body });
      return Promise.resolve({ error: null });
    });

    chain.update = vi.fn((body: unknown) => {
      const where: Record<string, unknown> = {};
      const terminal = {
        eq(col: string, val: unknown) {
          where[col] = val;
          return {
            eq(col2: string, val2: unknown) {
              where[col2] = val2;
              return {
                is(col3: string, val3: unknown) {
                  where[col3] = val3;
                  calls.push({ table, op: "update", body, where });
                  return Promise.resolve({ error: null });
                },
                then(cb: (v: unknown) => unknown) {
                  calls.push({ table, op: "update", body, where });
                  return cb({ error: null });
                },
              };
            },
            is(col2: string, val2: unknown) {
              where[col2] = val2;
              calls.push({ table, op: "update", body, where });
              return Promise.resolve({ error: null });
            },
            then(cb: (v: unknown) => unknown) {
              calls.push({ table, op: "update", body, where });
              return cb({ error: null });
            },
          };
        },
      };
      return terminal;
    });

    return chain;
  });

  return { from, _calls: calls } as unknown as {
    from: typeof from;
    _calls: typeof calls;
  };
}

describe("listUsersWithRoles", () => {
  it("joins users with their roles by user_id", async () => {
    const sb = mkListSb({
      users: [
        {
          id: "u1",
          email: "a@x",
          display_name: "A",
          last_login_at: "2026-04-20T00:00:00Z",
        },
        {
          id: "u2",
          email: "b@x",
          display_name: "B",
          last_login_at: null,
        },
      ],
      userRoles: [
        { user_id: "u1", role: "admin" },
        { user_id: "u1", role: "moderator" },
        { user_id: "u2", role: "player" },
      ],
    });
    const rows = await listUsersWithRoles(sb as never);
    expect(rows.length).toBe(2);
    const a = rows.find((r) => r.id === "u1")!;
    expect(a.roles.sort()).toEqual(["admin", "moderator"]);
    const b = rows.find((r) => r.id === "u2")!;
    expect(b.roles).toEqual(["player"]);
  });
});

describe("assignRole", () => {
  it("upserts a user_roles row (idempotent on re-assign)", async () => {
    const sb = mkMutSb();
    await assignRole(sb as never, { userId: "u1", role: "idc" });
    const c = sb._calls.find(
      (c) => c.table === "user_roles" && c.op === "upsert",
    );
    expect(c).toBeTruthy();
    expect(c!.body).toMatchObject({
      user_id: "u1",
      role: "idc",
      deleted_at: null,
    });
  });
});

describe("removeRole", () => {
  it("soft-deletes the user_roles row (sets deleted_at)", async () => {
    const sb = mkMutSb();
    await removeRole(sb as never, { userId: "u1", role: "moderator" });
    const c = sb._calls.find(
      (c) => c.table === "user_roles" && c.op === "update",
    );
    expect(c).toBeTruthy();
    const body = c!.body as { deleted_at: string | null };
    expect(body.deleted_at).toBeTruthy();
    expect(c!.where).toMatchObject({
      user_id: "u1",
      role: "moderator",
    });
  });
});
