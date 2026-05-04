/**
 * Tests for og-shared building blocks. We can't render `next/og`'s
 * `ImageResponse` directly under jsdom (it's an Edge-runtime API), so we test
 * each piece at its API boundary:
 *  - `loadFonts` — mocked `fetch`, asserts buffer count + names + cache.
 *  - Components — render via `react-dom/server.renderToStaticMarkup` and
 *    assert structural attributes (width, height, asset URLs, brand strings).
 *
 * We deliberately keep these as plain string-shape assertions instead of
 * snapshot files: the inline-style strings in og-shared are load-bearing for
 * Satori's layout, and snapshot diffs would be noisy whenever a brand token
 * shifts.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRAND,
  BrandHeader,
  SponsorRow,
  TitleBlock,
  Wrapper,
  _resetFontCache,
  loadFonts,
} from "./og-shared";

// helper — turn an arbitrary string into a 16-byte ArrayBuffer for mock fetch
function makeBuffer(label: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(label.padEnd(16, "_").slice(0, 16));
  // copy into a fresh ArrayBuffer to avoid SharedArrayBuffer typing weirdness
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

describe("loadFonts", () => {
  beforeEach(() => {
    _resetFontCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 5 font entries (Agharti Bold/Black + Quedora Regular/Medium/Bold)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => makeBuffer(url),
        } as unknown as Response;
      }),
    );

    const fonts = await loadFonts("https://example.test");

    // 2 Agharti + 3 Quedora variants = 5 entries (covers spec's "4+" requirement)
    expect(fonts.length).toBeGreaterThanOrEqual(4);
    expect(fonts.length).toBe(5);

    const aghartiCount = fonts.filter((f) => f.name === "Agharti").length;
    const quedoraCount = fonts.filter((f) => f.name === "Quedora").length;
    expect(aghartiCount).toBe(2);
    expect(quedoraCount).toBe(3);

    // Each entry has a non-empty ArrayBuffer + a valid weight + style 'normal'
    for (const f of fonts) {
      expect(f.data).toBeInstanceOf(ArrayBuffer);
      expect(f.data.byteLength).toBeGreaterThan(0);
      expect([400, 500, 700, 900]).toContain(f.weight);
      expect(f.style).toBe("normal");
    }

    // All 5 fetches should hit the example.test origin
    for (const c of calls) {
      expect(c.startsWith("https://example.test/")).toBe(true);
      // Satori-friendly extensions only — WOFF2 is unsupported, see
      // og-shared.tsx FONT_MANIFEST. Allow .ttf or .woff (NOT .woff2).
      expect(/\.(ttf|woff|otf)$/.test(c)).toBe(true);
    }
  });

  it("caches buffers — second call does not refetch", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => makeBuffer(url),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    await loadFonts("https://example.test");
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(callsAfterFirst).toBe(5);

    await loadFonts("https://example.test");
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // no new calls
  });

  it("strips trailing slashes from origin", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => makeBuffer(url),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    await loadFonts("https://example.test///");
    for (const call of fetchMock.mock.calls) {
      const url = call[0] as string;
      expect(url).not.toContain("test///");
      expect(url.startsWith("https://example.test/")).toBe(true);
    }
  });

  it("throws a descriptive error when fetch returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response)),
    );

    await expect(loadFonts("https://example.test")).rejects.toThrow(
      /loadFonts.*404 Not Found/,
    );
  });
});

describe("BRAND tokens", () => {
  it("exposes the brand palette used by the OG components", () => {
    expect(BRAND.green).toBe("#6bcd06");
    expect(BRAND.pink).toBe("#fe036d");
    expect(BRAND.black).toBe("#050505");
    expect(BRAND.white).toBe("#ffffff");
  });
});

describe("<Wrapper>", () => {
  it("renders 1080×1920 frame with the requested dimensions inline", () => {
    const html = renderToStaticMarkup(
      React.createElement(Wrapper, { size: "1080x1920" }, "x"),
    );
    expect(html).toContain("width:1080px");
    expect(html).toContain("height:1920px");
  });

  it("renders 1080×1080 frame with square dimensions", () => {
    const html = renderToStaticMarkup(
      React.createElement(Wrapper, { size: "1080x1080" }, "x"),
    );
    expect(html).toContain("width:1080px");
    expect(html).toContain("height:1080px");
  });

  it("renders 1200×675 frame with X dimensions", () => {
    const html = renderToStaticMarkup(
      React.createElement(Wrapper, { size: "1200x675" }, "x"),
    );
    expect(html).toContain("width:1200px");
    expect(html).toContain("height:675px");
  });

  it("includes the pink→green accent bar", () => {
    const html = renderToStaticMarkup(
      React.createElement(Wrapper, { size: "1080x1080" }, "x"),
    );
    // Brand pink + green appear in the linear-gradient on the accent bar
    expect(html.toLowerCase()).toContain("#fe036d");
    expect(html.toLowerCase()).toContain("#6bcd06");
  });
});

describe("<BrandHeader>", () => {
  it("references the cade + pro league logo paths from the v2 overlay mirror", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrandHeader, { size: "1080x1920" }),
    );
    expect(html).toContain("/overlays/v2/_assets/logos/processed/");
    expect(html.toLowerCase()).toContain("1cade%20esport_strip.png");
    expect(html.toLowerCase()).toContain("pro%20league%20_strip.png");
  });
});

describe("<SponsorRow>", () => {
  it("renders all 5 sponsors in the documented order", () => {
    const html = renderToStaticMarkup(
      React.createElement(SponsorRow, { size: "1080x1920" }),
    );
    const order = [
      "GameEvo",
      "OAS",
      "Gamepride",
      "ESPORTS%20AFRICA%20NEWS",
      "TRACE",
    ];
    let cursor = 0;
    for (const needle of order) {
      const idx = html.indexOf(needle, cursor);
      expect(idx, `expected "${needle}" after position ${cursor}`).toBeGreaterThanOrEqual(0);
      cursor = idx + needle.length;
    }
  });

  it("uses no-bg _strip.png variants so logos layer over dark bg", () => {
    const html = renderToStaticMarkup(
      React.createElement(SponsorRow, { size: "1200x675" }),
    );
    // 5 sponsors × _strip.png — count distinct <img src=...> occurrences only.
    // (React 19 `renderToStaticMarkup` also auto-emits a <link rel="preload"
    // href="..."> for every <img>, so the bare URL appears twice in the
    // output. Match against the `src=` form to count <img> elements.)
    const imgMatches = html.match(/<img[^>]*src="[^"]*_strip\.png/g);
    expect(imgMatches).not.toBeNull();
    expect((imgMatches as RegExpMatchArray).length).toBe(5);
  });
});

describe("<TitleBlock>", () => {
  it("renders title text in uppercase-ready Agharti styling", () => {
    const html = renderToStaticMarkup(
      React.createElement(TitleBlock, {
        title: "LEADERBOARD",
        subtitle: "WEEK 2",
        dateText: "MAY 4, 2026",
      }),
    );
    expect(html).toContain("LEADERBOARD");
    expect(html).toContain("WEEK 2");
    expect(html).toContain("MAY 4, 2026");
    expect(html).toContain("Agharti");
    expect(html).toContain("Quedora");
  });

  it("renders without subtitle or date when those props are omitted", () => {
    const html = renderToStaticMarkup(
      React.createElement(TitleBlock, { title: "TOP SCORERS" }),
    );
    expect(html).toContain("TOP SCORERS");
    // The subtitle div uses pink — without subtitle prop, no pink color span
    // (the wrapper / title still uses green/white only)
    const pinkOccurrences = (html.match(/#fe036d/gi) || []).length;
    expect(pinkOccurrences).toBe(0);
  });

  it("uses gradient-faking text-shadow stack instead of -webkit-background-clip", () => {
    const html = renderToStaticMarkup(
      React.createElement(TitleBlock, { title: "X" }),
    );
    // Confirm we did NOT use the Satori-incompatible property
    expect(html).not.toContain("background-clip:text");
    expect(html).not.toContain("-webkit-background-clip");
    // Confirm we DID use stacked text-shadows
    expect(html).toContain("text-shadow");
    // Cyan fill + green ground-shadow = the green→cyan gradient fake
    expect(html.toLowerCase()).toContain("#4ee0c4");
    expect(html.toLowerCase()).toContain("#357500");
  });
});
