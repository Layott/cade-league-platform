import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Phase B4-B5 + C — `/api/broadcast/sessions/[id]/h2h` route tests.
 *
 * The route is publicly readable (view-token gated) and consumed by OBS /
 * vMix browser sources. Mocks:
 *   - `enforcePublicRead` → null (no rate limit hit)
 *   - `getServiceRoleSupabase` → per-test fake client
 *   - `checkViewToken` → per-test ok/fail
 *   - `buildH2HCards` → per-test stat shape
 *
 * Verified branches:
 *   1. View-token gate fail → 401 (unauthenticated browser source).
 *   2. Session-not-found → 404.
 *   3. Match-day not attached → empty cards (live overlay route should
 *      stay on default placeholder, not break).
 *   4. Explicit `?ids=` happy path → 200 + cards.
 *   5. Explicit `?ids=` invalid (bad UUID, too many) → 400.
 *   6. Missing `ids` + missing `key` → 400 (caller must pick one).
 *   7. Missing `ids` + valid `key` + no overlay_events row → 200 + empty
 *      cards (overlay HTML keeps placeholder shape).
 *   8. Missing `ids` + valid `key` + active overlay_events row →
 *      resolves displayName → players.gamer_tag → players.id chain →
 *      200 + cards.
 *   9. buildH2HCards throws → 500.
 *  10. Bug-1 regression — payload displayName "BAJI JNR" (with space)
 *      resolves against players.gamer_tag "BAJI_JNR" (with underscore)
 *      via the normalizeTag step.
 */

const { enforcePublicReadMock, getServiceRoleSupabaseMock, checkViewTokenMock, buildH2HCardsMock } =
  vi.hoisted(() => ({
    enforcePublicReadMock: vi.fn(),
    getServiceRoleSupabaseMock: vi.fn(),
    checkViewTokenMock: vi.fn(),
    buildH2HCardsMock: vi.fn(),
  }));

vi.mock("@/lib/api-rate-limit", () => ({
  enforcePublicRead: enforcePublicReadMock,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: getServiceRoleSupabaseMock,
}));
vi.mock("@/server/broadcast/view_token_gate", () => ({
  checkViewToken: checkViewTokenMock,
}));
vi.mock("@/server/standings/h2h_view", () => ({
  buildH2HCards: buildH2HCardsMock,
}));

import { GET } from "./route";

const SESSION_ID = "11111111-1111-1111-1111-111111111111";
const MATCH_DAY_ID = "22222222-2222-2222-2222-222222222222";
const SEASON_ID = "33333333-3333-3333-3333-333333333333";
const PLAYER_A = "44444444-4444-4444-4444-44444444444a";
const PLAYER_B = "44444444-4444-4444-4444-44444444444b";
const VIEW_TOKEN = "view-token-abc";

beforeEach(() => {
  enforcePublicReadMock.mockReset().mockResolvedValue(null);
  getServiceRoleSupabaseMock.mockReset();
  checkViewTokenMock.mockReset();
  buildH2HCardsMock.mockReset();
});

/**
 * Build a Supabase client mock that handles the chains the route uses:
 *
 *   stream_sessions → select(...).eq().is().maybeSingle()  (session lookup)
 *   match_days      → select(...).eq().is().maybeSingle()  (mday → season)
 *   overlay_events  → select(...).eq().is().is().order().limit()  (pinned)
 *   players         → select(...).is()  (full active roster — gamer_tag
 *                                        → id direct resolve)
 *
 * Each per-table fixture is optional — branches skip downstream lookups.
 */
function mkSb(opts: {
  session?: { id: string; match_day_id: string | null } | null;
  matchDay?: { id: string; season_id: string } | null;
  overlayEvents?: Array<{
    id: string;
    payload: Record<string, unknown> | null;
    overlay_templates: { template_key: string } | null;
  }>;
  players?: Array<{ id: string; gamer_tag: string }>;
}) {
  const sessionMaybe = vi.fn().mockResolvedValue({
    data: opts.session === undefined ? null : opts.session,
    error: null,
  });
  const matchDayMaybe = vi.fn().mockResolvedValue({
    data: opts.matchDay === undefined ? null : opts.matchDay,
    error: null,
  });
  const overlayEventsLimit = vi
    .fn()
    .mockResolvedValue({ data: opts.overlayEvents ?? [], error: null });
  const playersIs = vi
    .fn()
    .mockResolvedValue({ data: opts.players ?? [], error: null });

  return {
    from: vi.fn((table: string) => {
      if (table === "stream_sessions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ maybeSingle: sessionMaybe })),
            })),
          })),
        };
      }
      if (table === "match_days") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ maybeSingle: matchDayMaybe })),
            })),
          })),
        };
      }
      if (table === "overlay_events") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                is: vi.fn(() => ({
                  order: vi.fn(() => ({ limit: overlayEventsLimit })),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "players") {
        return {
          select: vi.fn(() => ({
            is: playersIs,
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

function mkReq(query: Record<string, string>): NextRequest {
  const params = new URLSearchParams(query);
  const url = `https://example.com/api/broadcast/sessions/${SESSION_ID}/h2h?${params.toString()}`;
  return new NextRequest(url);
}

describe("GET /api/broadcast/sessions/[id]/h2h", () => {
  it("returns 401 when view-token gate fails", async () => {
    checkViewTokenMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "invalid_token" }, { status: 401 }),
    });
    getServiceRoleSupabaseMock.mockReturnValue(mkSb({}));

    const res = await GET(mkReq({}), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(401);
    expect(buildH2HCardsMock).not.toHaveBeenCalled();
  });

  it("returns 404 when session not found", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(mkSb({ session: null }));

    const res = await GET(mkReq({ ids: PLAYER_A }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns empty cards when match_day is not attached to session", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: null },
      }),
    );

    const res = await GET(mkReq({ ids: PLAYER_A }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ cards: [], seasonId: null, channel: null });
    expect(buildH2HCardsMock).not.toHaveBeenCalled();
  });

  it("returns 200 + cards on explicit ids happy path", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { id: MATCH_DAY_ID, season_id: SEASON_ID },
      }),
    );
    // 2026-04-28 (Bug #14): `buildH2HCards` returns `winProbPct` as a
    // FRACTION in [0..1] (e.g. 0.65). The route multiplies by 100 +
    // rounds at the wire boundary so the response is integer percent.
    buildH2HCardsMock.mockResolvedValue([
      {
        playerId: PLAYER_A,
        name: "FARUK",
        gamerTag: "FARUK",
        pos: 1,
        played: 5,
        wins: 4,
        draws: 1,
        losses: 0,
        gf: 12,
        ga: 3,
        gd: 9,
        pts: 13,
        winProbPct: 0.65,
        drawProbPct: 0.18,
      },
    ]);

    const res = await GET(mkReq({ ids: `${PLAYER_A},${PLAYER_B}`, t: VIEW_TOKEN }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seasonId).toBe(SEASON_ID);
    expect(body.channel).toBe(`public:standings:${SEASON_ID}`);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].name).toBe("FARUK");
    // Wire-shape contract: integer percent in [0..100] (NOT a fraction).
    expect(body.cards[0].winProbPct).toBe(65);
    expect(body.cards[0].drawProbPct).toBe(18);
    // Plan 53 (2026-05-04) — endpoint passes `{ overlayKey }` (null when
    // no `?key=` param) so the resolver sees the right scope.
    expect(buildH2HCardsMock).toHaveBeenCalledWith(
      expect.anything(),
      SEASON_ID,
      [PLAYER_A, PLAYER_B],
      { overlayKey: null },
    );
  });

  it("returns 400 on invalid UUID in ids", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { id: MATCH_DAY_ID, season_id: SEASON_ID },
      }),
    );

    const res = await GET(mkReq({ ids: "not-a-uuid" }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on > 5 ids", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { id: MATCH_DAY_ID, season_id: SEASON_ID },
      }),
    );
    const six = Array.from({ length: 6 }, (_, i) =>
      `66666666-6666-6666-6666-66666666666${i}`,
    ).join(",");

    const res = await GET(mkReq({ ids: six }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither ids nor key is provided", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { id: MATCH_DAY_ID, season_id: SEASON_ID },
      }),
    );

    const res = await GET(mkReq({}), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/ids/i);
  });

  it("returns empty cards when key is provided but no overlay_events row exists", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { id: MATCH_DAY_ID, season_id: SEASON_ID },
        overlayEvents: [],
      }),
    );

    const res = await GET(mkReq({ key: "04-h2h-2" }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toEqual([]);
    expect(body.seasonId).toBe(SEASON_ID);
    expect(body.channel).toBe(`public:standings:${SEASON_ID}`);
    expect(buildH2HCardsMock).not.toHaveBeenCalled();
  });

  it("resolves displayName → players.id chain when key is provided", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { id: MATCH_DAY_ID, season_id: SEASON_ID },
        overlayEvents: [
          {
            id: "evt-1",
            payload: {
              players: [{ displayName: "FARUK" }, { displayName: "ANIFE" }],
            },
            overlay_templates: { template_key: "h2h_2" },
          },
        ],
        players: [
          { id: PLAYER_A, gamer_tag: "FARUK" },
          { id: PLAYER_B, gamer_tag: "ANIFE" },
        ],
      }),
    );
    // Mock returns FRACTIONS in [0..1]; route converts to integer percent.
    buildH2HCardsMock.mockResolvedValue([
      {
        playerId: PLAYER_A,
        name: "FARUK",
        gamerTag: "FARUK",
        pos: 1,
        played: 5,
        wins: 4,
        draws: 1,
        losses: 0,
        gf: 12,
        ga: 3,
        gd: 9,
        pts: 13,
        winProbPct: 0.65,
        drawProbPct: 0.18,
      },
      {
        playerId: PLAYER_B,
        name: "ANIFE",
        gamerTag: "ANIFE",
        pos: 3,
        played: 5,
        wins: 3,
        draws: 0,
        losses: 2,
        gf: 9,
        ga: 6,
        gd: 3,
        pts: 9,
        winProbPct: 0.35,
        drawProbPct: 0.18,
      },
    ]);

    const res = await GET(mkReq({ key: "04-h2h-2" }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toHaveLength(2);
    expect(body.cards[0].winProbPct).toBe(65);
    expect(body.cards[1].winProbPct).toBe(35);
    // Plan 53 (2026-05-04) — `?key=04-h2h-2` flows through to resolver.
    expect(buildH2HCardsMock).toHaveBeenCalledWith(
      expect.anything(),
      SEASON_ID,
      [PLAYER_A, PLAYER_B],
      { overlayKey: "04-h2h-2" },
    );
  });

  it("Bug-1 regression — normalizes spaced displayName ('BAJI JNR') to underscored gamer_tag ('BAJI_JNR')", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { id: MATCH_DAY_ID, season_id: SEASON_ID },
        overlayEvents: [
          {
            id: "evt-1",
            payload: {
              // Control panel writes display names with spaces — must
              // resolve to DB rows that store the same identity with
              // underscores. Includes "KING NONEX" → "KINGNONEX" (no
              // underscore at all in DB) which exercises the strip-
              // underscores normalization path.
              players: [
                { displayName: "BAJI JNR" },
                { displayName: "KING NONEX" },
              ],
            },
            overlay_templates: { template_key: "h2h_2" },
          },
        ],
        players: [
          { id: PLAYER_A, gamer_tag: "BAJI_JNR" },
          { id: PLAYER_B, gamer_tag: "KINGNONEX" },
          // Other roster rows present so the lookup is not trivially
          // 1:1 — confirms the normalization correctly disambiguates.
          {
            id: "44444444-4444-4444-4444-44444444444c",
            gamer_tag: "FARUK",
          },
        ],
      }),
    );
    buildH2HCardsMock.mockResolvedValue([]);

    const res = await GET(mkReq({ key: "04-h2h-2" }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);
    // Plan 53 (2026-05-04) — `?key=04-h2h-2` flows through to resolver.
    expect(buildH2HCardsMock).toHaveBeenCalledWith(
      expect.anything(),
      SEASON_ID,
      [PLAYER_A, PLAYER_B],
      { overlayKey: "04-h2h-2" },
    );
  });

  it("Bug-14 regression — multiplies fraction winProbPct by 100 + rounds to integer percent", async () => {
    // Pre-fix symptom: `buildH2HCards` returns 0.456 (fraction); the
    // overlay HTML does `Math.round(value) + '%'` → renders "0%" for any
    // value < 0.5. Now the endpoint multiplies + rounds so the wire
    // contract is integer percent in [0..100].
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { id: MATCH_DAY_ID, season_id: SEASON_ID },
      }),
    );
    buildH2HCardsMock.mockResolvedValue([
      {
        playerId: PLAYER_A,
        name: "X",
        gamerTag: "X",
        pos: 9,
        played: 1,
        wins: 0,
        draws: 0,
        losses: 1,
        gf: 0,
        ga: 1,
        gd: -1,
        pts: 0,
        winProbPct: 0.456, // fraction → must arrive at the wire as 46.
        drawProbPct: 0.20,
      },
      {
        playerId: PLAYER_B,
        name: "Y",
        gamerTag: "Y",
        pos: 4,
        played: 1,
        wins: 1,
        draws: 0,
        losses: 0,
        gf: 1,
        ga: 0,
        gd: 1,
        pts: 3,
        winProbPct: 0.875, // fraction → must arrive at the wire as 88.
        drawProbPct: 0.20,
      },
    ]);

    const res = await GET(mkReq({ ids: `${PLAYER_A},${PLAYER_B}` }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards[0].winProbPct).toBe(46);
    expect(body.cards[1].winProbPct).toBe(88);
    // Other fields untouched.
    expect(body.cards[0].played).toBe(1);
    expect(body.cards[0].pts).toBe(0);
  });

  it("returns 500 when buildH2HCards throws", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { id: MATCH_DAY_ID, season_id: SEASON_ID },
      }),
    );
    buildH2HCardsMock.mockRejectedValue(new Error("standings read failed"));

    const res = await GET(mkReq({ ids: PLAYER_A }), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(500);
  });
});
