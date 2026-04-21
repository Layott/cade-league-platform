import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock cache so tests can assert invalidate() calls.
const invalidateMock = vi.fn();
vi.mock("./cache", async () => {
  const actual = await vi.importActual<typeof import("./cache")>("./cache");
  return {
    ...actual,
    invalidate: (...args: unknown[]) => invalidateMock(...args),
  };
});

import {
  listAllPermissions,
  listPermissionsForRole,
  togglePermission,
  bulkSaveMatrix,
} from "./permissions";

// Lightweight Supabase fluent-chain mock. Each .from() call returns a chain
// whose terminal methods are configured per-test via the `responses` arg.
function mkSb(config: {
  allPerms?: { permission: string }[];
  roleRows?: { permission: string }[];
  inserts?: Array<{ rows: unknown }>;
  deletes?: Array<{ where: Record<string, unknown> }>;
}) {
  const inserts = config.inserts ?? [];
  const deletes = config.deletes ?? [];
  const allPerms = config.allPerms ?? [];
  const roleRows = config.roleRows ?? [];

  const from = vi.fn((_table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn((cols?: string) => {
      const res = {
        // select().order() — for listAllPermissions
        order: vi.fn(() =>
          Promise.resolve({ data: allPerms, error: null }),
        ),
        // select().eq() — for listPermissionsForRole
        eq: vi.fn(() =>
          Promise.resolve({ data: roleRows, error: null }),
        ),
        // For selects that return the whole data set without filters:
        then: undefined as unknown as never,
      };
      // Some callers might `await sb.from().select()` directly; return a
      // promise-like that resolves to allPerms.
      (res as unknown as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) =>
        cb({ data: allPerms, error: null });
      void cols;
      return res;
    });

    chain.insert = vi.fn((rows: unknown) => {
      inserts.push({ rows });
      return Promise.resolve({ error: null });
    });

    chain.delete = vi.fn(() => {
      const del = {
        eq(col: string, val: unknown) {
          const where: Record<string, unknown> = { [col]: val };
          const deleter = {
            eq(col2: string, val2: unknown) {
              where[col2] = val2;
              deletes.push({ where });
              return Promise.resolve({ error: null });
            },
            in(col2: string, vals: unknown[]) {
              where[col2] = vals;
              deletes.push({ where });
              return Promise.resolve({ error: null });
            },
          };
          return deleter;
        },
      };
      return del;
    });

    chain.upsert = vi.fn((rows: unknown) => {
      inserts.push({ rows });
      return Promise.resolve({ error: null });
    });

    return chain;
  });

  return { from, _inserts: inserts, _deletes: deletes } as unknown as {
    from: ReturnType<typeof vi.fn>;
    _inserts: typeof inserts;
    _deletes: typeof deletes;
  };
}

beforeEach(() => {
  invalidateMock.mockReset();
});

describe("listAllPermissions", () => {
  it("dedupes permission strings across roles", async () => {
    const sb = mkSb({
      allPerms: [
        { permission: "announcements.publish" },
        { permission: "announcements.publish" },
        { permission: "matches.read" },
        { permission: "*" },
      ],
    });
    const rows = await listAllPermissions(sb as never);
    expect(rows.sort()).toEqual(
      ["*", "announcements.publish", "matches.read"].sort(),
    );
  });
});

describe("listPermissionsForRole", () => {
  it("returns array of permission strings for the given role", async () => {
    const sb = mkSb({
      roleRows: [{ permission: "matches.read" }, { permission: "standings.read" }],
    });
    const rows = await listPermissionsForRole(sb as never, "player");
    expect(rows).toEqual(["matches.read", "standings.read"]);
  });
});

describe("togglePermission", () => {
  it("grants a new row and invalidates cache for that role", async () => {
    const sb = mkSb({});
    await togglePermission(sb as never, {
      role: "design",
      permission: "fixtures.export",
      grant: true,
      actorUserId: "u-admin",
    });
    expect(sb._inserts.length).toBe(1);
    expect(sb._inserts[0].rows).toMatchObject({
      role: "design",
      permission: "fixtures.export",
      granted_by: "u-admin",
    });
    expect(invalidateMock).toHaveBeenCalledWith("design");
  });

  it("revokes an existing row and invalidates", async () => {
    const sb = mkSb({});
    await togglePermission(sb as never, {
      role: "moderator",
      permission: "announcements.publish",
      grant: false,
      actorUserId: "u-admin",
    });
    expect(sb._deletes.length).toBe(1);
    expect(sb._deletes[0].where).toMatchObject({
      role: "moderator",
      permission: "announcements.publish",
    });
    expect(invalidateMock).toHaveBeenCalledWith("moderator");
  });

  it("rejects any attempt to delete the admin wildcard row", async () => {
    const sb = mkSb({});
    await expect(
      togglePermission(sb as never, {
        role: "admin",
        permission: "*",
        grant: false,
        actorUserId: "u-admin",
      }),
    ).rejects.toThrow(/admin wildcard is locked/i);
    expect(sb._deletes.length).toBe(0);
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

describe("bulkSaveMatrix", () => {
  it("applies diff: deletes first then inserts, invalidates every affected role", async () => {
    const sb = mkSb({});
    await bulkSaveMatrix(
      sb as never,
      {
        diff: [
          { role: "moderator", permission: "announcements.publish", grant: false },
          { role: "design", permission: "fixtures.export", grant: true },
          { role: "design", permission: "players.read", grant: true },
        ],
      },
      "u-admin",
    );
    expect(sb._deletes.length).toBe(1);
    expect(sb._inserts.length).toBeGreaterThanOrEqual(1);
    // both affected roles invalidated
    expect(invalidateMock).toHaveBeenCalledWith("moderator");
    expect(invalidateMock).toHaveBeenCalledWith("design");
  });

  it("rejects diff that would delete admin wildcard", async () => {
    const sb = mkSb({});
    await expect(
      bulkSaveMatrix(
        sb as never,
        {
          diff: [{ role: "admin", permission: "*", grant: false }],
        },
        "u-admin",
      ),
    ).rejects.toThrow(/admin wildcard is locked/i);
    expect(sb._deletes.length).toBe(0);
  });
});
