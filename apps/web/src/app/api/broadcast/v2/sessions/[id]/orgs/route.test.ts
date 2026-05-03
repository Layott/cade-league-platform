import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Plan 51 §6 — `/api/broadcast/v2/sessions/[id]/orgs` route tests.
 *
 * The route is publicly readable (view-token gated) and consumed as the
 * initial-state feed for the `/overlay/v2/15-orgs` browser source.
 *
 * 2026-04-28 — Bug #24 column-name fix. The previous implementation
 * referenced non-existent columns on `public.players`:
 *   - `org_id`         → actual column is `organization_id`
 *   - `display_name`   → lives on `public.users`, not `players`
 *   - `avatar_url`     → no such column; manifest-derived from gamer_tag
 * The typed `.select()` silently returned zero rows on prod, so every
 * org rendered with `players: []` and `logoUrl: null`. These tests lock
 * the canonical shape so the regression cannot recur.
 */

const {
  enforcePublicReadMock,
  getServiceRoleSupabaseMock,
  checkViewTokenMock,
  resolvePlayerPoseMock,
} = vi.hoisted(() => ({
  enforcePublicReadMock: vi.fn(),
  getServiceRoleSupabaseMock: vi.fn(),
  checkViewTokenMock: vi.fn(),
  resolvePlayerPoseMock: vi.fn(),
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
// Plan 53 (2026-05-04) — route now imports `gamerTagToSlug` (real) +
// `resolvePlayerPose` (mocked, deterministic pose 1) +
// `buildPhotoUrl` / `getVariantKindForOverlay` (real, just URL math).
vi.mock("@/server/overlays/player-photos/resolver", () => ({
  resolvePlayerPose: resolvePlayerPoseMock,
}));

import { GET } from "./route";

const SESSION_ID = "11111111-1111-1111-1111-111111111111";
const MATCH_DAY_ID = "22222222-2222-2222-2222-222222222222";
const SEASON_ID = "33333333-3333-3333-3333-333333333333";
const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PLAYER_1 = "11111111-1111-4111-8111-111111111111";
const PLAYER_2 = "22222222-2222-4222-8222-222222222222";
const PLAYER_3 = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  enforcePublicReadMock.mockReset().mockResolvedValue(null);
  getServiceRoleSupabaseMock.mockReset();
  checkViewTokenMock.mockReset();
  // Plan 53 (2026-05-04) — return manifest pose 1 so the URL builder
  // produces the same path the previous `getPlayerAvatarUrl` produced
  // (manifest, headshot, pose 01) for unchanged assertion shapes.
  resolvePlayerPoseMock
    .mockReset()
    .mockResolvedValue({ poseIndex: 1, source: "manifest" });
});

/**
 * Build a Supabase client mock that handles the chains the route uses:
 *
 *   stream_sessions → select(id, match_day_id).eq().is().maybeSingle()
 *   match_days      → select(season_id).eq().maybeSingle()
 *   organizations   → select(id, name, logo_url).is()
 *   players         → select(...).in(organization_id, [..]).is()
 *
 * Captures the column list passed to each `.select()` so tests can
 * assert the canonical column names are used (Bug #24 regression).
 */
function mkSb(opts: {
  session?: { id: string; match_day_id: string | null } | null;
  matchDay?: { season_id: string } | null;
  orgs?: Array<{ id: string; name: string; logo_url: string | null }>;
  orgsErr?: { code?: string; message?: string } | null;
  players?: Array<{
    id: string;
    gamer_tag: string | null;
    organization_id: string;
    users: { display_name: string | null } | null;
  }>;
  playersErr?: { code?: string; message?: string } | null;
}) {
  const sessionMaybe = vi.fn().mockResolvedValue({
    data: opts.session === undefined ? null : opts.session,
    error: null,
  });
  const matchDayMaybe = vi.fn().mockResolvedValue({
    data: opts.matchDay === undefined ? null : opts.matchDay,
    error: null,
  });
  const orgsIs = vi.fn().mockResolvedValue({
    data: opts.orgs ?? [],
    error: opts.orgsErr ?? null,
  });
  const playersInIs = vi.fn().mockResolvedValue({
    data: opts.players ?? [],
    error: opts.playersErr ?? null,
  });

  // Capture the args passed to .select() + .in() so tests can assert
  // canonical column names + filter columns.
  const playersSelectArg = vi.fn();
  const playersInArg = vi.fn();
  const orgsSelectArg = vi.fn();

  const sb = {
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
            eq: vi.fn(() => ({ maybeSingle: matchDayMaybe })),
          })),
        };
      }
      if (table === "organizations") {
        return {
          select: vi.fn((cols: string) => {
            orgsSelectArg(cols);
            return { is: orgsIs };
          }),
        };
      }
      if (table === "players") {
        return {
          select: vi.fn((cols: string) => {
            playersSelectArg(cols);
            return {
              in: vi.fn((col: string, vals: unknown[]) => {
                playersInArg(col, vals);
                return { is: playersInIs };
              }),
            };
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    _captures: {
      orgsSelectArg,
      playersSelectArg,
      playersInArg,
    },
  };
  return sb;
}

function mkReq(query: Record<string, string> = {}): NextRequest {
  const params = new URLSearchParams(query);
  const url = `https://example.com/api/broadcast/v2/sessions/${SESSION_ID}/orgs?${params.toString()}`;
  return new NextRequest(url);
}

describe("GET /api/broadcast/v2/sessions/[id]/orgs", () => {
  it("returns 401 when view-token gate fails", async () => {
    checkViewTokenMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "invalid_token" }, { status: 401 }),
    });
    getServiceRoleSupabaseMock.mockReturnValue(mkSb({}));
    const res = await GET(mkReq(), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when session not found", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(mkSb({ session: null }));
    const res = await GET(mkReq(), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/session/i);
  });

  it("returns 404 when match_day not found", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: null,
      }),
    );
    const res = await GET(mkReq(), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns empty orgs when organizations table has no rows", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { season_id: SEASON_ID },
        orgs: [],
      }),
    );
    const res = await GET(mkReq(), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payload.orgs).toEqual([]);
    expect(body.seasonId).toBe(SEASON_ID);
  });

  it("Bug-24 regression — uses canonical column names (organization_id, NOT org_id)", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    const sb = mkSb({
      session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
      matchDay: { season_id: SEASON_ID },
      orgs: [{ id: ORG_A, name: "CADE Esports", logo_url: "/orgs/cade.png" }],
      players: [
        {
          id: PLAYER_1,
          gamer_tag: "ADEFOLA",
          organization_id: ORG_A,
          users: { display_name: "Adefola" },
        },
      ],
    });
    getServiceRoleSupabaseMock.mockReturnValue(sb);

    const res = await GET(mkReq(), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);

    // Bug #24 lock: filter MUST be `organization_id` (the canonical
    // column on public.players), NOT `org_id`.
    expect(sb._captures.playersInArg).toHaveBeenCalledWith("organization_id", [ORG_A]);

    // Bug #24 lock: select MUST embed `users:users!players_user_id_fkey
    // ( display_name )` (the canonical embed pattern). It must NOT
    // reference a `display_name` or `avatar_url` column on `players`.
    const selectArg = sb._captures.playersSelectArg.mock.calls[0]?.[0] ?? "";
    expect(selectArg).toMatch(/organization_id/);
    expect(selectArg).toMatch(/users!players_user_id_fkey/);
    expect(selectArg).not.toMatch(/players\.display_name/);
    expect(selectArg).not.toMatch(/avatar_url/);
    // The select MUST NOT mention a literal `org_id` token (would
    // resurrect the bug). Allow `organization_id` to contain "org_id"
    // as a substring — guard against the literal `, org_id` field.
    expect(selectArg).not.toMatch(/(?:^|[\s,])org_id(?:[\s,]|$)/);
  });

  it("returns populated orgs + players when DB is healthy", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { season_id: SEASON_ID },
        orgs: [
          { id: ORG_A, name: "CADE Esports", logo_url: "/orgs/cade.png" },
          { id: ORG_B, name: "GameEvo Esports", logo_url: null },
        ],
        players: [
          {
            id: PLAYER_1,
            gamer_tag: "ADEFOLA",
            organization_id: ORG_A,
            users: { display_name: "Adefola" },
          },
          {
            id: PLAYER_2,
            gamer_tag: "ANIFE",
            organization_id: ORG_A,
            users: { display_name: "Anife" },
          },
          {
            id: PLAYER_3,
            gamer_tag: "BAJI_JNR",
            organization_id: ORG_B,
            users: { display_name: "Baji Jnr" },
          },
        ],
      }),
    );

    const res = await GET(mkReq(), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payload.orgs).toHaveLength(2);

    const orgA = body.payload.orgs.find((o: { id: string }) => o.id === ORG_A);
    expect(orgA.name).toBe("CADE Esports");
    expect(orgA.logoUrl).toBe("/orgs/cade.png");
    expect(orgA.players).toHaveLength(2);
    expect(orgA.players[0]).toEqual({
      playerId: PLAYER_1,
      displayName: "Adefola",
      gamerTag: "ADEFOLA",
      avatarUrl: "/overlays/v2/_assets/players/processed/adefola/headshot_01_nobg.png",
    });

    const orgB = body.payload.orgs.find((o: { id: string }) => o.id === ORG_B);
    expect(orgB.logoUrl).toBeNull();
    expect(orgB.players).toHaveLength(1);
    expect(orgB.players[0].displayName).toBe("Baji Jnr");
    expect(orgB.players[0].gamerTag).toBe("BAJI_JNR");
  });

  it("falls back to gamer_tag when users.display_name is null", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { season_id: SEASON_ID },
        orgs: [{ id: ORG_A, name: "CADE Esports", logo_url: null }],
        players: [
          {
            id: PLAYER_1,
            gamer_tag: "FARUK",
            organization_id: ORG_A,
            users: null, // join missing
          },
        ],
      }),
    );

    const res = await GET(mkReq(), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    const body = await res.json();
    expect(body.payload.orgs[0].players[0].displayName).toBe("FARUK");
  });

  it("returns empty orgs when players read errors out (degraded mode)", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { season_id: SEASON_ID },
        orgs: [{ id: ORG_A, name: "CADE Esports", logo_url: null }],
        playersErr: { code: "42703", message: "column does not exist" },
      }),
    );

    const res = await GET(mkReq(), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Org is still returned with empty players array — overlay HTML
    // can render its own placeholder copy.
    expect(body.payload.orgs).toHaveLength(1);
    expect(body.payload.orgs[0].players).toEqual([]);
  });

  it("includes orgs with zero players (e.g. dissolved roster)", async () => {
    checkViewTokenMock.mockResolvedValue({ ok: true, response: null });
    getServiceRoleSupabaseMock.mockReturnValue(
      mkSb({
        session: { id: SESSION_ID, match_day_id: MATCH_DAY_ID },
        matchDay: { season_id: SEASON_ID },
        orgs: [
          { id: ORG_A, name: "CADE Esports", logo_url: "/orgs/cade.png" },
          { id: ORG_B, name: "Empty Roster Org", logo_url: null },
        ],
        players: [
          {
            id: PLAYER_1,
            gamer_tag: "ADEFOLA",
            organization_id: ORG_A,
            users: { display_name: "Adefola" },
          },
        ],
      }),
    );

    const res = await GET(mkReq(), {
      params: Promise.resolve({ id: SESSION_ID }),
    });
    const body = await res.json();
    const orgB = body.payload.orgs.find((o: { id: string }) => o.id === ORG_B);
    expect(orgB.players).toEqual([]);
  });
});
