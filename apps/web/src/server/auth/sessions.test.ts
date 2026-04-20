import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendEmail = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/email/resend", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

import { recordLogin } from "./sessions";

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
