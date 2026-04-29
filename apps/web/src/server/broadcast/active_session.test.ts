import { describe, it, expect, vi } from "vitest";
import { getActiveSessionId, getActiveSession } from "./active_session";

/**
 * Ambient-session resolver tests.
 *
 * Bug 4 (2026-04-29) — the resolver picks the session with the most
 * recent overlay-trigger activity (overlay_events ∪
 * overlay_active_instances). Falls back to most-recent `started_at`
 * when no trigger activity exists. The mock below stubs each table call
 * separately so each branch is exercised.
 */

type Row = Record<string, unknown> | null;
type Rows = Record<string, unknown>[];

/**
 * Build a Supabase mock that routes calls based on the `from()` table
 * name. Each table can be configured independently. Supports the chain
 * shapes used by the resolver:
 *   - `from("stream_sessions").select("id").is(..).is(..)` → liveIds list
 *   - `from("stream_sessions").select(...).is.is.order.limit.maybeSingle()`
 *     → fallback row (started_at order)
 *   - `from("stream_sessions").select(...).eq.is.maybeSingle()` → hydrate
 *   - `from("overlay_events").select(...).is.order.limit` → activity rows
 *   - `from("overlay_active_instances").select(...).is.order.limit`
 */
function mkSb(spec: {
  liveSessionIds?: string[];
  fallbackByStartedAt?: Row; // returned by ordered/limited maybeSingle on stream_sessions
  hydrate?: Record<string, Row>; // session-id → hydrated row
  overlayEvents?: Rows;
  overlayActiveInstances?: Rows;
}) {
  const liveIds = spec.liveSessionIds ?? [];
  const eventsRows = spec.overlayEvents ?? [];
  const instancesRows = spec.overlayActiveInstances ?? [];

  function streamSessionsHandler() {
    // Track whether `eq()` has been called (hydrate path). The two
    // distinct chains both end in `maybeSingle()` so we route on the
    // presence of an `eq` call.
    let eqId: string | null = null;
    let isCount = 0;
    const handler: Record<string, unknown> = {};

    handler.select = vi.fn(() => handler);
    handler.is = vi.fn(() => {
      isCount += 1;
      return handler;
    });
    handler.eq = vi.fn((_col: string, val: string) => {
      eqId = val;
      return handler;
    });
    handler.order = vi.fn(() => handler);
    handler.limit = vi.fn(() => handler);

    handler.maybeSingle = vi.fn(async () => {
      if (eqId) {
        // Hydrate path
        return { data: spec.hydrate?.[eqId] ?? null, error: null };
      }
      // Fallback by started_at path
      return { data: spec.fallbackByStartedAt ?? null, error: null };
    });

    // For `liveIds` path: select("id").is.is — no ordered/limited follow-up,
    // it's awaited directly. The thenable below resolves to the live list.
    handler.then = (
      resolve: (v: { data: { id: string }[]; error: null }) => unknown,
    ) => {
      if (isCount >= 2) {
        return resolve({
          data: liveIds.map((id) => ({ id })),
          error: null,
        });
      }
      return resolve({ data: [], error: null });
    };

    return handler;
  }

  function overlayTableHandler(rows: Rows) {
    const handler: Record<string, unknown> = {};
    handler.select = vi.fn(() => handler);
    handler.is = vi.fn(() => handler);
    handler.order = vi.fn(() => handler);
    handler.limit = vi.fn(async () => ({ data: rows, error: null }));
    return handler;
  }

  return {
    from: vi.fn((table: string) => {
      if (table === "stream_sessions") return streamSessionsHandler();
      if (table === "overlay_events") return overlayTableHandler(eventsRows);
      if (table === "overlay_active_instances")
        return overlayTableHandler(instancesRows);
      return overlayTableHandler([]);
    }),
  };
}

describe("getActiveSessionId", () => {
  it("returns the only live session id when one exists", async () => {
    const sb = mkSb({
      liveSessionIds: ["sess-9"],
    });
    const id = await getActiveSessionId(sb as never);
    expect(id).toBe("sess-9");
  });

  it("returns null when no live sessions exist", async () => {
    const sb = mkSb({ liveSessionIds: [] });
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

  it("with multiple live sessions, picks the one with freshest overlay_events activity", async () => {
    // Two live sessions; the OLDER session (sess-old) has the more recent
    // overlay trigger — the resolver should prefer it over sess-new.
    const sb = mkSb({
      liveSessionIds: ["sess-new", "sess-old"],
      overlayEvents: [
        // Most recent: sess-old (operator is currently driving it)
        { stream_session_id: "sess-old", triggered_at: "2026-04-29T14:00:00Z" },
        { stream_session_id: "sess-new", triggered_at: "2026-04-29T13:00:00Z" },
      ],
    });
    const id = await getActiveSessionId(sb as never);
    expect(id).toBe("sess-old");
  });

  it("with multiple live sessions and no triggers, falls back to most-recent started_at", async () => {
    const sb = mkSb({
      liveSessionIds: ["sess-a", "sess-b"],
      overlayEvents: [],
      overlayActiveInstances: [],
      fallbackByStartedAt: { id: "sess-b" },
    });
    const id = await getActiveSessionId(sb as never);
    expect(id).toBe("sess-b");
  });

  it("merges overlay_events and overlay_active_instances; freshest wins across both", async () => {
    const sb = mkSb({
      liveSessionIds: ["sess-x", "sess-y"],
      overlayEvents: [
        { stream_session_id: "sess-x", triggered_at: "2026-04-29T13:00:00Z" },
      ],
      overlayActiveInstances: [
        // lower-third trigger on sess-y is more recent than sess-x's event
        { stream_session_id: "sess-y", triggered_at: "2026-04-29T14:00:00Z" },
      ],
    });
    const id = await getActiveSessionId(sb as never);
    expect(id).toBe("sess-y");
  });
});

describe("getActiveSession", () => {
  it("hydrates the picked session with matchDayId + seasonId + viewToken", async () => {
    const sb = mkSb({
      liveSessionIds: ["sess-7"],
      hydrate: {
        "sess-7": {
          id: "sess-7",
          match_day_id: "md-3",
          view_token: "tok-abc",
          match_days: { season_id: "season-x" },
        },
      },
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
      liveSessionIds: ["sess-2"],
      hydrate: {
        "sess-2": {
          id: "sess-2",
          match_day_id: "md-1",
          match_days: [{ season_id: "season-y" }],
        },
      },
    });
    const info = await getActiveSession(sb as never);
    expect(info?.seasonId).toBe("season-y");
  });

  it("returns null when no live sessions", async () => {
    const sb = mkSb({ liveSessionIds: [] });
    const info = await getActiveSession(sb as never);
    expect(info).toBeNull();
  });

  it("returns hydrated info even when match_day join is missing", async () => {
    const sb = mkSb({
      liveSessionIds: ["sess-3"],
      hydrate: {
        "sess-3": {
          id: "sess-3",
          match_day_id: null,
          view_token: null,
          match_days: null,
        },
      },
    });
    const info = await getActiveSession(sb as never);
    expect(info).toEqual({
      sessionId: "sess-3",
      matchDayId: null,
      seasonId: null,
      viewToken: null,
    });
  });

  it("Bug 4 — picks operator-driven session over leftover fresher session", async () => {
    // Reproduces the production bug:
    //   - sess-leftover started later (2026-04-29 13:44) with no triggers
    //   - sess-driven started earlier (2026-04-26 10:39); operator is
    //     currently triggering overlays against it (latest 2026-04-29
    //     14:06).
    // OLD resolver: picked sess-leftover → wrong match-day on OBS.
    // NEW resolver: picks sess-driven via activity rank.
    const sb = mkSb({
      liveSessionIds: ["sess-leftover", "sess-driven"],
      overlayEvents: [
        {
          stream_session_id: "sess-driven",
          triggered_at: "2026-04-29T14:06:22Z",
        },
        {
          stream_session_id: "sess-driven",
          triggered_at: "2026-04-29T14:03:53Z",
        },
      ],
      hydrate: {
        "sess-driven": {
          id: "sess-driven",
          match_day_id: "md-correct",
          view_token: "tok-correct",
          match_days: { season_id: "season-correct" },
        },
      },
    });
    const info = await getActiveSession(sb as never);
    expect(info?.sessionId).toBe("sess-driven");
    expect(info?.matchDayId).toBe("md-correct");
  });
});
