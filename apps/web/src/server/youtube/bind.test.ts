import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan 44 — bind.test.ts. Uses vi.hoisted + vi.mock on @/lib/perms-db so
 * the perm gate is isolated, then constructs a small Supabase chain stub
 * per case to verify the expected update payload.
 */

const { requirePermAsyncMock } = vi.hoisted(() => ({
  requirePermAsyncMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/perms-db", async () => {
  const actual = await vi.importActual<object>("@/lib/perms-db");
  return {
    ...actual,
    requirePermAsync: requirePermAsyncMock,
  };
});

import {
  bindLiveStream,
  unbindLiveStream,
  getSessionBinding,
} from "./bind";
import { PermissionError } from "@/lib/perms-db";

// ------- Tiny query builder stub (matches match_flow.test.ts pattern) -----

function makeQuery(result: { data: unknown; error: unknown }) {
  const thenable: Promise<typeof result> = Promise.resolve(result);
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "update", "insert", "order", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => thenable);
  chain.single = vi.fn(() => thenable);
  (chain as { then?: unknown }).then = thenable.then.bind(thenable);
  return chain as unknown as {
    select: () => unknown;
    eq: (...args: unknown[]) => unknown;
    is: (...args: unknown[]) => unknown;
    update: (...args: unknown[]) => unknown;
    maybeSingle: () => Promise<typeof result>;
  };
}

type Handlers = Record<string, unknown>;
function mkSb(handlers: Handlers) {
  return {
    from: vi.fn((table: string) => {
      if (!(table in handlers)) {
        throw new Error(`bind test: unexpected table "${table}"`);
      }
      return handlers[table];
    }),
  } as unknown as Parameters<typeof bindLiveStream>[0];
}

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const actorAdmin = { userId: "u-admin", roles: ["admin"] as const };

beforeEach(() => {
  requirePermAsyncMock.mockReset();
  requirePermAsyncMock.mockResolvedValue(undefined);
});

describe("bindLiveStream", () => {
  it("writes youtube_* columns on an active session", async () => {
    const sessQuery = makeQuery({
      data: { id: SESSION_ID, ended_at: null },
      error: null,
    });
    const updateQuery = makeQuery({ data: null, error: null });
    // Two .from('stream_sessions') calls: read then update. Alternate them.
    let idx = 0;
    const sb = {
      from: vi.fn((t: string) => {
        if (t !== "stream_sessions") throw new Error("unexpected table " + t);
        return idx++ === 0 ? sessQuery : updateQuery;
      }),
    } as unknown as Parameters<typeof bindLiveStream>[0];

    const out = await bindLiveStream(
      sb,
      SESSION_ID,
      "video-1",
      "chat-1",
      actorAdmin,
    );
    expect(out.videoId).toBe("video-1");
    expect(out.liveChatId).toBe("chat-1");
    expect(out.sessionId).toBe(SESSION_ID);
    expect(typeof out.boundAt).toBe("string");
    expect(requirePermAsyncMock).toHaveBeenCalledWith(
      sb,
      actorAdmin,
      "broadcast.match_control",
    );
    // update() called with the right columns.
    expect((updateQuery.update as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({
        youtube_video_id: "video-1",
        youtube_live_chat_id: "chat-1",
      }),
    );
  });

  it("throws when the permission gate fails", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new PermissionError("missing permission: broadcast.match_control"),
    );
    const sb = mkSb({ stream_sessions: makeQuery({ data: null, error: null }) });
    await expect(
      bindLiveStream(sb, SESSION_ID, "v", "c", {
        userId: "u-player",
        roles: ["player"] as const,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("throws when the session does not exist", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: null, error: null }),
    });
    await expect(
      bindLiveStream(sb, SESSION_ID, "v", "c", actorAdmin),
    ).rejects.toThrow(/session not found/);
  });

  it("rejects when the session is already ended", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: { id: SESSION_ID, ended_at: "2026-04-22T11:00:00Z" },
        error: null,
      }),
    });
    await expect(
      bindLiveStream(sb, SESSION_ID, "v", "c", actorAdmin),
    ).rejects.toThrow(/already ended/);
  });
});

describe("unbindLiveStream", () => {
  it("clears all three youtube_* columns", async () => {
    const q = makeQuery({ data: null, error: null });
    const sb = mkSb({ stream_sessions: q });
    const out = await unbindLiveStream(sb, SESSION_ID, actorAdmin);
    expect(out.sessionId).toBe(SESSION_ID);
    expect(
      (q.update as unknown as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        youtube_video_id: null,
        youtube_live_chat_id: null,
        youtube_bound_at: null,
      }),
    );
  });

  it("throws on perm denial", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new PermissionError("missing permission: broadcast.match_control"),
    );
    const sb = mkSb({
      stream_sessions: makeQuery({ data: null, error: null }),
    });
    await expect(
      unbindLiveStream(sb, SESSION_ID, {
        userId: "u",
        roles: ["viewer"] as const,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("getSessionBinding", () => {
  it("returns the binding when both ids are set", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: {
          youtube_video_id: "v1",
          youtube_live_chat_id: "c1",
          youtube_bound_at: "2026-04-22T10:00:00Z",
        },
        error: null,
      }),
    });
    const out = await getSessionBinding(sb, SESSION_ID);
    expect(out).toEqual({
      videoId: "v1",
      liveChatId: "c1",
      boundAt: "2026-04-22T10:00:00Z",
    });
  });

  it("returns null when nothing is bound", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: {
          youtube_video_id: null,
          youtube_live_chat_id: null,
          youtube_bound_at: null,
        },
        error: null,
      }),
    });
    const out = await getSessionBinding(sb, SESSION_ID);
    expect(out).toBeNull();
  });

  it("returns null when the session does not exist", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: null, error: null }),
    });
    const out = await getSessionBinding(sb, SESSION_ID);
    expect(out).toBeNull();
  });
});
