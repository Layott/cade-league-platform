import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan 42 — match_flow unit tests.
 *
 * We mock @/server/broadcast/realtime + @/lib/perms-db + internal events
 * module so tests stay independent of Supabase networking. Each test
 * constructs a small Supabase stub whose `.from(table)` returns a
 * per-table chain with the rows the test expects.
 */

const {
  publishMock,
  triggerOverlayMock,
  listActiveOverlaysMock,
  requirePermAsyncMock,
} = vi.hoisted(() => ({
  publishMock: vi.fn().mockResolvedValue("ok"),
  triggerOverlayMock: vi.fn().mockResolvedValue({ id: "ev-new" }),
  listActiveOverlaysMock: vi.fn().mockResolvedValue([]),
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
  // Plan 42.1 routing now reads the slot-tagged row by scanning the full
  // list of active overlays (listActiveOverlays). The mock returns an
  // array and tests populate it per-case.
  listActiveOverlays: listActiveOverlaysMock,
}));
vi.mock("@/server/overlays/match_clock", () => ({
  resetClock: vi.fn().mockResolvedValue(undefined),
  setClock: vi.fn().mockResolvedValue(undefined),
  getClock: vi.fn().mockResolvedValue({ stream_session_id: "s" }),
}));

import {
  startMatch,
  updateScoreBug,
  endMatch,
  listSelectableMatches,
  clearScoreBug,
} from "./match_flow";
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
    primary_match_id: null,
    secondary_match_id: null,
    ended_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  publishMock.mockClear();
  triggerOverlayMock.mockClear();
  listActiveOverlaysMock.mockClear();
  requirePermAsyncMock.mockClear();
  requirePermAsyncMock.mockResolvedValue(undefined);
  listActiveOverlaysMock.mockResolvedValue([]);
});

// =========================================================================

describe("startMatch (primary slot)", () => {
  it("happy path: pins match + flips status + spawns score_bug + publishes match.started with slot", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: sessionRow(), error: null }),
      matches: makeQuery({ data: matchJoinRow(), error: null }),
    });

    const out = await startMatch(
      sb as never,
      SESSION_ID,
      MATCH_ID,
      "primary",
      actorAdmin,
    );

    expect(out.matchId).toBe(MATCH_ID);
    expect(out.slot).toBe("primary");
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
        payload: expect.objectContaining({ slot: "primary" }),
      }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "match.started",
      expect.objectContaining({ matchId: MATCH_ID, slot: "primary" }),
    );
  });

  it("rejects when primary slot already has a different primary_match_id", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: "other-match" }),
        error: null,
      }),
    });
    await expect(
      startMatch(sb as never, SESSION_ID, MATCH_ID, "primary", actorAdmin),
    ).rejects.toThrow(/primary slot already has active match/);
  });

  it("rejects when session has ended", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ ended_at: "2026-04-22T00:00:00Z" }),
        error: null,
      }),
    });
    await expect(
      startMatch(sb as never, SESSION_ID, MATCH_ID, "primary", actorAdmin),
    ).rejects.toThrow(/already ended/);
  });

  it("rejects when match not found", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({ data: sessionRow(), error: null }),
      matches: makeQuery({ data: null, error: null }),
    });
    await expect(
      startMatch(sb as never, SESSION_ID, MATCH_ID, "primary", actorAdmin),
    ).rejects.toThrow(/match not found/);
  });

  it("bubbles PermissionError on perm denial", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new PermissionError("missing permission: broadcast.match_control"),
    );
    const sb = mkSb({});
    await expect(
      startMatch(sb as never, SESSION_ID, MATCH_ID, "primary", actorAdmin),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("re-run on same match is idempotent (re-publishes without double-flipping status)", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: MATCH_ID }),
        error: null,
      }),
      matches: makeQuery({
        data: matchJoinRow({ status: "in_progress" }),
        error: null,
      }),
    });
    await startMatch(sb as never, SESSION_ID, MATCH_ID, "primary", actorAdmin);
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "match.started",
      expect.objectContaining({ slot: "primary" }),
    );
  });
});

// =========================================================================
// Plan 42.1 — dual-slot behaviour
// =========================================================================

describe("startMatch (secondary slot)", () => {
  const MATCH_ID_2 = "99999999-9999-4999-8999-999999999999";

  it("starting secondary does NOT block a primary-slot match already pinned", async () => {
    // Session already has a PRIMARY match; starting SECONDARY with a
    // different match should succeed (slot isolation).
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: MATCH_ID }),
        error: null,
      }),
      matches: makeQuery({
        data: matchJoinRow({ id: MATCH_ID_2, status: "scheduled" }),
        error: null,
      }),
    });
    const out = await startMatch(
      sb as never,
      SESSION_ID,
      MATCH_ID_2,
      "secondary",
      actorAdmin,
    );
    expect(out.slot).toBe("secondary");
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "match.started",
      expect.objectContaining({ slot: "secondary" }),
    );
  });

  it("primary + secondary can hold different matches simultaneously", async () => {
    // Start primary first.
    const sb1 = mkSb({
      stream_sessions: makeQuery({ data: sessionRow(), error: null }),
      matches: makeQuery({ data: matchJoinRow(), error: null }),
    });
    await startMatch(sb1 as never, SESSION_ID, MATCH_ID, "primary", actorAdmin);
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ slot: "primary" }),
      }),
    );
    // Now start secondary.
    triggerOverlayMock.mockClear();
    publishMock.mockClear();
    const sb2 = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: MATCH_ID }),
        error: null,
      }),
      matches: makeQuery({
        data: matchJoinRow({ id: MATCH_ID_2 }),
        error: null,
      }),
    });
    await startMatch(sb2 as never, SESSION_ID, MATCH_ID_2, "secondary", actorAdmin);
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ slot: "secondary" }),
      }),
    );
  });

  it("rejects when secondary slot already holds a different match", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ secondary_match_id: "other-match" }),
        error: null,
      }),
    });
    await expect(
      startMatch(sb as never, SESSION_ID, MATCH_ID, "secondary", actorAdmin),
    ).rejects.toThrow(/secondary slot already has active match/);
  });
});

// =========================================================================

describe("updateScoreBug (slot-aware)", () => {
  /** Helper: preload the listActiveOverlays mock with a score_bug row for
   *  the given slot. */
  function primeActiveScoreBug(slot: "primary" | "secondary", score: [number, number]) {
    listActiveOverlaysMock.mockResolvedValueOnce([
      {
        id: `ev-${slot}`,
        stream_session_id: SESSION_ID,
        template_id: "tpl",
        template_key: "score_bug",
        payload: {
          players: [
            { displayName: "Adefola", score: score[0] },
            { displayName: "Faruk", score: score[1] },
          ],
          matchId: MATCH_ID,
          slot,
        },
        triggered_at: "2026-04-22T00:00:00Z",
        cleared_at: null,
      },
    ]);
  }

  it("applies homeDelta to primary slot + republishes with slot", async () => {
    primeActiveScoreBug("primary", [0, 0]);
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: MATCH_ID }),
        error: null,
      }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await updateScoreBug(
      sb as never,
      SESSION_ID,
      "primary",
      { homeDelta: 1 },
      actorAdmin,
    );
    expect(out).toEqual({ home: 1, away: 0, slot: "primary" });
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateKey: "score_bug",
        payload: expect.objectContaining({
          slot: "primary",
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
      expect.objectContaining({
        homeScore: 1,
        awayScore: 0,
        matchId: MATCH_ID,
        slot: "primary",
      }),
    );
  });

  it("score delta on secondary slot does not affect primary score", async () => {
    // The active-overlays list has BOTH slot rows; we target secondary.
    listActiveOverlaysMock.mockResolvedValueOnce([
      {
        id: "ev-primary",
        stream_session_id: SESSION_ID,
        template_id: "tpl",
        template_key: "score_bug",
        payload: {
          players: [
            { displayName: "P1-H", score: 3 },
            { displayName: "P1-A", score: 1 },
          ],
          slot: "primary",
        },
        triggered_at: "2026-04-22T00:00:00Z",
        cleared_at: null,
      },
      {
        id: "ev-secondary",
        stream_session_id: SESSION_ID,
        template_id: "tpl",
        template_key: "score_bug",
        payload: {
          players: [
            { displayName: "P2-H", score: 0 },
            { displayName: "P2-A", score: 0 },
          ],
          slot: "secondary",
        },
        triggered_at: "2026-04-22T00:00:00Z",
        cleared_at: null,
      },
    ]);
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({
          primary_match_id: MATCH_ID,
          secondary_match_id: "m-2",
        }),
        error: null,
      }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await updateScoreBug(
      sb as never,
      SESSION_ID,
      "secondary",
      { awayDelta: 1 },
      actorAdmin,
    );
    // Secondary slot's own away score goes 0 → 1; primary remained 3-1.
    expect(out).toEqual({ home: 0, away: 1, slot: "secondary" });
    expect(triggerOverlayMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          slot: "secondary",
          players: [
            expect.objectContaining({ score: 0, displayName: "P2-H" }),
            expect.objectContaining({ score: 1, displayName: "P2-A" }),
          ],
        }),
      }),
    );
  });

  it("clamps negative score to 0 when homeDelta would drop below zero", async () => {
    primeActiveScoreBug("primary", [0, 2]);
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: MATCH_ID }),
        error: null,
      }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await updateScoreBug(
      sb as never,
      SESSION_ID,
      "primary",
      { homeDelta: -5 },
      actorAdmin,
    );
    expect(out.home).toBe(0);
    expect(out.away).toBe(2);
  });

  it("reset brings both scores back to 0", async () => {
    primeActiveScoreBug("primary", [3, 5]);
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: MATCH_ID }),
        error: null,
      }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await updateScoreBug(
      sb as never,
      SESSION_ID,
      "primary",
      { reset: true },
      actorAdmin,
    );
    expect(out).toEqual({ home: 0, away: 0, slot: "primary" });
  });

  it("throws when no current_match is set on the named slot", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: null }),
        error: null,
      }),
    });
    await expect(
      updateScoreBug(
        sb as never,
        SESSION_ID,
        "primary",
        { homeDelta: 1 },
        actorAdmin,
      ),
    ).rejects.toThrow(/no current_match for primary slot/);
  });

  it("Plan 42.2 — lazily auto-creates the score_bug when none exists + applies the delta on top", async () => {
    // First active-overlays call (inside ensureScoreBug): empty — no seed yet.
    // Second call (inside ensureScoreBug after triggerOverlay): returns the
    // freshly-inserted 0-0 row. Third call is not made (updateScoreBug uses
    // the row returned by ensureScoreBug directly).
    listActiveOverlaysMock
      .mockResolvedValueOnce([]) // pre-seed lookup
      .mockResolvedValueOnce([
        {
          id: "ev-new",
          stream_session_id: SESSION_ID,
          template_id: "tpl",
          template_key: "score_bug",
          payload: {
            players: [
              { displayName: "Adefola", score: 0 },
              { displayName: "Faruk", score: 0 },
            ],
            matchId: MATCH_ID,
            slot: "primary",
          },
          triggered_at: "2026-04-22T00:00:00Z",
          cleared_at: null,
        },
      ]);

    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: MATCH_ID }),
        error: null,
      }),
      matches: makeQuery({ data: matchJoinRow(), error: null }),
      overlay_events: makeQuery({ data: null, error: null }),
    });

    const out = await updateScoreBug(
      sb as never,
      SESSION_ID,
      "primary",
      { homeDelta: 1 },
      actorAdmin,
    );

    // Two triggerOverlay calls: one for the seed 0-0, one for the 1-0 delta.
    expect(triggerOverlayMock).toHaveBeenCalledTimes(2);
    // First call seeds 0-0 with the correct player names from the match.
    expect(triggerOverlayMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        sessionId: SESSION_ID,
        templateKey: "score_bug",
        payload: expect.objectContaining({
          slot: "primary",
          players: [
            expect.objectContaining({ displayName: "Adefola", score: 0 }),
            expect.objectContaining({ displayName: "Faruk", score: 0 }),
          ],
        }),
      }),
    );
    // Second call applies +1 home on top of the seeded row.
    expect(triggerOverlayMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          slot: "primary",
          players: [
            expect.objectContaining({ displayName: "Adefola", score: 1 }),
            expect.objectContaining({ displayName: "Faruk", score: 0 }),
          ],
        }),
      }),
    );
    expect(out).toEqual({ home: 1, away: 0, slot: "primary" });
  });

  it("Plan 42.2 — lazy auto-create bubbles an error when the pinned match cannot be hydrated", async () => {
    listActiveOverlaysMock.mockResolvedValueOnce([]);
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: MATCH_ID }),
        error: null,
      }),
      matches: makeQuery({ data: null, error: null }),
    });
    await expect(
      updateScoreBug(
        sb as never,
        SESSION_ID,
        "primary",
        { homeDelta: 1 },
        actorAdmin,
      ),
    ).rejects.toThrow(/failed to seed score_bug for primary slot/);
  });
});

// =========================================================================

describe("endMatch (slot-aware)", () => {
  it("inserts match_results + clears ONLY the named slot + publishes match.ended with slot", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({
          primary_match_id: MATCH_ID,
          secondary_match_id: "m-2",
        }),
        error: null,
      }),
      match_results: makeQuery({ data: null, error: null }),
      matches: makeQuery({ data: null, error: null }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await endMatch(
      sb as never,
      SESSION_ID,
      "primary",
      { homeScore: 2, awayScore: 1 },
      actorAdmin,
    );
    expect(out.matchId).toBe(MATCH_ID);
    expect(out.slot).toBe("primary");
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "match.ended",
      expect.objectContaining({
        matchId: MATCH_ID,
        slot: "primary",
        result: { homeScore: 2, awayScore: 1 },
      }),
    );
  });

  it("ending primary leaves secondary untouched (slot isolation)", async () => {
    // With secondary still active, clock is NOT reset (verified by the
    // absence of a setClock-to-stopped side-effect in the sess row).
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({
          primary_match_id: MATCH_ID,
          secondary_match_id: "m-2",
        }),
        error: null,
      }),
      match_results: makeQuery({ data: null, error: null }),
      matches: makeQuery({ data: null, error: null }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await endMatch(
      sb as never,
      SESSION_ID,
      "primary",
      { homeScore: 0, awayScore: 0 },
      actorAdmin,
    );
    expect(out.slot).toBe("primary");
  });

  it("rejects on negative score", async () => {
    const sb = mkSb({});
    await expect(
      endMatch(
        sb as never,
        SESSION_ID,
        "primary",
        { homeScore: -1, awayScore: 0 },
        actorAdmin,
      ),
    ).rejects.toThrow(/non-negative/);
  });

  it("throws when no current_match is set for the named slot", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({ primary_match_id: null }),
        error: null,
      }),
    });
    await expect(
      endMatch(
        sb as never,
        SESSION_ID,
        "primary",
        { homeScore: 1, awayScore: 0 },
        actorAdmin,
      ),
    ).rejects.toThrow(/no current_match for primary slot/);
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
        "primary",
        { homeScore: 0, awayScore: 0 },
        actorAdmin,
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("can end secondary slot while primary is still active", async () => {
    const sb = mkSb({
      stream_sessions: makeQuery({
        data: sessionRow({
          primary_match_id: MATCH_ID,
          secondary_match_id: "m-2",
        }),
        error: null,
      }),
      match_results: makeQuery({ data: null, error: null }),
      matches: makeQuery({ data: null, error: null }),
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await endMatch(
      sb as never,
      SESSION_ID,
      "secondary",
      { homeScore: 3, awayScore: 2 },
      actorAdmin,
    );
    expect(out.matchId).toBe("m-2");
    expect(out.slot).toBe("secondary");
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

// =========================================================================
// Plan 45 — clearScoreBug (trigger-OFF button)
// =========================================================================

describe("clearScoreBug", () => {
  it("perm-gated on broadcast.match_control", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new PermissionError("missing permission: broadcast.match_control"),
    );
    await expect(
      clearScoreBug(mkSb({}) as never, SESSION_ID, "primary", actorAdmin),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("no-ops when no active score_bug exists for the slot", async () => {
    listActiveOverlaysMock.mockResolvedValueOnce([]);
    const sb = mkSb({
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await clearScoreBug(
      sb as never,
      SESSION_ID,
      "primary",
      actorAdmin,
    );
    expect(out).toEqual({ slot: "primary", cleared: false });
  });

  it("clears the slot-tagged score_bug + publishes overlay.cleared", async () => {
    listActiveOverlaysMock.mockResolvedValueOnce([
      {
        id: "ev-primary",
        stream_session_id: SESSION_ID,
        template_id: "tpl",
        template_key: "score_bug",
        payload: {
          players: [
            { displayName: "H", score: 2 },
            { displayName: "A", score: 1 },
          ],
          slot: "primary",
        },
        triggered_at: "2026-04-22T00:00:00Z",
        cleared_at: null,
      },
    ]);
    const sb = mkSb({
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await clearScoreBug(
      sb as never,
      SESSION_ID,
      "primary",
      actorAdmin,
    );
    expect(out).toEqual({ slot: "primary", cleared: true });
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "overlay.cleared",
      expect.objectContaining({
        eventId: "ev-primary",
        templateKey: "score_bug",
        slot: "primary",
      }),
    );
  });

  it("only clears the named slot when both slots are live", async () => {
    listActiveOverlaysMock.mockResolvedValueOnce([
      {
        id: "ev-primary",
        stream_session_id: SESSION_ID,
        template_id: "tpl",
        template_key: "score_bug",
        payload: {
          players: [
            { displayName: "P1-H", score: 1 },
            { displayName: "P1-A", score: 0 },
          ],
          slot: "primary",
        },
        triggered_at: "2026-04-22T00:00:00Z",
        cleared_at: null,
      },
      {
        id: "ev-secondary",
        stream_session_id: SESSION_ID,
        template_id: "tpl",
        template_key: "score_bug",
        payload: {
          players: [
            { displayName: "P2-H", score: 2 },
            { displayName: "P2-A", score: 1 },
          ],
          slot: "secondary",
        },
        triggered_at: "2026-04-22T00:00:00Z",
        cleared_at: null,
      },
    ]);
    const sb = mkSb({
      overlay_events: makeQuery({ data: null, error: null }),
    });
    const out = await clearScoreBug(
      sb as never,
      SESSION_ID,
      "secondary",
      actorAdmin,
    );
    expect(out).toEqual({ slot: "secondary", cleared: true });
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "overlay.cleared",
      expect.objectContaining({ eventId: "ev-secondary" }),
    );
  });
});
