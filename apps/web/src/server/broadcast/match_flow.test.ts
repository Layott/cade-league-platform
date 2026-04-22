import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan 42 — match_flow unit tests.
 *
 * We mock @/server/broadcast/realtime + @/lib/perms-db + internal events
 * module so tests stay independent of Supabase networking. Each test
 * constructs a small Supabase stub whose `.from(table)` returns a
 * per-table chain with the rows the test expects.
 */

const { publishMock, triggerOverlayMock, getActiveForTemplateMock, requirePermAsyncMock } =
  vi.hoisted(() => ({
    publishMock: vi.fn().mockResolvedValue("ok"),
    triggerOverlayMock: vi.fn().mockResolvedValue({ id: "ev-new" }),
    getActiveForTemplateMock: vi.fn().mockResolvedValue(null),
    requirePermAsyncMock: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock("@/server/broadcast/realtime", () => ({ publish: publishMock }));
vi.mock("@/lib/perms-db", async () => {
  const actual = await vi.importActual<object>("@/lib/perms-db");
  return {
    ...actual,
    requirePermAsync: requirePermAsyncMock,
  };
});
vi.mock("./events", () => ({
  triggerOverlay: triggerOverlayMock,
  getActiveForTemplate: getActiveForTemplateMock,
}));
vi.mock("@/server/overlays/match_clock", () => ({
  resetClock: vi.fn().mockResolvedValue(undefined),
  setClock: vi.fn().mockResolvedValue(undefined),
  getClock: vi.fn().mockResolvedValue({ stream_session_id: "s" }),
}));

import { startMatch, updateScoreBug, endMatch, listSelectableMatches } from "./match_flow";
import { PermissionError } from "@/lib/perms-db";

// -- tiny query-builder stub ------------------------------------------------

/** Returns a chainable object whose each query method returns the thenable
 *  so awaiting the chain resolves to the preset { data, error }.
 *  Allows `await sb.from(X).select(..).eq(..).is(..).maybeSingle()` patterns. */
function makeQuery(result: { data: unknown; error: unknown }) {
  const thenable: Promise<typeof result> & {
    then: Promise<typeof result>["then"];
  } = Promise.resolve(result) as Promise<typeof result> & {
    then: Promise<typeof result>["then"];
  };
  const chain: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "neq",
    "is",
    "order",
    "limit",
    "gte",
    "lte",
    "in",
    "update",
    "insert",
  ]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => thenable);
  chain.single = vi.fn(() => thenable);
  // Terminal await:
  (chain as { then?: unknown }).then = thenable.then.bind(thenable);
  return chain as unknown as {
    select: () => unknown;
    eq: () => unknown;
    neq: () => unknown;
    is: () => unknown;
    order: () => unknown;
    limit: () => unknown;
    update: () => unknown;
    insert: () => unknown;
    maybeSingle: () => Promise<typeof result>;
    single: () => Promise<typeof result>;
    then: Promise<typeof result>["then"];
  };
}

type Handlers = Record<string, unknown>;
function mkSb(handlers: Handlers) {
  return {
    from: vi.fn((table: string) => {
      if (!(table in handlers)) {
        throw new Error(`match_flow test: unexpected table "${table}"`);
      }
      return handlers[table];
    }),
    channel: vi.fn(() => ({ send: vi.fn().mockResolvedValue("ok") })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
}

const actorAdmin = { userId: "u-admin", roles: ["admin"] as const };

const MATCH_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function matchJoinRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: MATCH_ID,
    match_day_id: "md-1",
    scheduled_time: "18:00:00",
    status: "scheduled",
    match_day: { match_date: "2026-04-22" },
    home_player: {
      id: "p-home",
      gamer_tag: "ADEFOLA",
      jersey_number: 10,
      users: { display_name: "Adefola" },
    },
    away_player: {
      id: "p-away",
      gamer_tag: "FARUK",
      jersey_number: 7,
      users: { display_name: "Faruk" },
    },
    ...overrides,
  };
}

function sessionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SESSION_ID,
    match_day_id: "md-1",
    current_match_id: null,
    ended_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  publishMock.mockClear();
  triggerOverlayMock.mockClear();
  getActiveForTemplateMock.mockClear();
  requirePermAsyncMock.mockClear();
  requirePermAsyncMock.mockResolvedValue(undefined);
  getActiveForTemplateMock.mockResolvedValue(null);
});

// =========================================================================

describe("startMatch", () => {
  it("happy path: pins match + flips status + spawns score_bug + publishes match.started", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: sessionRow(), error: null }),
      matches: makeQuery({ data: matchJoinRow(), error: null }),
    });

    const out = await startMatch(sb as never, SESSION_ID, MATCH_ID, actorAdmin);

    expect(out.matchId).toBe(MATCH_ID);
    expect(out.startedAt).toMatch(/^\d{4}-/);
    expect(requirePermAsyncMock).toHaveBeenCalledWith(
      expect.anything(),
      actorAdmin,
      "broadcast.match_control",
    );
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: SESSION_ID,
        templateKey: "score_bug",
      }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "match.started",
      expect.objectContaining({ matchId: MATCH_ID }),
    );
  });

  it("rejects when session already has a different current_match_id", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: "other-match" }),
        error: null,
      }),
    });
    await expect(
      startMatch(sb as never, SESSION_ID, MATCH_ID, actorAdmin),
    ).rejects.toThrow(/already has active match/);
  });

  it("rejects when session has ended", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ ended_at: "2026-04-22T00:00:00Z" }),
        error: null,
      }),
    });
    await expect(
      startMatch(sb as never, SESSION_ID, MATCH_ID, actorAdmin),
    ).rejects.toThrow(/already ended/);
  });

  it("rejects when match not found", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: sessionRow(), error: null }),
      matches: makeQuery({ data: null, error: null }),
    });
    await expect(
      startMatch(sb as never, SESSION_ID, MATCH_ID, actorAdmin),
    ).rejects.toThrow(/match not found/);
  });

  it("bubbles PermissionError on perm denial", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new PermissionError("missing permission: broadcast.match_control"),
    );
    const sb = mkSb({});
    await expect(
      startMatch(sb as never, SESSION_ID, MATCH_ID, actorAdmin),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("re-run on same match is idempotent (re-publishes without double-flipping status)", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: MATCH_ID }),
        error: null,
      }),
      matches: makeQuery({
        data: matchJoinRow({ status: "in_progress" }),
        error: null,
      }),
    });
    await startMatch(sb as never, SESSION_ID, MATCH_ID, actorAdmin);
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "match.started",
      expect.any(Object),
    );
  });
});

// =========================================================================

describe("updateScoreBug", () => {
  it("applies homeDelta + republishes overlay.triggered + score.changed", async () => {
    getActiveForTemplateMock.mockResolvedValueOnce({
      id: "ev-old",
      payload: {
        players: [
          { displayName: "Adefola", score: 0 },
          { displayName: "Faruk", score: 0 },
        ],
        matchId: MATCH_ID,
      },
    });
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: MATCH_ID }),
        error: null,
      }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await updateScoreBug(
      sb as never,
      SESSION_ID,
      { homeDelta: 1 },
      actorAdmin,
    );
    expect(out).toEqual({ home: 1, away: 0 });
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateKey: "score_bug",
        payload: expect.objectContaining({
          players: [
            expect.objectContaining({ score: 1 }),
            expect.objectContaining({ score: 0 }),
          ],
        }),
      }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "score.changed",
      expect.objectContaining({ homeScore: 1, awayScore: 0, matchId: MATCH_ID }),
    );
  });

  it("clamps negative score to 0 when homeDelta would drop below zero", async () => {
    getActiveForTemplateMock.mockResolvedValueOnce({
      id: "ev-old",
      payload: {
        players: [
          { displayName: "A", score: 0 },
          { displayName: "B", score: 2 },
        ],
      },
    });
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: MATCH_ID }),
        error: null,
      }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await updateScoreBug(
      sb as never,
      SESSION_ID,
      { homeDelta: -5 },
      actorAdmin,
    );
    expect(out.home).toBe(0);
    expect(out.away).toBe(2);
  });

  it("reset brings both scores back to 0", async () => {
    getActiveForTemplateMock.mockResolvedValueOnce({
      id: "ev-old",
      payload: {
        players: [
          { displayName: "A", score: 3 },
          { displayName: "B", score: 5 },
        ],
      },
    });
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: MATCH_ID }),
        error: null,
      }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await updateScoreBug(
      sb as never,
      SESSION_ID,
      { reset: true },
      actorAdmin,
    );
    expect(out).toEqual({ home: 0, away: 0 });
  });

  it("throws when no current_match is set on the session", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: null }),
        error: null,
      }),
    });
    await expect(
      updateScoreBug(sb as never, SESSION_ID, { homeDelta: 1 }, actorAdmin),
    ).rejects.toThrow(/no current_match/);
  });

  it("throws when no active score_bug overlay exists", async () => {
    getActiveForTemplateMock.mockResolvedValueOnce(null);
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: MATCH_ID }),
        error: null,
      }),
    });
    await expect(
      updateScoreBug(sb as never, SESSION_ID, { homeDelta: 1 }, actorAdmin),
    ).rejects.toThrow(/no active score_bug/);
  });
});

// =========================================================================

describe("endMatch", () => {
  it("inserts match_results + flips to completed + clears current_match + publishes match.ended", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: MATCH_ID }),
        error: null,
      }),
      match_results: makeQuery({ data: null, error: null }),
      matches: makeQuery({ data: null, error: null }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await endMatch(
      sb as never,
      SESSION_ID,
      { homeScore: 2, awayScore: 1 },
      actorAdmin,
    );
    expect(out.matchId).toBe(MATCH_ID);
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "match.ended",
      expect.objectContaining({
        matchId: MATCH_ID,
        result: { homeScore: 2, awayScore: 1 },
      }),
    );
  });

  it("rejects on negative score", async () => {
    const sb = mkSb({});
    await expect(
      endMatch(
        sb as never,
        SESSION_ID,
        { homeScore: -1, awayScore: 0 },
        actorAdmin,
      ),
    ).rejects.toThrow(/non-negative/);
  });

  it("throws when no current_match is set", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ current_match_id: null }),
        error: null,
      }),
    });
    await expect(
      endMatch(
        sb as never,
        SESSION_ID,
        { homeScore: 1, awayScore: 0 },
        actorAdmin,
      ),
    ).rejects.toThrow(/no current_match/);
  });

  it("bubbles PermissionError on perm denial", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new PermissionError("missing permission: broadcast.match_control"),
    );
    const sb = mkSb({});
    await expect(
      endMatch(
        sb as never,
        SESSION_ID,
        { homeScore: 0, awayScore: 0 },
        actorAdmin,
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

// =========================================================================

describe("listSelectableMatches", () => {
  it("returns mapped rows scoped to today's match_day", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: { id: SESSION_ID, match_day_id: "md-1" },
        error: null,
      }),
      seasons: makeQuery({ data: { id: "season-1" }, error: null }),
      matches: makeQuery({
        data: [matchJoinRow()],
        error: null,
      }),
    });
    const out = await listSelectableMatches(sb as never, SESSION_ID, {
      scope: "today",
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(MATCH_ID);
    expect(out[0].home.gamerTag).toBe("ADEFOLA");
    expect(out[0].away.displayName).toBe("Faruk");
  });

  it("returns [] when the session doesn't exist", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: null, error: null }),
    });
    const out = await listSelectableMatches(sb as never, SESSION_ID, {
      scope: "today",
    });
    expect(out).toEqual([]);
  });
});
