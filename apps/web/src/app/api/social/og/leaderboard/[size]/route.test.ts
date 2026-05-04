/**
 * Plan 54 — Wave 2A integration smoke for the leaderboard `next/og` route.
 *
 * The route runs on the Edge runtime; vitest runs under jsdom + a Node
 * harness, so we can't drive `ImageResponse` directly. We mock:
 *  - `next/og` → a minimal `ImageResponse` shim that records dimensions +
 *    fonts + content-type, so we can assert the route asks for the
 *    correct width/height without spinning up Satori.
 *  - `@/server/social/og-route-helpers::ogPreflight` → returns a typed
 *    `Ok` shape so we don't need to wire a full Supabase mock.
 *  - `@/server/social/data::fetchLeaderboardPayload` → returns a shape
 *    compatible with the JSX. The route's body code path never sees
 *    `next/og`'s renderer in the test — it just builds the JSX tree
 *    and hands it to our shim, which is enough to verify the route's
 *    width/height/fonts/headers are correct.
 *  - `@/server/social/og-shared::loadFonts` → returns 5 dummy
 *    ArrayBuffers; the route maps over them.
 *
 * Verified branches (kept narrow — Wave 1B already exercises the OG
 * components in detail; this file owns the route plumbing):
 *   1. happy path → 200 with content-type image/png, width × height
 *      matching the requested 1080x1920.
 *   2. happy path 1080x1080 → uses the square dimensions.
 *   3. happy path 1200x675 → uses the landscape dimensions.
 *   4. invalid size param → 400.
 *   5. missing session param → 400 (via ogPreflight).
 *   6. ogPreflight failure surfaced verbatim.
 *   7. fetchLeaderboardPayload throw → 500.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  ogPreflightMock,
  fetchLeaderboardPayloadMock,
  loadFontsMock,
  imageResponseSpy,
} = vi.hoisted(() => ({
  ogPreflightMock: vi.fn(),
  fetchLeaderboardPayloadMock: vi.fn(),
  loadFontsMock: vi.fn(),
  imageResponseSpy: vi.fn(),
}));

// Minimal ImageResponse shim. Captures width/height/fonts/headers so the
// test can assert them, and returns a Response with content-type image/png.
// The class is defined inside the mock factory so vi.mock's hoisting
// doesn't trip over the class binding (vi.mock hoists ABOVE imports, but
// vi.hoisted's spy ref is fine because it comes from a plain object).
vi.mock("next/og", () => {
  class FakeImageResponse extends Response {
    constructor(_node: unknown, init?: {
      width?: number;
      height?: number;
      fonts?: unknown[];
      headers?: Record<string, string>;
    }) {
      imageResponseSpy(init);
      super("PNG_BYTES", {
        status: 200,
        headers: {
          "content-type": "image/png",
          ...(init?.headers ?? {}),
        },
      });
    }
  }
  return { ImageResponse: FakeImageResponse };
});

vi.mock("@/server/social/og-route-helpers", () => ({
  ogPreflight: ogPreflightMock,
  OG_CACHE_HEADER:
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
}));

vi.mock("@/server/social/data", () => ({
  fetchLeaderboardPayload: fetchLeaderboardPayloadMock,
}));

vi.mock("@/server/social/og-shared", async () => {
  // Import the real module to keep <Wrapper> / <BrandHeader> etc. functioning
  // (they're plain React components — no Edge-only APIs). Override loadFonts
  // so the route doesn't try to fetch over the network in the test.
  const actual = await vi.importActual<
    typeof import("@/server/social/og-shared")
  >("@/server/social/og-shared");
  return { ...actual, loadFonts: loadFontsMock };
});

import { GET } from "./route";

const SESSION_ID = "11111111-1111-1111-1111-111111111111";

const SAMPLE_PAYLOAD = {
  seasonId: "season-1",
  matchDayId: "md-1",
  weekLabel: "Sunday May 4th, 2026",
  rows: [
    {
      pos: 1,
      name: "FARUK",
      slug: "FARUK",
      mp: 6,
      w: 5,
      l: 0,
      d: 1,
      g: 18,
      gd: 12,
      pts: 16,
      photoUrl: null,
    },
    {
      pos: 2,
      name: "ANIFE",
      slug: "ANIFE",
      mp: 6,
      w: 4,
      l: 1,
      d: 1,
      g: 14,
      gd: 8,
      pts: 13,
      photoUrl: null,
    },
    {
      pos: 3,
      name: "MITCH",
      slug: "MITCH",
      mp: 6,
      w: 4,
      l: 2,
      d: 0,
      g: 12,
      gd: 4,
      pts: 12,
      photoUrl: null,
    },
    {
      pos: 4,
      name: "ADEFOLA",
      slug: "ADEFOLA",
      mp: 6,
      w: 3,
      l: 2,
      d: 1,
      g: 10,
      gd: 2,
      pts: 10,
      photoUrl: null,
    },
    {
      pos: 5,
      name: "GURU",
      slug: "GURU",
      mp: 6,
      w: 2,
      l: 3,
      d: 1,
      g: 9,
      gd: -1,
      pts: 7,
      photoUrl: null,
    },
  ],
};

function makeBuffer(label: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(label.padEnd(8, "_").slice(0, 8));
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

const DEFAULT_FONTS = [
  { name: "Agharti", data: makeBuffer("ag-b"), weight: 700, style: "normal" },
  { name: "Agharti", data: makeBuffer("ag-bk"), weight: 900, style: "normal" },
  { name: "Quedora", data: makeBuffer("qd-r"), weight: 400, style: "normal" },
  { name: "Quedora", data: makeBuffer("qd-m"), weight: 500, style: "normal" },
  { name: "Quedora", data: makeBuffer("qd-b"), weight: 700, style: "normal" },
];

beforeEach(() => {
  ogPreflightMock.mockReset();
  fetchLeaderboardPayloadMock.mockReset();
  loadFontsMock.mockReset();
  imageResponseSpy.mockReset();
  loadFontsMock.mockResolvedValue(DEFAULT_FONTS);
});

function mkReq(size: string): Request {
  return new Request(
    `https://example.com/api/social/og/leaderboard/${size}?session=${SESSION_ID}`,
  );
}

function mkParams(size: string): Promise<{ size: string }> {
  return Promise.resolve({ size });
}

describe("GET /api/social/og/leaderboard/[size]", () => {
  it("returns 200 + content-type image/png at 1080x1920 dimensions", async () => {
    ogPreflightMock.mockResolvedValue({
      ok: true,
      size: "1080x1920",
      sessionId: SESSION_ID,
      sb: {} as object,
      origin: "https://example.com",
    });
    fetchLeaderboardPayloadMock.mockResolvedValue(SAMPLE_PAYLOAD);

    const res = await GET(mkReq("1080x1920"), { params: mkParams("1080x1920") });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(imageResponseSpy).toHaveBeenCalledTimes(1);
    const init = imageResponseSpy.mock.calls[0][0];
    expect(init?.width).toBe(1080);
    expect(init?.height).toBe(1920);
    // 5 fonts mapped through (Agharti × 2 + Quedora × 3).
    expect(init?.fonts?.length).toBe(5);
    expect(init?.headers?.["Cache-Control"]).toContain("s-maxage=60");
  });

  it("returns 200 at 1080x1080 dimensions", async () => {
    ogPreflightMock.mockResolvedValue({
      ok: true,
      size: "1080x1080",
      sessionId: SESSION_ID,
      sb: {} as object,
      origin: "https://example.com",
    });
    fetchLeaderboardPayloadMock.mockResolvedValue(SAMPLE_PAYLOAD);

    const res = await GET(mkReq("1080x1080"), { params: mkParams("1080x1080") });

    expect(res.status).toBe(200);
    const init = imageResponseSpy.mock.calls[0][0];
    expect(init?.width).toBe(1080);
    expect(init?.height).toBe(1080);
  });

  it("returns 200 at 1200x675 dimensions (landscape branch)", async () => {
    ogPreflightMock.mockResolvedValue({
      ok: true,
      size: "1200x675",
      sessionId: SESSION_ID,
      sb: {} as object,
      origin: "https://example.com",
    });
    fetchLeaderboardPayloadMock.mockResolvedValue(SAMPLE_PAYLOAD);

    const res = await GET(mkReq("1200x675"), { params: mkParams("1200x675") });

    expect(res.status).toBe(200);
    const init = imageResponseSpy.mock.calls[0][0];
    expect(init?.width).toBe(1200);
    expect(init?.height).toBe(675);
  });

  it("returns the preflight error response verbatim when size is invalid", async () => {
    // The real preflight is mocked, so simulate an Err result here.
    ogPreflightMock.mockResolvedValue({
      ok: false,
      response: new Response(`Unknown social size "999x999".`, { status: 400 }),
    });

    const res = await GET(mkReq("999x999"), { params: mkParams("999x999") });

    expect(res.status).toBe(400);
    expect(imageResponseSpy).not.toHaveBeenCalled();
  });

  it("returns the preflight error response verbatim when session is missing", async () => {
    ogPreflightMock.mockResolvedValue({
      ok: false,
      response: new Response("missing session param", { status: 400 }),
    });

    const res = await GET(
      new Request("https://example.com/api/social/og/leaderboard/1080x1920"),
      { params: mkParams("1080x1920") },
    );

    expect(res.status).toBe(400);
  });

  it("returns the preflight error response verbatim on auth failure", async () => {
    ogPreflightMock.mockResolvedValue({
      ok: false,
      response: new Response("invalid_token", { status: 401 }),
    });

    const res = await GET(mkReq("1080x1920"), { params: mkParams("1080x1920") });

    expect(res.status).toBe(401);
  });

  it("returns 500 when the data fetcher throws", async () => {
    ogPreflightMock.mockResolvedValue({
      ok: true,
      size: "1080x1920",
      sessionId: SESSION_ID,
      sb: {} as object,
      origin: "https://example.com",
    });
    fetchLeaderboardPayloadMock.mockRejectedValue(new Error("standings down"));

    const res = await GET(mkReq("1080x1920"), { params: mkParams("1080x1920") });

    expect(res.status).toBe(500);
    expect(imageResponseSpy).not.toHaveBeenCalled();
  });

  it("falls back gracefully when leaderboard returns empty rows", async () => {
    ogPreflightMock.mockResolvedValue({
      ok: true,
      size: "1080x1920",
      sessionId: SESSION_ID,
      sb: {} as object,
      origin: "https://example.com",
    });
    fetchLeaderboardPayloadMock.mockResolvedValue({
      ...SAMPLE_PAYLOAD,
      rows: [],
    });

    const res = await GET(mkReq("1080x1920"), { params: mkParams("1080x1920") });

    expect(res.status).toBe(200);
    const init = imageResponseSpy.mock.calls[0][0];
    expect(init?.width).toBe(1080);
    expect(init?.height).toBe(1920);
  });
});
