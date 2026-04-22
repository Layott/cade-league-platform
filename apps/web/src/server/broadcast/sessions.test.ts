import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock realtime.publish so tests don't attempt WebSocket connections.
// Use vi.hoisted so the mock instance lives at the same hoist level as
// vi.mock itself (tests hoist above imports).
const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn().mockResolvedValue("ok"),
}));
vi.mock("./realtime", () => ({ publish: publishMock }));

import {
  startSession,
  endSession,
  getActiveSession,
  generateViewToken,
  rotateViewToken,
} from "./sessions";
import { PermissionError } from "@/lib/perms-db";
import { __test as rolesCacheTest } from "@/server/roles/cache";

type Existing = { id: string; ended_at: string | null } | null;

function mkSbForStart(opts: { existing: Existing; insertId?: string }) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.existing,
    error: null,
  });
  const insertSingle = vi.fn().mockResolvedValue({
    data: opts.insertId ? { id: opts.insertId } : null,
    error: null,
  });

  const streamSessionsBuilder = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle,
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({ single: insertSingle })),
    })),
  };

  return {
    from: vi.fn(() => streamSessionsBuilder),
  };
}

describe("startSession", () => {
  beforeEach(() => publishMock.mockClear());

  it("rejects when an active session already exists for match_day", async () => {
    const sb = mkSbForStart({ existing: { id: "prev", ended_at: null } });
    await expect(
      startSession(sb as never, {
        matchDayId: "md-1",
        userId: "u-1",
      }),
    ).rejects.toThrow(/already active/);
  });

  it("creates row and returns id + viewToken on happy path", async () => {
    const sb = mkSbForStart({ existing: null, insertId: "sess-1" });
    const out = await startSession(sb as never, {
      matchDayId: "md-1",
      userId: "u-1",
    });
    expect(out.id).toBe("sess-1");
    // Plan 39 M3: every new session is minted with a token.
    expect(typeof out.viewToken).toBe("string");
    expect(out.viewToken.length).toBeGreaterThanOrEqual(22);
  });
});

describe("generateViewToken", () => {
  it("produces a base64url string at least 22 chars long", () => {
    const t = generateViewToken();
    expect(typeof t).toBe("string");
    // 32 bytes base64url (unpadded) = 43 chars; 22 is the slack floor.
    expect(t.length).toBeGreaterThanOrEqual(22);
    // base64url alphabet only: A-Z a-z 0-9 - _
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces different tokens across calls (entropy smoke test)", () => {
    const a = generateViewToken();
    const b = generateViewToken();
    expect(a).not.toBe(b);
  });
});

describe("rotateViewToken", () => {
  // Clear the 30s process-local role cache between cases so each test
  // sees a fresh DB-mocked perms snapshot (perms-db -> getRolePerms).
  beforeEach(() => rolesCacheTest.clearAll());

  function mkSbWithRolePerms(perms: string[]) {
    // getRolePerms queries: .from("role_permissions").select("permission").eq("role", role)
    const rolePermsBuilder = {
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({
          data: perms.map((p) => ({ permission: p })),
          error: null,
        }),
      })),
    };
    const updateChain = {
      eq: vi.fn(() => ({
        is: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    const streamSessionsBuilder = { update: vi.fn(() => updateChain) };
    return {
      from: vi.fn((t: string) => {
        if (t === "role_permissions") return rolePermsBuilder;
        if (t === "stream_sessions") return streamSessionsBuilder;
        throw new Error(`unexpected table: ${t}`);
      }),
    };
  }

  it("requires broadcast.manage — permission error bubbles", async () => {
    // viewer role has no broadcast.manage -> PermissionError.
    const sb = mkSbWithRolePerms([]);

    await expect(
      rotateViewToken(sb as never, "sess-1", {
        userId: "u-1",
        roles: ["viewer"],
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("updates row + returns new token when actor has broadcast.manage", async () => {
    const sb = mkSbWithRolePerms(["broadcast.manage"]);

    const out = await rotateViewToken(sb as never, "sess-1", {
      userId: "u-1",
      roles: ["admin"],
    });
    expect(typeof out.viewToken).toBe("string");
    expect(out.viewToken.length).toBeGreaterThanOrEqual(22);
  });
});

describe("endSession", () => {
  beforeEach(() => publishMock.mockClear());

  it("clears active overlays, sets ended_at, publishes session.ended", async () => {
    const clearedRows = [{ id: "ev-1" }, { id: "ev-2" }];

    const overlayEventsUpdate = vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          is: vi.fn(() => ({
            select: vi.fn().mockResolvedValue({
              data: clearedRows,
              error: null,
            }),
          })),
        })),
      })),
    }));

    const streamSessionsUpdate = vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn().mockResolvedValue({ error: null }),
      })),
    }));

    // Add channel/removeChannel so the publish mock's API-surface
    // guards are happy even though publish itself is mocked.
    const sb = {
      from: vi.fn((t: string) => {
        if (t === "overlay_events") return { update: overlayEventsUpdate };
        if (t === "stream_sessions") return { update: streamSessionsUpdate };
        throw new Error(`unexpected table: ${t}`);
      }),
      channel: vi.fn(),
      removeChannel: vi.fn(),
    };

    const out = await endSession(sb as never, "sess-1", "u-1");
    expect(out).toEqual({ clearedCount: 2 });
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(
      sb,
      "sess-1",
      "session.ended",
      expect.objectContaining({ sessionId: "sess-1" }),
    );
  });
});

describe("getActiveSession", () => {
  it("returns null when no active session", async () => {
    const sb = mkSbForStart({ existing: null });
    const out = await getActiveSession(sb as never, "md-1");
    expect(out).toBeNull();
  });
});
