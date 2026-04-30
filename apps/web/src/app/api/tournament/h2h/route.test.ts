import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Plan 51 — `/api/tournament/h2h` route tests.
 *
 * The route is admin-gated (`tournament.read` perm) and consumed by the
 * H2H Lookup tab in the admin tournament dashboard. Same `buildH2HCards`
 * server module as the public-facing `/api/broadcast/sessions/[id]/h2h`
 * but with auth instead of a view-token gate.
 *
 * 2026-04-28 — Bug #14 wire-shape fix. Both endpoints now return
 * `winProbPct` as an INTEGER PERCENT in [0..100] (was previously a
 * fraction in [0..1]). Mirror the broadcast-route test to lock the same
 * contract on the admin endpoint.
 */

const {
  getServerSupabaseMock,
  getServiceRoleSupabaseMock,
  hasPermAsyncMock,
  getActiveSeasonMock,
  buildH2HCardsMock,
} = vi.hoisted(() => ({
  getServerSupabaseMock: vi.fn(),
  getServiceRoleSupabaseMock: vi.fn(),
  hasPermAsyncMock: vi.fn(),
  getActiveSeasonMock: vi.fn(),
  buildH2HCardsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: getServerSupabaseMock,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: getServiceRoleSupabaseMock,
}));
vi.mock("@/lib/perms-db", () => ({
  hasPermAsync: hasPermAsyncMock,
}));
vi.mock("@/server/seasons", () => ({
  getActiveSeason: getActiveSeasonMock,
}));
vi.mock("@/server/standings/h2h_view", () => ({
  buildH2HCards: buildH2HCardsMock,
}));

import { GET } from "./route";

const SEASON_ID = "33333333-3333-3333-3333-333333333333";
const PLAYER_A = "44444444-4444-4444-4444-44444444444a";
const PLAYER_B = "44444444-4444-4444-4444-44444444444b";
const PUBLIC_USER_ID = "55555555-5555-5555-5555-555555555555";
const AUTH_USER_ID = "66666666-6666-6666-6666-666666666666";

beforeEach(() => {
  getServerSupabaseMock.mockReset();
  getServiceRoleSupabaseMock.mockReset().mockReturnValue({});
  hasPermAsyncMock.mockReset();
  getActiveSeasonMock.mockReset();
  buildH2HCardsMock.mockReset();
});

/**
 * Build the user-client mock the route uses for auth + role lookup.
 * Calls in order: auth.getUser → users.maybeSingle → user_roles.is.
 */
function mkAuthedUserClient(opts: { roles?: string[] } = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: AUTH_USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: PUBLIC_USER_ID },
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "user_roles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({
                data: (opts.roles ?? ["admin"]).map((r) => ({ role: r })),
                error: null,
              }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table on user client: ${table}`);
    }),
  };
}

function mkReq(query: Record<string, string>): NextRequest {
  const params = new URLSearchParams(query);
  return new NextRequest(`https://example.com/api/tournament/h2h?${params.toString()}`);
}

describe("GET /api/tournament/h2h", () => {
  it("returns 401 when unauthenticated", async () => {
    getServerSupabaseMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
      from: vi.fn(),
    });
    const res = await GET(mkReq({ ids: PLAYER_A }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when permission check fails", async () => {
    getServerSupabaseMock.mockResolvedValue(mkAuthedUserClient({ roles: ["viewer"] }));
    hasPermAsyncMock.mockResolvedValue(false);
    const res = await GET(mkReq({ ids: PLAYER_A }));
    expect(res.status).toBe(403);
  });

  it("returns 400 on invalid ids", async () => {
    getServerSupabaseMock.mockResolvedValue(mkAuthedUserClient());
    hasPermAsyncMock.mockResolvedValue(true);
    const res = await GET(mkReq({ ids: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("returns empty cards when there is no active season", async () => {
    getServerSupabaseMock.mockResolvedValue(mkAuthedUserClient());
    hasPermAsyncMock.mockResolvedValue(true);
    getActiveSeasonMock.mockResolvedValue(null);
    const res = await GET(mkReq({ ids: `${PLAYER_A},${PLAYER_B}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toEqual([]);
  });

  it("Bug-14 regression — multiplies fraction winProbPct by 100 + rounds to integer percent", async () => {
    getServerSupabaseMock.mockResolvedValue(mkAuthedUserClient());
    hasPermAsyncMock.mockResolvedValue(true);
    getActiveSeasonMock.mockResolvedValue({ id: SEASON_ID });
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
        winProbPct: 0.624, // fraction
        drawProbPct: 0.20,
      },
      {
        playerId: PLAYER_B,
        name: "ANIFE",
        gamerTag: "ANIFE",
        pos: 4,
        played: 5,
        wins: 3,
        draws: 0,
        losses: 2,
        gf: 9,
        ga: 6,
        gd: 3,
        pts: 9,
        winProbPct: 0.376, // fraction
        drawProbPct: 0.20,
      },
    ]);

    const res = await GET(mkReq({ ids: `${PLAYER_A},${PLAYER_B}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seasonId).toBe(SEASON_ID);
    expect(body.cards).toHaveLength(2);
    // Wire-shape contract: integer percent in [0..100] (NOT a fraction).
    expect(body.cards[0].winProbPct).toBe(62);
    expect(body.cards[1].winProbPct).toBe(38);
    // Other fields preserved.
    expect(body.cards[0].name).toBe("FARUK");
    expect(body.cards[0].played).toBe(5);
    expect(body.cards[0].pts).toBe(13);
    expect(buildH2HCardsMock).toHaveBeenCalledWith(expect.anything(), SEASON_ID, [
      PLAYER_A,
      PLAYER_B,
    ]);
  });

  it("returns 500 when buildH2HCards throws", async () => {
    getServerSupabaseMock.mockResolvedValue(mkAuthedUserClient());
    hasPermAsyncMock.mockResolvedValue(true);
    getActiveSeasonMock.mockResolvedValue({ id: SEASON_ID });
    buildH2HCardsMock.mockRejectedValue(new Error("standings read failed"));

    const res = await GET(mkReq({ ids: PLAYER_A }));
    expect(res.status).toBe(500);
  });
});
