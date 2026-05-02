import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendEmail = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/email/resend", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

import {
  recordLogin,
  recordLoginFailure,
  getLockoutInfo,
  clearLockoutForEmail,
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MS,
} from "./sessions";

type Scenario = {
  fingerprintSeenBefore: boolean;
  roles: string[];
  user: { id: string; email: string; display_name: string };
};

function mkSb({ fingerprintSeenBefore, roles, user }: Scenario) {
  const usersBuilder = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: user, error: null }),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
  };

  const userRolesBuilder = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn().mockResolvedValue({
          data: roles.map((r) => ({ role: r })),
          error: null,
        }),
      })),
    })),
  };

  const sessionsBuilder = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({
              data: fingerprintSeenBefore ? [{ id: "prior" }] : [],
              error: null,
            }),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "new-session-1",
            ip_address: "1.1.1.1",
            user_agent: "ua",
            started_at: "2026-04-20T12:00:00Z",
          },
          error: null,
        }),
      })),
    })),
  };

  const authEventsBuilder = {
    insert: vi.fn().mockResolvedValue({ error: null }),
  };

  const from = vi.fn((table: string) => {
    if (table === "users") return usersBuilder;
    if (table === "user_roles") return userRolesBuilder;
    if (table === "sessions") return sessionsBuilder;
    if (table === "auth_events") return authEventsBuilder;
    throw new Error(`unexpected table: ${table}`);
  });

  return { from };
}

describe("recordLogin", () => {
  beforeEach(() => {
    mockSendEmail.mockClear();
  });

  it("creates session + auth_event + does NOT alert when fingerprint seen before", async () => {
    const sb = mkSb({
      fingerprintSeenBefore: true,
      roles: ["admin"],
      user: { id: "pub-1", email: "a@b", display_name: "A" },
    });
    const r = await recordLogin(sb as never, {
      publicUserId: "pub-1",
      ipAddress: "1.1.1.1",
      userAgent: "ua",
      acceptLanguage: "en",
    });
    expect(r.sessionId).toBeTruthy();
    expect(r.isNewDevice).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("alerts admin on new device", async () => {
    const sb = mkSb({
      fingerprintSeenBefore: false,
      roles: ["admin"],
      user: { id: "pub-1", email: "a@b", display_name: "A" },
    });
    const r = await recordLogin(sb as never, {
      publicUserId: "pub-1",
      ipAddress: "1.1.1.1",
      userAgent: "ua",
      acceptLanguage: "en",
    });
    expect(r.isNewDevice).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("does NOT alert non-admin on new device", async () => {
    const sb = mkSb({
      fingerprintSeenBefore: false,
      roles: ["player"],
      user: { id: "pub-1", email: "a@b", display_name: "A" },
    });
    const r = await recordLogin(sb as never, {
      publicUserId: "pub-1",
      ipAddress: "1.1.1.1",
      userAgent: "ua",
      acceptLanguage: "en",
    });
    expect(r.isNewDevice).toBe(true);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Bug 11 (2026-05-01) — lockout helpers                              *
 * ------------------------------------------------------------------ */

/**
 * Helper to build a Supabase mock for the lockout helpers. Drives:
 *   • users → maybeSingle returning the supplied user_id (or null)
 *   • auth_events → SELECT returns N rows ordered by created_at asc
 *   • auth_events → DELETE returns the rows that matched
 *   • auth_events → INSERT no-ops (used by recordLoginFailure)
 *
 * The SELECT and DELETE chains are distinguished by their first
 * verb — `.select(...)` vs `.delete()`. We return a single chainable
 * proxy object whose terminal method (`.order(...)` for SELECT,
 * `.select(...)` for DELETE) resolves to the appropriate fixture.
 */
function mkLockSb(opts: {
  userId: string | null;
  failureRows?: Array<{ created_at: string }>;
  deleteIds?: Array<{ id: string }>;
  insertCalls?: Array<unknown>;
}) {
  const usersBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({
        data: opts.userId ? { id: opts.userId } : null,
        error: null,
      }),
  };
  const insertCalls = opts.insertCalls ?? [];

  function makeAuthEventsChain() {
    type Mode = "select-read" | "delete";
    let mode: Mode = "select-read";
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    chain.select = (col?: unknown) => {
      // First .select() call switches into SELECT-read mode.
      // After a .delete() call, .select(...) is the TERMINAL of the
      // delete chain and must resolve to the deleted-ids fixture.
      if (mode === "delete") {
        return Promise.resolve({
          data: opts.deleteIds ?? [],
          error: null,
        });
      }
      void col;
      return chain;
    };
    chain.eq = () => chain;
    chain.gte = () => chain;
    chain.delete = () => {
      mode = "delete";
      return chain;
    };
    chain.order = () =>
      Promise.resolve({
        data: opts.failureRows ?? [],
        error: null,
      });
    chain.insert = (row: unknown) => {
      insertCalls.push(row);
      return Promise.resolve({ data: null, error: null });
    };
    return chain;
  }

  const from = vi.fn((table: string) => {
    if (table === "users") return usersBuilder;
    if (table === "auth_events") {
      // Each .from("auth_events") returns a fresh chain so SELECT and
      // DELETE callers get independent state. (getLockoutInfo +
      // clearLockoutForEmail do exactly one .from() each.)
      return makeAuthEventsChain();
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    sb: { from } as unknown as Parameters<typeof getLockoutInfo>[0],
    insertCalls,
  };
}

describe("recordLoginFailure", () => {
  it("normalizes email (trim + lowercase) before lookup AND insert", async () => {
    const { sb, insertCalls } = mkLockSb({ userId: "pub-1" });
    await recordLoginFailure(sb, "  Mixed.Case@CADE.local  ", "bad pwd");
    expect(insertCalls).toHaveLength(1);
    const row = insertCalls[0] as {
      user_id: string;
      event_type: string;
      metadata: { email: string; reason: string };
    };
    expect(row.user_id).toBe("pub-1");
    expect(row.event_type).toBe("login_failed");
    expect(row.metadata.email).toBe("mixed.case@cade.local");
    expect(row.metadata.reason).toBe("bad pwd");
  });

  it("inserts row with NULL user_id when email does not resolve", async () => {
    const { sb, insertCalls } = mkLockSb({ userId: null });
    await recordLoginFailure(sb, "ghost@nowhere.test", "bad pwd");
    expect(insertCalls).toHaveLength(1);
    const row = insertCalls[0] as { user_id: string | null };
    expect(row.user_id).toBeNull();
  });
});

describe("getLockoutInfo", () => {
  it("returns NOT locked when count < threshold (4 attempts is fine)", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 4 }).map((_, i) => ({
      created_at: new Date(now - 30_000 - i * 1000).toISOString(),
    }));
    const { sb } = mkLockSb({ userId: "pub-1", failureRows: rows });
    const info = await getLockoutInfo(sb, "p@x");
    expect(info.locked).toBe(false);
    expect(info.attemptsInWindow).toBe(4);
    expect(info.msRemaining).toBe(0);
  });

  it("returns NOT locked at exactly the threshold (5 attempts is warning, not lock)", async () => {
    const now = Date.now();
    const rows = Array.from({ length: LOCKOUT_THRESHOLD }).map((_, i) => ({
      created_at: new Date(now - 30_000 - i * 1000).toISOString(),
    }));
    const { sb } = mkLockSb({ userId: "pub-1", failureRows: rows });
    const info = await getLockoutInfo(sb, "p@x");
    expect(info.locked).toBe(false);
    expect(info.attemptsInWindow).toBe(LOCKOUT_THRESHOLD);
  });

  it("returns LOCKED on the (threshold+1)th attempt", async () => {
    const now = Date.now();
    const rows = Array.from({ length: LOCKOUT_THRESHOLD + 1 }).map((_, i) => ({
      // Earliest is index 0 (earliest in time, since order asc)
      created_at: new Date(now - 60_000 + i * 1_000).toISOString(),
    }));
    const { sb } = mkLockSb({ userId: "pub-1", failureRows: rows });
    const info = await getLockoutInfo(sb, "p@x");
    expect(info.locked).toBe(true);
    expect(info.attemptsInWindow).toBe(LOCKOUT_THRESHOLD + 1);
    // msRemaining = (earliest + WINDOW) - now ≈ WINDOW - 60s ≈ 4 min
    expect(info.msRemaining).toBeGreaterThan(LOCKOUT_WINDOW_MS - 70_000);
    expect(info.msRemaining).toBeLessThan(LOCKOUT_WINDOW_MS);
  });

  it("normalizes email case (uppercase email yields same lockout state as lowercase)", async () => {
    const now = Date.now();
    const rows = Array.from({ length: LOCKOUT_THRESHOLD + 1 }).map(() => ({
      created_at: new Date(now - 30_000).toISOString(),
    }));
    const { sb } = mkLockSb({ userId: "pub-1", failureRows: rows });
    const info = await getLockoutInfo(sb, "P@CADE.LOCAL");
    expect(info.locked).toBe(true);
  });

  it("returns NOT locked when email does not resolve to a user", async () => {
    const { sb } = mkLockSb({ userId: null });
    const info = await getLockoutInfo(sb, "ghost@nowhere.test");
    expect(info.locked).toBe(false);
    expect(info.attemptsInWindow).toBe(0);
    expect(info.msRemaining).toBe(0);
  });

  it("returns NOT locked for empty email (no DB lookup)", async () => {
    const { sb } = mkLockSb({ userId: "pub-1" });
    const info = await getLockoutInfo(sb, "   ");
    expect(info.locked).toBe(false);
    expect(info.attemptsInWindow).toBe(0);
  });
});

describe("clearLockoutForEmail", () => {
  it("DELETEs in-window login_failed rows and reports the count", async () => {
    const { sb } = mkLockSb({
      userId: "pub-1",
      deleteIds: [{ id: "e-1" }, { id: "e-2" }, { id: "e-3" }],
    });
    const r = await clearLockoutForEmail(sb, "P@CADE.LOCAL");
    expect(r.cleared).toBe(3);
  });

  it("returns cleared=0 when email does not resolve", async () => {
    const { sb } = mkLockSb({ userId: null });
    const r = await clearLockoutForEmail(sb, "ghost@nowhere.test");
    expect(r.cleared).toBe(0);
  });

  it("returns cleared=0 for empty email (no DB call)", async () => {
    const { sb } = mkLockSb({ userId: "pub-1" });
    const r = await clearLockoutForEmail(sb, "");
    expect(r.cleared).toBe(0);
  });
});
