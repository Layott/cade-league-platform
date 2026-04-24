import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for `syncScoreToLiveSessions`.
 *
 * Mocks: @/server/broadcast/realtime (publish) + ./events (triggerOverlay,
 * listActiveOverlays). The Supabase client is stubbed per-test with a
 * minimal query-builder that supports `.from(T).select(..)[.or].is(..)`
 * and `.from('overlay_events').update(..).eq(..).is(..)` chains. That
 * covers everything match_sync.ts actually uses.
 */

const {
  publishMock,
  triggerOverlayMock,
  listActiveOverlaysMock,
} = vi.hoisted(() => ({
  publishMock: vi.fn().mockResolvedValue("ok"),
  triggerOverlayMock: vi.fn().mockResolvedValue({ id: "ev-new" }),
  listActiveOverlaysMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/broadcast/realtime", () => ({ publish: publishMock }));
vi.mock("./events", () => ({
  triggerOverlay: triggerOverlayMock,
  listActiveOverlays: listActiveOverlaysMock,
}));

import {
  syncScoreToLiveSessions,
  findLiveSessionSlotsForMatch,
} from "./match_sync";

// ---------------------------------------------------------------------------

const MATCH_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID_2 = "33333333-3333-4333-8333-333333333333";
const ACTOR_USER_ID = "44444444-4444-4444-8444-444444444444";

type StreamSessionStubRow = {
  id: string;
  primary_match_id: string | null;
  secondary_match_id: string | null;
};

/**
 * Tiny chainable stub. Query methods return `chain` so they compose; the
 * terminal await (via `.then`) resolves with the pre-set `{data, error}`.
 * `.update(...)` returns a sub-chain whose eq/is terminate in a new
 * thenable resolving to `updateResult`.
 */
function makeSelectChain(result: { data: unknown; error: unknown }) {
  const thenable = Promise.resolve(result);
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "is", "order", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => thenable);
  chain.single = vi.fn(() => thenable);
  (chain as { then?: unknown }).then = thenable.then.bind(thenable);
  return chain;
}

function makeUpdateChain(result: { error: unknown }) {
  const thenable = Promise.resolve(result);
  const chain: Record<string, unknown> = {};
  for (const m of ["eq", "is"]) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as { then?: unknown }).then = thenable.then.bind(thenable);
  return chain;
}

function mkSb({
  sessions,
  sessionsSelectError,
  overlayUpdate,
}: {
  sessions?: StreamSessionStubRow[];
  sessionsSelectError?: { message: string };
  overlayUpdate?: { error: unknown };
}) {
  const streamSessionsSelect = makeSelectChain({
    data: sessions ?? [],
    error: sessionsSelectError ?? null,
  });
  const overlayUpdateChain = makeUpdateChain({
    error: overlayUpdate?.error ?? null,
  });
  const overlayEventsHandler = {
    update: vi.fn(() => overlayUpdateChain),
  };
  return {
    from: vi.fn((table: string) => {
      if (table === "stream_sessions") return streamSessionsSelect;
      if (table === "overlay_events") return overlayEventsHandler;
      throw new Error(`match_sync test: unexpected table "${table}"`);
    }),
    channel: vi.fn(() => ({ send: vi.fn().mockResolvedValue("ok") })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
}

function primeScoreBug(
  slotRows: Array<{
    slot: "primary" | "secondary";
    sessionId: string;
    home: number;
    away: number;
    eventId?: string;
  }>,
) {
  listActiveOverlaysMock.mockImplementation((_sb: unknown, sid: string) =>
    Promise.resolve(
      slotRows
        .filter((r) => r.sessionId === sid)
        .map((r) => ({
          id: r.eventId ?? `ev-${r.sessionId}-${r.slot}`,
          stream_session_id: r.sessionId,
          template_id: "tpl-score-bug",
          template_key: "score_bug",
          payload: {
            players: [
              { displayName: "H", photoUrl: "/h.png", score: r.home },
              { displayName: "A", photoUrl: "/a.png", score: r.away },
            ],
            matchId: MATCH_ID,
            slot: r.slot,
          },
          triggered_at: "2026-04-23T00:00:00Z",
          cleared_at: null,
        })),
    ),
  );
}

beforeEach(() => {
  publishMock.mockClear();
  triggerOverlayMock.mockClear();
  listActiveOverlaysMock.mockReset();
  listActiveOverlaysMock.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------

describe("findLiveSessionSlotsForMatch", () => {
  it("returns empty array when no session has the match pinned", async () => {
    const sb = mkSb({ sessions: [] });
    const out = await findLiveSessionSlotsForMatch(sb as never, MATCH_ID);
    expect(out).toEqual([]);
  });

  it("detects primary-slot pin", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
      ],
    });
    const out = await findLiveSessionSlotsForMatch(sb as never, MATCH_ID);
    expect(out).toEqual([{ sessionId: SESSION_ID, slot: "primary" }]);
  });

  it("detects secondary-slot pin", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: "other-match",
          secondary_match_id: MATCH_ID,
        },
      ],
    });
    const out = await findLiveSessionSlotsForMatch(sb as never, MATCH_ID);
    expect(out).toEqual([{ sessionId: SESSION_ID, slot: "secondary" }]);
  });

  it("returns both entries when the same match is pinned to primary AND secondary (edge case)", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: MATCH_ID,
        },
      ],
    });
    const out = await findLiveSessionSlotsForMatch(sb as never, MATCH_ID);
    expect(out).toEqual([
      { sessionId: SESSION_ID, slot: "primary" },
      { sessionId: SESSION_ID, slot: "secondary" },
    ]);
  });

  it("returns multiple rows when two sessions both have the match pinned", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
        {
          id: SESSION_ID_2,
          primary_match_id: null,
          secondary_match_id: MATCH_ID,
        },
      ],
    });
    const out = await findLiveSessionSlotsForMatch(sb as never, MATCH_ID);
    expect(out).toEqual([
      { sessionId: SESSION_ID, slot: "primary" },
      { sessionId: SESSION_ID_2, slot: "secondary" },
    ]);
  });

  it("bubbles Supabase select errors", async () => {
    const sb = mkSb({
      sessionsSelectError: { message: "boom" },
    });
    await expect(
      findLiveSessionSlotsForMatch(sb as never, MATCH_ID),
    ).rejects.toThrow(/boom/);
  });
});

// ---------------------------------------------------------------------------

describe("syncScoreToLiveSessions", () => {
  it("no-op when no live session has the match pinned", async () => {
    const sb = mkSb({ sessions: [] });
    const out = await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      2,
      1,
      ACTOR_USER_ID,
    );
    expect(out).toEqual({ pinnedSlots: [], updatedSlots: [] });
    expect(triggerOverlayMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("no-op when pinned slot has no active score_bug overlay", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
      ],
    });
    // listActiveOverlaysMock returns [] by default -> no score_bug
    listActiveOverlaysMock.mockResolvedValue([]);
    const out = await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      2,
      1,
      ACTOR_USER_ID,
    );
    expect(out.pinnedSlots).toEqual([{ sessionId: SESSION_ID, slot: "primary" }]);
    expect(out.updatedSlots).toEqual([]);
    expect(triggerOverlayMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("updates the primary-slot score_bug + publishes score.changed", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
      ],
    });
    primeScoreBug([
      { slot: "primary", sessionId: SESSION_ID, home: 0, away: 0 },
    ]);
    const out = await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      3,
      2,
      ACTOR_USER_ID,
    );
    expect(out.updatedSlots).toEqual([{ sessionId: SESSION_ID, slot: "primary" }]);
    expect(triggerOverlayMock).toHaveBeenCalledTimes(1);
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: SESSION_ID,
        templateKey: "score_bug",
        userId: ACTOR_USER_ID,
        payload: expect.objectContaining({
          slot: "primary",
          matchId: MATCH_ID,
          players: [
            expect.objectContaining({ score: 3, displayName: "H", photoUrl: "/h.png" }),
            expect.objectContaining({ score: 2, displayName: "A", photoUrl: "/a.png" }),
          ],
        }),
      }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "score.changed",
      expect.objectContaining({
        matchId: MATCH_ID,
        slot: "primary",
        homeScore: 3,
        awayScore: 2,
      }),
    );
  });

  it("preserves player displayName + photoUrl when writing the new payload", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
      ],
    });
    listActiveOverlaysMock.mockResolvedValueOnce([
      {
        id: "ev-1",
        stream_session_id: SESSION_ID,
        template_id: "tpl",
        template_key: "score_bug",
        payload: {
          players: [
            { displayName: "Adefola", photoUrl: "/img/adefola.png", score: 1 },
            { displayName: "Faruk", photoUrl: "/img/faruk.png", score: 0 },
          ],
          matchId: MATCH_ID,
          slot: "primary",
        },
        triggered_at: "2026-04-23T00:00:00Z",
        cleared_at: null,
      },
    ]);
    await syncScoreToLiveSessions(sb as never, MATCH_ID, 4, 1, ACTOR_USER_ID);
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          players: [
            {
              displayName: "Adefola",
              photoUrl: "/img/adefola.png",
              score: 4,
            },
            {
              displayName: "Faruk",
              photoUrl: "/img/faruk.png",
              score: 1,
            },
          ],
        }),
      }),
    );
  });

  it("idempotent: no-op when the bug already displays the target score", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
      ],
    });
    primeScoreBug([
      { slot: "primary", sessionId: SESSION_ID, home: 3, away: 2 },
    ]);
    const out = await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      3,
      2,
      ACTOR_USER_ID,
    );
    expect(out.pinnedSlots).toEqual([{ sessionId: SESSION_ID, slot: "primary" }]);
    expect(out.updatedSlots).toEqual([]);
    expect(triggerOverlayMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("clamps scores below 0 to 0 and scores above 99 to 99", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
      ],
    });
    primeScoreBug([
      { slot: "primary", sessionId: SESSION_ID, home: 0, away: 0 },
    ]);
    await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      -5,
      500,
      ACTOR_USER_ID,
    );
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          players: [
            expect.objectContaining({ score: 0 }),
            expect.objectContaining({ score: 99 }),
          ],
        }),
      }),
    );
  });

  it("targets secondary slot when match is pinned there (leaves primary untouched)", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: "other-match",
          secondary_match_id: MATCH_ID,
        },
      ],
    });
    // listActiveOverlays for SESSION_ID returns the secondary bug.
    listActiveOverlaysMock.mockImplementation((_sb: unknown, sid: string) => {
      if (sid !== SESSION_ID) return Promise.resolve([]);
      return Promise.resolve([
        {
          id: "ev-secondary",
          stream_session_id: SESSION_ID,
          template_id: "tpl",
          template_key: "score_bug",
          payload: {
            players: [
              { displayName: "Primary-H", score: 5 },
              { displayName: "Primary-A", score: 5 },
            ],
            slot: "primary",
          },
          triggered_at: "2026-04-23T00:00:00Z",
          cleared_at: null,
        },
        {
          id: "ev-sec",
          stream_session_id: SESSION_ID,
          template_id: "tpl",
          template_key: "score_bug",
          payload: {
            players: [
              { displayName: "Sec-H", score: 0 },
              { displayName: "Sec-A", score: 0 },
            ],
            matchId: MATCH_ID,
            slot: "secondary",
          },
          triggered_at: "2026-04-23T00:00:00Z",
          cleared_at: null,
        },
      ]);
    });
    const out = await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      1,
      2,
      ACTOR_USER_ID,
    );
    expect(out.updatedSlots).toEqual([{ sessionId: SESSION_ID, slot: "secondary" }]);
    expect(triggerOverlayMock).toHaveBeenCalledTimes(1);
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          slot: "secondary",
          players: [
            expect.objectContaining({ displayName: "Sec-H", score: 1 }),
            expect.objectContaining({ displayName: "Sec-A", score: 2 }),
          ],
        }),
      }),
    );
    // score.changed was published with slot=secondary
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      "score.changed",
      expect.objectContaining({ slot: "secondary" }),
    );
  });

  it("updates BOTH sessions when the same match is pinned in two different live sessions", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
        {
          id: SESSION_ID_2,
          primary_match_id: null,
          secondary_match_id: MATCH_ID,
        },
      ],
    });
    primeScoreBug([
      { slot: "primary", sessionId: SESSION_ID, home: 0, away: 0 },
      { slot: "secondary", sessionId: SESSION_ID_2, home: 0, away: 0 },
    ]);
    const out = await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      2,
      2,
      ACTOR_USER_ID,
    );
    expect(out.pinnedSlots.length).toBe(2);
    expect(out.updatedSlots.length).toBe(2);
    expect(triggerOverlayMock).toHaveBeenCalledTimes(2);
    expect(publishMock).toHaveBeenCalledTimes(2);
  });

  it("swallows realtime publish failures (durable row already written)", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
      ],
    });
    primeScoreBug([
      { slot: "primary", sessionId: SESSION_ID, home: 0, away: 0 },
    ]);
    publishMock.mockRejectedValueOnce(new Error("realtime down"));
    const out = await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      1,
      0,
      ACTOR_USER_ID,
    );
    expect(out.updatedSlots).toEqual([{ sessionId: SESSION_ID, slot: "primary" }]);
  });

  it("skips malformed payload (not exactly 2 players) without throwing", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
      ],
    });
    listActiveOverlaysMock.mockResolvedValueOnce([
      {
        id: "ev-bad",
        stream_session_id: SESSION_ID,
        template_id: "tpl",
        template_key: "score_bug",
        payload: {
          players: [{ displayName: "only-one", score: 0 }],
          slot: "primary",
        },
        triggered_at: "2026-04-23T00:00:00Z",
        cleared_at: null,
      },
    ]);
    const out = await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      1,
      2,
      ACTOR_USER_ID,
    );
    expect(out.updatedSlots).toEqual([]);
    expect(triggerOverlayMock).not.toHaveBeenCalled();
  });

  it("treats legacy score_bug payloads without an explicit slot field as 'primary'", async () => {
    const sb = mkSb({
      sessions: [
        {
          id: SESSION_ID,
          primary_match_id: MATCH_ID,
          secondary_match_id: null,
        },
      ],
    });
    listActiveOverlaysMock.mockResolvedValueOnce([
      {
        id: "ev-legacy",
        stream_session_id: SESSION_ID,
        template_id: "tpl",
        template_key: "score_bug",
        payload: {
          // NO slot field — pre-Plan-42.1 overlay_events row
          players: [
            { displayName: "H", score: 0 },
            { displayName: "A", score: 0 },
          ],
          matchId: MATCH_ID,
        },
        triggered_at: "2026-04-23T00:00:00Z",
        cleared_at: null,
      },
    ]);
    const out = await syncScoreToLiveSessions(
      sb as never,
      MATCH_ID,
      1,
      0,
      ACTOR_USER_ID,
    );
    expect(out.updatedSlots).toEqual([{ sessionId: SESSION_ID, slot: "primary" }]);
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ slot: "primary" }),
      }),
    );
  });
});
