import { describe, it, expect, vi } from "vitest";
import { getActiveSessionId, getActiveSession } from "./active_session";

/**
 * Ambient-session resolver tests.
 *
 * Mocks the Supabase query chain — `from("stream_sessions").select(..)
 * .is(..).is(..).order(..).limit(..).maybeSingle()`. Production code path
 * has no auth call, so a thin chain mock is sufficient.
 */

function mkSb(rowOrNull: Record<string, unknown> | null) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: rowOrNull, error: null });
  const limit = vi.fn(() => ({ maybeSingle }));
  const order = vi.fn(() => ({ limit }));
  const isInner = vi.fn(() => ({ order }));
  const isOuter = vi.fn(() => ({ is: isInner }));
  const select = vi.fn(() => ({ is: isOuter }));
  const from = vi.fn(() => ({ select }));
  return { from };
}

describe("getActiveSessionId", () => {
  it("returns the session id when an active row exists", async () => {
    const sb = mkSb({ id: "sess-9" });
    const id = await getActiveSessionId(sb as never);
    expect(id).toBe("sess-9");
    expect(sb.from).toHaveBeenCalledWith("stream_sessions");
  });

  it("returns null when no active session exists", async () => {
    const sb = mkSb(null);
    const id = await getActiveSessionId(sb as never);
    expect(id).toBeNull();
  });

  it("returns null on DB error (caught + swallowed)", async () => {
    const sb = {
      from: vi.fn(() => {
        throw new Error("connection refused");
      }),
    };
    const id = await getActiveSessionId(sb as never);
    expect(id).toBeNull();
  });
});

describe("getActiveSession", () => {
  it("returns sessionId + matchDayId + seasonId + viewToken when join resolves an object", async () => {
    const sb = mkSb({
      id: "sess-7",
      match_day_id: "md-3",
      view_token: "tok-abc",
      match_days: { season_id: "season-x" },
    });
    const info = await getActiveSession(sb as never);
    expect(info).toEqual({
      sessionId: "sess-7",
      matchDayId: "md-3",
      seasonId: "season-x",
      viewToken: "tok-abc",
    });
  });

  it("handles match_days returning an array (PostgREST embed shape)", async () => {
    const sb = mkSb({
      id: "sess-2",
      match_day_id: "md-1",
      match_days: [{ season_id: "season-y" }],
    });
    const info = await getActiveSession(sb as never);
    expect(info?.seasonId).toBe("season-y");
  });

  it("returns null when no row", async () => {
    const sb = mkSb(null);
    const info = await getActiveSession(sb as never);
    expect(info).toBeNull();
  });

  it("returns sessionId even when match_day join is missing", async () => {
    const sb = mkSb({
      id: "sess-3",
      match_day_id: null,
      view_token: null,
      match_days: null,
    });
    const info = await getActiveSession(sb as never);
    expect(info).toEqual({
      sessionId: "sess-3",
      matchDayId: null,
      seasonId: null,
      viewToken: null,
    });
  });
});
