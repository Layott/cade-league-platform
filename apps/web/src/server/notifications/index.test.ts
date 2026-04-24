import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmailMock = vi.fn();
vi.mock("@/lib/email/resend", () => ({
  sendEmail: (opts: unknown) => sendEmailMock(opts),
}));

const getServiceRoleSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: () => getServiceRoleSupabaseMock(),
}));

import {
  notify,
  markRead,
  markAllRead,
  listForUser,
  unreadCount,
} from "./index";

type InsertedRow = { id: string };

function mkInsertOnlySb(insertedId = "n-1") {
  const chain = {
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: insertedId } satisfies InsertedRow,
          error: null,
        }),
      })),
    })),
  };
  return {
    from: vi.fn(() => chain),
  };
}

function mkInsertFailSb() {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi
            .fn()
            .mockResolvedValue({ data: null, error: { message: "boom" } }),
        })),
      })),
    })),
  };
}

/**
 * Build a service-role sb that exposes:
 *   - .from('users').select(...).eq(...).is(...).maybeSingle()
 *   - .from('notifications').update(...).eq(...)
 * Returns the internal recorders so tests can assert.
 */
function mkServiceSb(opts: {
  userRow?: { email: string | null; display_name: string | null } | null;
}) {
  const updatePatches: Array<Record<string, unknown>> = [];
  const tables: Record<string, unknown> = {};

  tables.users = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: opts.userRow ?? null, error: null }),
        })),
      })),
    })),
  };

  tables.notifications = {
    update: vi.fn((patch: Record<string, unknown>) => {
      updatePatches.push(patch);
      return {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
    }),
  };

  const sb = {
    _updatePatches: updatePatches,
    from: vi.fn((t: string) => {
      const table = tables[t];
      if (!table) throw new Error(`unexpected table ${t}`);
      return table as Record<string, unknown>;
    }),
  };
  return sb;
}

beforeEach(() => {
  sendEmailMock.mockReset();
  getServiceRoleSupabaseMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("notify()", () => {
  it("inserts the row with the provided kind, title, body, href, metadata", async () => {
    const insertSpy = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: "new-1" }, error: null }),
      })),
    }));
    const sb = { from: vi.fn(() => ({ insert: insertSpy })) };

    // No email fan-out — service-role client returns no user.
    getServiceRoleSupabaseMock.mockReturnValue(
      mkServiceSb({ userRow: { email: null, display_name: null } }),
    );

    await notify(sb as never, {
      userId: "u-1",
      kind: "dispute_ruled",
      title: "Your dispute was ruled",
      body: "Ruling: upheld.",
      href: "/player/disputes/d-1",
      metadata: { disputeId: "d-1" },
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      user_id: "u-1",
      type: "dispute_ruled",
      title: "Your dispute was ruled",
      body: "Ruling: upheld.",
      href: "/player/disputes/d-1",
      metadata: { disputeId: "d-1" },
      announcement_id: null,
    });
    expect(payload.delivered_channels).toEqual(["in_app"]);
  });

  it("throws when the insert fails", async () => {
    const sb = mkInsertFailSb();
    await expect(
      notify(sb as never, {
        userId: "u-1",
        kind: "generic",
        title: "x",
      }),
    ).rejects.toThrow(/notify insert failed/);
  });

  it("fires sendEmail when the user has an email on file", async () => {
    const sb = mkInsertOnlySb("n-7");
    const svcSb = mkServiceSb({
      userRow: { email: "p1@cade.local", display_name: "Player One" },
    });
    getServiceRoleSupabaseMock.mockReturnValue(svcSb);
    sendEmailMock.mockResolvedValue(true);

    await notify(sb as never, {
      userId: "u-1",
      kind: "appeal_ruled",
      title: "Your appeal was ruled",
      body: "Appeal upheld. Linked sanctions auto-revoked.",
      href: "/player/appeals/a-1",
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const args = sendEmailMock.mock.calls[0]?.[0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(args.to).toBe("p1@cade.local");
    expect(args.subject).toBe("Your appeal was ruled");
    expect(args.html).toContain("Your appeal was ruled");
    expect(args.html).toContain("View details");
    expect(args.text).toContain("/player/appeals/a-1");

    // email_sent_at stamp + delivered_channels update issued.
    expect(svcSb._updatePatches.length).toBe(1);
    const patch = svcSb._updatePatches[0] as Record<string, unknown>;
    expect(patch.email_sent_at).toBeTypeOf("string");
    expect(patch.delivered_channels).toEqual(["in_app", "email"]);
  });

  it("skips email send when user has no email on file", async () => {
    const sb = mkInsertOnlySb();
    getServiceRoleSupabaseMock.mockReturnValue(
      mkServiceSb({ userRow: { email: null, display_name: null } }),
    );

    await notify(sb as never, {
      userId: "u-1",
      kind: "squad_approved",
      title: "Squad approved",
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does NOT throw when sendEmail returns false (email failure leaves in-app intact)", async () => {
    const sb = mkInsertOnlySb();
    const svcSb = mkServiceSb({
      userRow: { email: "p@cade.local", display_name: "P" },
    });
    getServiceRoleSupabaseMock.mockReturnValue(svcSb);
    sendEmailMock.mockResolvedValue(false);

    await expect(
      notify(sb as never, {
        userId: "u-1",
        kind: "punishment_issued",
        title: "Punishment issued",
      }),
    ).resolves.toBeUndefined();

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    // No email_sent_at stamp issued.
    expect(svcSb._updatePatches.length).toBe(0);
  });

  it("swallows sendEmail exceptions instead of bubbling to caller", async () => {
    const sb = mkInsertOnlySb();
    const svcSb = mkServiceSb({
      userRow: { email: "p@cade.local", display_name: "P" },
    });
    getServiceRoleSupabaseMock.mockReturnValue(svcSb);
    sendEmailMock.mockRejectedValue(new Error("smtp down"));

    // Silence the expected console.error.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      notify(sb as never, {
        userId: "u-1",
        kind: "match_voided",
        title: "A match was voided",
      }),
    ).resolves.toBeUndefined();
    errSpy.mockRestore();
  });

  it("honors sendEmail: false to suppress the email channel", async () => {
    const sb = mkInsertOnlySb();
    getServiceRoleSupabaseMock.mockReturnValue(
      mkServiceSb({
        userRow: { email: "p@cade.local", display_name: "P" },
      }),
    );

    await notify(sb as never, {
      userId: "u-1",
      kind: "generic",
      title: "silent",
      sendEmail: false,
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("markRead()", () => {
  it("no-ops for an empty id list", async () => {
    const sb = { from: vi.fn() };
    await markRead(sb as never, "u-1", []);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("issues a single UPDATE scoped to user_id + unread rows", async () => {
    const filters: Array<{ op: string; args: unknown[] }> = [];
    const thenable: Record<string, unknown> = {};
    const record = (op: string) => (...args: unknown[]) => {
      filters.push({ op, args });
      return thenable;
    };
    thenable.in = vi.fn(record("in"));
    thenable.eq = vi.fn(record("eq"));
    thenable.is = vi.fn(record("is"));
    thenable.then = (resolve: (v: { error: null }) => unknown) =>
      resolve({ error: null });

    const patches: Array<Record<string, unknown>> = [];
    const sb = {
      from: vi.fn(() => ({
        update: vi.fn((patch: Record<string, unknown>) => {
          patches.push(patch);
          return thenable;
        }),
      })),
    };

    await markRead(sb as never, "u-42", ["n-1", "n-2"]);

    expect(patches.length).toBe(1);
    expect(patches[0]?.read_at).toBeTypeOf("string");
    const byOp = (op: string) => filters.filter((f) => f.op === op);
    expect(byOp("in")[0]?.args).toEqual(["id", ["n-1", "n-2"]]);
    expect(byOp("eq")[0]?.args).toEqual(["user_id", "u-42"]);
    expect(byOp("is")[0]?.args).toEqual(["read_at", null]);
  });
});

describe("markAllRead()", () => {
  it("updates every unread row owned by the user", async () => {
    const filters: Array<{ op: string; args: unknown[] }> = [];
    const thenable: Record<string, unknown> = {};
    const record = (op: string) => (...args: unknown[]) => {
      filters.push({ op, args });
      return thenable;
    };
    thenable.eq = vi.fn(record("eq"));
    thenable.is = vi.fn(record("is"));
    thenable.then = (resolve: (v: { error: null }) => unknown) =>
      resolve({ error: null });

    const patches: Array<Record<string, unknown>> = [];
    const sb = {
      from: vi.fn(() => ({
        update: vi.fn((patch: Record<string, unknown>) => {
          patches.push(patch);
          return thenable;
        }),
      })),
    };

    await markAllRead(sb as never, "u-7");
    expect(patches.length).toBe(1);
    const isKeys = filters.filter((f) => f.op === "is").map((f) => f.args[0]);
    expect(isKeys).toContain("read_at");
    expect(isKeys).toContain("deleted_at");
  });
});

describe("listForUser()", () => {
  function mkListSb(rows: unknown[], unreadOnly = false) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => {
      if (unreadOnly) return chain;
      return Promise.resolve({ data: rows, error: null });
    });
    chain.then = undefined;
    if (unreadOnly) {
      // .limit() returns chain, then caller calls .is('read_at', null) then awaits.
      chain.is = vi.fn(() => Promise.resolve({ data: rows, error: null }));
    }
    return { from: vi.fn(() => chain) };
  }

  it("returns rows with announcement-style body_md resolution for type='announcement'", async () => {
    const rows = [
      {
        id: "n-1",
        user_id: "u",
        type: "announcement",
        title: null,
        body: null,
        href: null,
        metadata: {},
        delivered_channels: ["in_app"],
        email_sent_at: null,
        read_at: null,
        created_at: "2026-04-24T10:00:00Z",
        announcement: { title: "Hello", body_md: "# Hi" },
      },
      {
        id: "n-2",
        user_id: "u",
        type: "dispute_ruled",
        title: "Your dispute was ruled",
        body: "Upheld",
        href: "/player/disputes/d",
        metadata: { disputeId: "d" },
        delivered_channels: ["in_app", "email"],
        email_sent_at: "2026-04-24T10:00:10Z",
        read_at: null,
        created_at: "2026-04-24T10:00:05Z",
        announcement: null,
      },
    ];
    const sb = mkListSb(rows);
    const out = await listForUser(sb as never, "u");
    expect(out[0]).toMatchObject({
      id: "n-1",
      type: "announcement",
      title: "Hello",
      body: "# Hi",
    });
    expect(out[1]).toMatchObject({
      id: "n-2",
      type: "dispute_ruled",
      title: "Your dispute was ruled",
      body: "Upheld",
      href: "/player/disputes/d",
    });
  });

  it("applies default limit of 50 and respects override", async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    const limitMock = vi.fn(() =>
      Promise.resolve({ data: [], error: null }),
    );
    chain.limit = limitMock;
    const sb = { from: vi.fn(() => chain) };

    await listForUser(sb as never, "u");
    expect(limitMock).toHaveBeenLastCalledWith(50);

    await listForUser(sb as never, "u", { limit: 10 });
    expect(limitMock).toHaveBeenLastCalledWith(10);
  });
});

describe("unreadCount()", () => {
  /**
   * Builds a thenable chain where `.eq()` and `.is()` both return a shared
   * self-referential mock; the terminal await happens when the caller stops
   * chaining. Matches how the real Supabase JS client resolves.
   */
  function mkCountSb(count: number | null) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    (chain as { then: unknown }).then = (
      resolve: (v: { count: number | null; error: null }) => unknown,
    ) => resolve({ count, error: null });
    return { from: vi.fn(() => chain) };
  }

  it("returns the partial-index count", async () => {
    const sb = mkCountSb(3);
    const n = await unreadCount(sb as never, "u-1");
    expect(n).toBe(3);
  });

  it("returns 0 for a null count (no rows)", async () => {
    const sb = mkCountSb(null);
    const n = await unreadCount(sb as never, "u-1");
    expect(n).toBe(0);
  });
});
