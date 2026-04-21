import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock realtime.publish so tests don't attempt WebSocket connections.
// Use vi.hoisted so the mock instance lives at the same hoist level as
// vi.mock itself (tests hoist above imports).
const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn().mockResolvedValue("ok"),
}));
vi.mock("./realtime", () => ({ publish: publishMock }));

import { startSession, endSession, getActiveSession } from "./sessions";

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

  it("creates row and returns id on happy path", async () => {
    const sb = mkSbForStart({ existing: null, insertId: "sess-1" });
    const out = await startSession(sb as never, {
      matchDayId: "md-1",
      userId: "u-1",
    });
    expect(out).toEqual({ id: "sess-1" });
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
