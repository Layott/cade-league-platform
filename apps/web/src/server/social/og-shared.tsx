/**
 * Shared building blocks for `next/og` `ImageResponse` rendering of
 * social-media static assets. Plan 54 Phase 1.
 *
 * IMPORTANT — Edge runtime constraints:
 *  - `next/og` runs on the Edge runtime. NO `node:fs`, NO `node:path`. Fonts
 *    must be fetched via `fetch()` against a public URL on the deployed origin
 *    OR loaded as static `ArrayBuffer`s.
 *  - `next/og` does NOT support `-webkit-background-clip: text`. Gradient text
 *    is faked here via stacked text-shadows + a translucent fill (cleaner than
 *    SVG `<mask>` once you control letter-spacing).
 *  - Asset paths must be served by Next at runtime — KNOWLEDGE/* is NOT served,
 *    only `apps/web/public/...`. We use the existing public mirrors.
 *  - `<img>` is REQUIRED here — Satori (the renderer behind `next/og`) does
 *    NOT understand `next/image`'s component model. The `no-img-element` lint
 *    rule is suppressed file-wide for that reason.
 *
 * Layered usage by an OG route handler:
 *   <Wrapper size="1080x1920">
 *     <BrandHeader size="1080x1920" />
 *     <TitleBlock subtitle="WEEK 2" title="LEADERBOARD" dateText="MAY 4, 2026" />
 *     {...content}
 *     <SponsorRow size="1080x1920" />
 *   </Wrapper>
 *
 * Spec ref: docs/superpowers/specs/2026-05-05-broadcast-social-media.md
 */
/* eslint-disable @next/next/no-img-element */

import type { ReactElement } from "react";

import type { SocialSize } from "@/lib/social-sizes";

// ----- brand tokens (locked, see CLAUDE.md §"Brand") --------------------------

export const BRAND = {
  green: "#6bcd06",
  greenBright: "#a4ff1a",
  greenDeep: "#357500",
  pink: "#fe036d",
  black: "#050505",
  inkDark: "#0e0e0e",
  white: "#ffffff",
} as const;

// ----- font loader ------------------------------------------------------------

/**
 * Public URLs for the brand fonts. These resolve against `apps/web/public/`
 * which we mirror in `social/fonts/` so the URLs are clean (no spaces, no
 * deep `_assets/...` nesting). Source files are duplicated from
 * `public/overlays/v2/_assets/fonts/...` deliverables.
 *
 * Each entry maps to a `next/og` `FontOptions` record (name + weight + style).
 */
const FONT_MANIFEST: ReadonlyArray<{
  url: string;
  name: "Agharti" | "Quedora";
  weight: 400 | 500 | 700 | 900;
  style: "normal";
}> = [
  // Satori (the renderer behind `next/og`) does NOT support WOFF2 — it
  // throws "Unsupported OpenType signature wOF2". Use TTF copies of the
  // same brand fonts; both files exist side-by-side in `public/social/fonts/`.
  { url: "/social/fonts/Agharti-Bold.ttf", name: "Agharti", weight: 700, style: "normal" },
  { url: "/social/fonts/Agharti-Black.ttf", name: "Agharti", weight: 900, style: "normal" },
  { url: "/social/fonts/Quedora-Regular.ttf", name: "Quedora", weight: 400, style: "normal" },
  { url: "/social/fonts/Quedora-Medium.ttf", name: "Quedora", weight: 500, style: "normal" },
  { url: "/social/fonts/Quedora-Bold.ttf", name: "Quedora", weight: 700, style: "normal" },
];

/**
 * In-memory cache of fetched font ArrayBuffers, keyed by absolute URL. Avoids
 * refetching on every OG render. Survives the lifetime of an Edge worker
 * instance.
 */
const fontBufferCache = new Map<string, ArrayBuffer>();

export type LoadedFont = {
  name: "Agharti" | "Quedora";
  data: ArrayBuffer;
  weight: 400 | 500 | 700 | 900;
  style: "normal";
};

/**
 * Loads all brand fonts as `ArrayBuffer`s suitable for `ImageResponse({ fonts })`.
 *
 * @param origin — base URL the OG handler is running under. Pass
 *   `new URL(request.url).origin` from the route handler. Required because
 *   Edge runtime has no notion of "the deployed origin" without an inbound
 *   request to anchor against.
 */
export async function loadFonts(origin: string): Promise<LoadedFont[]> {
  const base = origin.replace(/\/+$/, "");
  const out: LoadedFont[] = [];
  for (const entry of FONT_MANIFEST) {
    const absolute = `${base}${entry.url}`;
    let buf = fontBufferCache.get(absolute);
    if (!buf) {
      const res = await fetch(absolute);
      if (!res.ok) {
        throw new Error(
          `loadFonts: failed to fetch ${absolute} — ${res.status} ${res.statusText}`,
        );
      }
      buf = await res.arrayBuffer();
      fontBufferCache.set(absolute, buf);
    }
    out.push({ name: entry.name, data: buf, weight: entry.weight, style: entry.style });
  }
  return out;
}

/**
 * Test-only — clear the in-memory font cache. Exposed so tests can re-exercise
 * the fetch path between cases. NOT part of the runtime API.
 */
export function _resetFontCache(): void {
  fontBufferCache.clear();
}

// ----- size-aware spacing -----------------------------------------------------

/**
 * Padding scale per preset. Portrait gets generous side padding for the safe
 * zone IG renders below the swipe-up area; X landscape gets tighter sides.
 */
function paddingFor(size: SocialSize): { top: number; side: number; bottom: number } {
  switch (size) {
    case "1080x1920":
      return { top: 64, side: 56, bottom: 96 };
    case "1080x1080":
      return { top: 56, side: 56, bottom: 56 };
    case "1200x675":
      return { top: 36, side: 56, bottom: 36 };
  }
}

// ----- <Wrapper> --------------------------------------------------------------

export type WrapperProps = {
  size: SocialSize;
  origin?: string;
  children: React.ReactNode;
};

/**
 * Root frame. Halftone-stadium bg image + size-aware padding. Brand-locked.
 * `<img>` layer is required because Satori does NOT honor CSS
 * `background-image` URLs.
 *
 * The bg image at `/social/bg.png` is the green halftone-stadium asset
 * (ELITE S2 BG.png) — same source as the stream overlays so all surfaces
 * read as one brand. Pass `origin` for absolute URL prefixing.
 */
export function Wrapper({ size, origin, children }: WrapperProps): ReactElement {
  const pad = paddingFor(size);
  const { width, height } = parseDims(size);
  const base = (origin ?? "").replace(/\/+$/, "");
  return (
    <div
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: `${pad.top}px ${pad.side}px ${pad.bottom}px`,
        background: BRAND.black,
        color: BRAND.white,
        fontFamily: "Quedora, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* BG image layer — halftone-stadium green */}
      <img
        src={`${base}/social/bg.png`}
        alt=""
        width={width}
        height={height}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${width}px`,
          height: `${height}px`,
          objectFit: "cover",
          zIndex: 0,
        }}
      />
      {/* Vignette darken — helps content legibility on busy halftone */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${width}px`,
          height: `${height}px`,
          background: `linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.20) 35%, rgba(0,0,0,0.55) 100%)`,
          zIndex: 1,
          display: "flex",
        }}
      />
      {/* Pink-to-green diagonal accent bar, top edge */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${width}px`,
          height: "4px",
          background: `linear-gradient(90deg, ${BRAND.pink}, ${BRAND.green})`,
          zIndex: 3,
          display: "flex",
        }}
      />
      {/* Content stack — z above bg + vignette */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ----- <SideBrackets> ---------------------------------------------------------

/**
 * Decorative chevron-bracket marks down both side edges. Mirrors the
 * brand poster style (see KaykayPlayerOfWeek + ParticipatingPlayers
 * reference). 3 stacked chevrons per side, mid-height, 0.5 opacity.
 *
 * Pure CSS triangles via stacked rectangles — no SVG (Satori's mask
 * pipeline is fragile + the chevrons are simple geometry).
 */
export function SideBrackets({ size }: { size: SocialSize }): ReactElement | null {
  const { width, height } = parseDims(size);
  // Skip on the X landscape layout — sides are too narrow to read.
  if (size === "1200x675") return null;
  const top = Math.round(height * 0.45);
  const gap = 36;
  const w = 38;
  const stroke = 4;
  const slash = (
    <div
      style={{
        width: `${w}px`,
        height: "26px",
        display: "flex",
        flexDirection: "column",
        gap: "0px",
      }}
    >
      <div
        style={{
          width: `${w}px`,
          height: `${stroke}px`,
          background: BRAND.white,
          display: "flex",
        }}
      />
      <div
        style={{
          width: `${w}px`,
          height: `${stroke}px`,
          background: BRAND.white,
          marginTop: `${22 - stroke}px`,
          transform: "skewX(-22deg)",
          display: "flex",
        }}
      />
    </div>
  );
  const stack = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: `${gap}px`,
        opacity: 0.55,
      }}
    >
      {slash}
      {slash}
      {slash}
    </div>
  );
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: `${top}px`,
          left: "12px",
          zIndex: 2,
          display: "flex",
        }}
      >
        {stack}
      </div>
      <div
        style={{
          position: "absolute",
          top: `${top}px`,
          right: "12px",
          zIndex: 2,
          transform: "scaleX(-1)",
          display: "flex",
        }}
      >
        {stack}
      </div>
    </>
  );
}

// ----- <PlayerHeadshot> -------------------------------------------------------

/**
 * Small player headshot rendered as a circular avatar. Used in row-style
 * templates (top-scorers, gd-leaders, etc.) so they don't look bare.
 *
 * Slug is the player's processed-folder slug (e.g. "baji_jnr"). Default
 * pose 1; pass `poseIndex` to override.
 */
export function PlayerHeadshot({
  slug,
  size: avatarSize,
  origin,
  poseIndex,
  ringColor,
}: {
  slug: string;
  size: number;
  origin?: string;
  poseIndex?: number;
  ringColor?: string;
}): ReactElement {
  const base = (origin ?? "").replace(/\/+$/, "");
  const idx = poseIndex ?? 1;
  const padded = String(idx).padStart(2, "0");
  const url = `${base}/overlays/v2/_assets/players/processed/${slug}/headshot_${padded}_nobg.png`;
  const ring = Math.max(2, Math.round(avatarSize * 0.045));
  // Render img inside a flex frame; Satori clips border-radius on the
  // PARENT when the img is positioned absolutely + the parent is flex.
  return (
    <div
      style={{
        width: `${avatarSize}px`,
        height: `${avatarSize}px`,
        borderRadius: "9999px",
        border: `${ring}px solid ${ringColor ?? BRAND.greenBright}`,
        backgroundColor: "rgba(0,0,0,0.4)",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <img
        src={url}
        alt=""
        width={avatarSize}
        height={avatarSize}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${avatarSize}px`,
          height: `${avatarSize}px`,
          objectFit: "cover",
        }}
      />
    </div>
  );
}

function parseDims(size: SocialSize): { width: number; height: number } {
  // social-sizes.ts is the source of truth — keep this trivial parse rather
  // than importing the full preset to avoid a circular dep at the JSX layer.
  const [w, h] = size.split("x").map((n) => parseInt(n, 10));
  return { width: w, height: h };
}

// ----- <BrandHeader> ----------------------------------------------------------

export type BrandHeaderProps = {
  size: SocialSize;
  /**
   * Optional absolute origin (e.g. `https://example.com`) used to prefix
   * the asset paths. Required by Satori (the renderer behind `next/og`),
   * which throws "Image source must be an absolute URL" for any
   * root-relative `<img src>`. Pass `new URL(req.url).origin` from the
   * route handler. When absent (e.g. a `renderToStaticMarkup` test) the
   * paths render as root-relative — fine for unit-test assertions, NOT
   * fine for an actual `ImageResponse` render.
   */
  origin?: string;
};

/**
 * CADE esports + Pro League shield logos with vertical divider. Logos pulled
 * from the v2 overlay public mirror at `/overlays/v2/_assets/logos/...`.
 */
export function BrandHeader({ size, origin }: BrandHeaderProps): ReactElement {
  const logoH = size === "1200x675" ? 64 : 96;
  const base = (origin ?? "").replace(/\/+$/, "");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "32px",
        width: "100%",
      }}
    >
      <img
        src={`${base}/overlays/v2/_assets/logos/processed/1cade%20esport_strip.png`}
        alt="CADE Esports"
        height={logoH}
        style={{ height: `${logoH}px`, objectFit: "contain", display: "flex" }}
      />
      <div
        style={{
          width: "2px",
          height: `${logoH * 0.7}px`,
          background: BRAND.green,
          display: "flex",
        }}
      />
      <img
        src={`${base}/overlays/v2/_assets/logos/processed/pro%20league%20_strip.png`}
        alt="Pro League"
        height={logoH}
        style={{ height: `${logoH}px`, objectFit: "contain", display: "flex" }}
      />
    </div>
  );
}

// ----- <SponsorRow> -----------------------------------------------------------

export type SponsorRowProps = {
  size: SocialSize;
  /**
   * Optional absolute origin used to prefix sponsor logo paths. Same rule
   * + escape hatch as `BrandHeader.origin` — see that prop's doc.
   */
  origin?: string;
};

/**
 * 5 sponsor logos in target order: GameEvo, OAS, Gamepride, Esports Africa
 * News, TRACE. Uses no-bg "_strip.png" variants from the overlay v2 mirror so
 * they layer cleanly over the dark wrapper bg.
 */
export function SponsorRow({ size, origin }: SponsorRowProps): ReactElement {
  const logoH = size === "1200x675" ? 36 : 52;
  const base = (origin ?? "").replace(/\/+$/, "");
  const sponsors: Array<{ src: string; alt: string }> = [
    {
      src: `${base}/overlays/v2/_assets/logos/processed/GameEvo%20Esports%20White_strip.png`,
      alt: "GameEvo Esports",
    },
    {
      src: `${base}/overlays/v2/_assets/logos/processed/OAS%20esport_strip.png`,
      alt: "OAS Esports",
    },
    {
      src: `${base}/overlays/v2/_assets/logos/processed/Gamepride%20Green-01_strip.png`,
      alt: "Gamepride",
    },
    {
      src: `${base}/overlays/v2/_assets/logos/processed/ESPORTS%20AFRICA%20NEWS%20WHITE_strip.png`,
      alt: "Esports Africa News",
    },
    {
      src: `${base}/overlays/v2/_assets/logos/processed/TRACE_2010_logo.svg_strip.png`,
      alt: "TRACE",
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        gap: size === "1080x1920" ? "32px" : "20px",
        opacity: 0.95,
      }}
    >
      {sponsors.map((s) => (
        <img
          key={s.alt}
          src={s.src}
          alt={s.alt}
          height={logoH}
          style={{
            height: `${logoH}px`,
            objectFit: "contain",
            display: "flex",
          }}
        />
      ))}
    </div>
  );
}

// ----- <TitleBlock> -----------------------------------------------------------

export type TitleBlockProps = {
  subtitle?: string;
  title: string;
  dateText?: string;
};

/**
 * Gradient title block. The reel proof-of-concept uses
 * `-webkit-background-clip: text` which Satori (the engine behind `next/og`)
 * does not support. We approximate the same green-to-bright-green gradient
 * via stacked drop-shadows on a solid bright fill — this renders cleaner than
 * a manual SVG <mask> + <rect> trick once letter-spacing is in play, because
 * Satori's mask handling for kerned text drops sub-pixel anti-aliasing.
 *
 * Divergence from POC: the POC uses a vertical 3-stop gradient (#B0FF55 →
 * #6bcd06 → #357500). We render the brightest stop (`#a4ff1a`) as the fill,
 * then layer a deep-green outer drop-shadow + a black ground-shadow so the
 * text reads as if it had a vertical gradient in motion-blurred form.
 */
export function TitleBlock({
  subtitle,
  title,
  dateText,
}: TitleBlockProps): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        textAlign: "center",
      }}
    >
      {subtitle ? (
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 500,
            fontSize: "32px",
            letterSpacing: "8px",
            color: BRAND.white,
            textTransform: "uppercase",
            marginBottom: "12px",
            display: "flex",
          }}
        >
          {subtitle}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: "Agharti, sans-serif",
          fontWeight: 900,
          fontSize: "148px",
          lineHeight: 0.85,
          letterSpacing: "4px",
          textTransform: "uppercase",
          // Approximated green→cyan gradient. Satori can't background-clip
          // text; we fake it via cyan fill + green ground-shadow + halo.
          color: "#4ee0c4",
          textShadow: [
            // bottom green ground-shadow → fakes the gradient's bottom stop
            `0 6px 0 ${BRAND.green}`,
            `0 8px 0 ${BRAND.greenDeep}`,
            // outer green halo
            `0 0 32px rgba(107,205,6,0.55)`,
            // hard black drop for readability
            `0 4px 0 rgba(0,0,0,0.55)`,
          ].join(", "),
          display: "flex",
        }}
      >
        {title}
      </div>
      {dateText ? (
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 500,
            fontSize: "26px",
            letterSpacing: "6px",
            color: BRAND.white,
            opacity: 0.9,
            marginTop: "16px",
            textTransform: "uppercase",
            display: "flex",
          }}
        >
          {dateText}
        </div>
      ) : null}
    </div>
  );
}
