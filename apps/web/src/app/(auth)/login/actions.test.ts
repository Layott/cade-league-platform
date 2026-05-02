import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug 11 (2026-05-01) — login server-action tests.
 *
 * Covers (a) the off-by-one threshold fix (5 failures = warning, 6th
 * locks), (b) the distinct error-code redirects, (c) email-case
 * normalization at every boundary, (d) successful sign-in still flows
 * through to recordLogin + role-based default landing.
 *
 * Mocks: every external module (next/navigation, next/headers, the
 * Supabase clients, rate-limit, sessions). The redirect mock throws a
 * NEXT_REDIRECT error so we can assert the redirect URL the action
 * tried to send.
 */

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    const e = new Error(`NEXT_REDIRECT;${url}`);
    (e as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${url};303`;
    throw e;
  }),
);
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const headersMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(
    new Headers({
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "test-ua",
      "accept-language": "en",
    }),
  ),
);
vi.mock("next/headers", () => ({ headers: headersMock }));

const signInMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { user: { id: "auth-uuid-1" } },
    error: null,
  }),
);

const userClientFromMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("user-client.from() should not be called in login flow");
  }),
);
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({
    auth: { signInWithPassword: signInMock },
    from: userClientFromMock,
  })),
}));

/**
 * Service-role client mock. Drives:
 *   • users → maybeSingle returning { id: "pub-1" } (resolveable email)
 *   • user_roles → returns array of role rows after sign-in
 * Custom per-test overrides are applied via `serviceFromOverrides`.
 */
const usersMaybeSingleMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { id: "pub-1" }, error: null }),
);
const usersSingleMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { id: "pub-1" }, error: null }),
);
const userRolesIsMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: [{ role: "player" }], error: null }),
);
const authEventsInsertMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ error: null }),
);

const serviceFromMock = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table === "users") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: usersMaybeSingleMock,
        single: usersSingleMock,
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
    }
    if (table === "user_roles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: userRolesIsMock,
      };
    }
    if (table === "auth_events") {
      return {
        insert: authEventsInsertMock,
      };
    }
    if (table === "sessions") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [{ id: "prior" }], error: null }),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: "session-1",
                ip_address: "1.2.3.4",
                user_agent: "test-ua",
                started_at: "2026-05-01T12:00:00Z",
              },
              error: null,
            }),
          })),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  }),
);
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: () => ({ from: serviceFromMock }),
}));

const authLimiterLimitMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: Date.now() + 60_000,
  }),
);
vi.mock("@/lib/rate-limit", () => ({
  authLimiter: { limit: authLimiterLimitMock },
}));

const recordLoginFailureMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const getLockoutInfoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    locked: false,
    attemptsInWindow: 0,
    msRemaining: 0,
  }),
);
const recordLoginMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ sessionId: "session-1", isNewDevice: false }),
);
vi.mock("@/server/auth/sessions", () => ({
  recordLogin: recordLoginMock,
  recordLoginFailure: recordLoginFailureMock,
  getLockoutInfo: getLockoutInfoMock,
}));

import { login } from "./actions";

beforeEach(() => {
  redirectMock.mockClear();
  signInMock.mockReset().mockResolvedValue({
    data: { user: { id: "auth-uuid-1" } },
    error: null,
  });
  usersMaybeSingleMock.mockReset().mockResolvedValue({
    data: { id: "pub-1" },
    error: null,
  });
  usersSingleMock.mockReset().mockResolvedValue({
    data: { id: "pub-1" },
    error: null,
  });
  userRolesIsMock.mockReset().mockResolvedValue({
    data: [{ role: "player" }],
    error: null,
  });
  authEventsInsertMock.mockReset().mockResolvedValue({ error: null });
  authLimiterLimitMock.mockReset().mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: Date.now() + 60_000,
  });
  recordLoginFailureMock.mockReset().mockResolvedValue(undefined);
  getLockoutInfoMock.mockReset().mockResolvedValue({
    locked: false,
    attemptsInWindow: 0,
    msRemaining: 0,
  });
  recordLoginMock
    .mockReset()
    .mockResolvedValue({ sessionId: "session-1", isNewDevice: false });
  serviceFromMock.mockClear();
});

function fd(email: string, password: string): FormData {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
}

describe("login() — Bug 11 lockout fix (2026-05-01)", () => {
  it("redirects to /player on successful sign-in (player role)", async () => {
    userRolesIsMock.mockResolvedValueOnce({
      data: [{ role: "player" }],
      error: null,
    });
    await expect(login(fd("player1@cade.local", "pw"))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/player");
  });

  it("redirects to /admin on successful sign-in (staff role)", async () => {
    userRolesIsMock.mockResolvedValueOnce({
      data: [{ role: "admin" }],
      error: null,
    });
    await expect(login(fd("admin@cade.local", "pw"))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(redirectMock).toHaveBeenCalledWith("/admin");
  });

  it("lowercases the email before EVERY downstream call (auth + lockout + failure record)", async () => {
    await expect(
      login(fd("Mixed.Case@CADE.local", "pw")),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    // signInWithPassword received lowercased email
    expect(signInMock).toHaveBeenCalledWith({
      email: "mixed.case@cade.local",
      password: "pw",
    });
    // Lockout probe called with lowercased email
    expect(getLockoutInfoMock).toHaveBeenCalled();
    expect(getLockoutInfoMock.mock.calls[0][1]).toBe("mixed.case@cade.local");
  });

  it("returns invalid_credentials code (NOT a free-form string) on bad password when not yet locked", async () => {
    signInMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });
    // After the failure record, lockout still says NOT locked — fewer
    // than threshold attempts.
    getLockoutInfoMock.mockResolvedValue({
      locked: false,
      attemptsInWindow: 1,
      msRemaining: 0,
    });
    await expect(login(fd("p@x", "wrong"))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith("/login?error=invalid_credentials");
    expect(recordLoginFailureMock).toHaveBeenCalledWith(
      expect.anything(),
      "p@x",
      "Invalid login credentials",
    );
  });

  it("redirects to account_locked when the lockout probe reports locked PRE-AUTH", async () => {
    getLockoutInfoMock.mockResolvedValueOnce({
      locked: true,
      attemptsInWindow: 6,
      msRemaining: 4 * 60 * 1000,
    });
    await expect(login(fd("p@x", "anything"))).rejects.toThrow(/NEXT_REDIRECT/);
    // Must include the minutes hint so page.tsx can render countdown
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/login\?error=account_locked&minutes=\d+$/),
    );
    // Should NOT have called sign-in (we short-circuit before auth)
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("redirects to account_locked AFTER recording the failure that crosses threshold (no extra retries needed)", async () => {
    signInMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });
    // Pre-auth probe: NOT locked yet (5 attempts is the warning state).
    getLockoutInfoMock.mockResolvedValueOnce({
      locked: false,
      attemptsInWindow: 5,
      msRemaining: 0,
    });
    // POST-failure probe: now locked (this attempt was the 6th).
    getLockoutInfoMock.mockResolvedValueOnce({
      locked: true,
      attemptsInWindow: 6,
      msRemaining: 5 * 60 * 1000,
    });
    await expect(login(fd("p@x", "wrong"))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(
      "/login?error=account_locked&minutes=5",
    );
  });

  it("redirects to rate_limited (NOT account_locked) when Upstash trips", async () => {
    authLimiterLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    await expect(login(fd("p@x", "pw"))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith("/login?error=rate_limited");
    // Best-effort forensic record uses lowercased email
    expect(recordLoginFailureMock).toHaveBeenCalledWith(
      expect.anything(),
      "p@x",
      "rate_limited",
    );
  });

  it("respects ?next= safe redirect after successful sign-in", async () => {
    const f = fd("p@x", "pw");
    f.set("next", "/admin/people/players");
    await expect(login(f)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith("/admin/people/players");
  });

  it("ignores unsafe next= (open-redirect attempt) and falls back to role-based landing", async () => {
    const f = fd("p@x", "pw");
    f.set("next", "//evil.example.com/steal");
    await expect(login(f)).rejects.toThrow(/NEXT_REDIRECT/);
    // Not redirected to the attacker — falls through to role default.
    expect(redirectMock).not.toHaveBeenCalledWith("//evil.example.com/steal");
    expect(redirectMock).toHaveBeenCalledWith("/player");
  });
});
