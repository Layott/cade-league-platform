/**
 * Plan 54 — `next/og` route for the WEEKLY LEADERBOARD social asset.
 *
 * Renders the top-13 standings rows for the season tied to the supplied
 * `?session=<sessionId>` param, at one of three pixel sizes encoded in the
 * URL path: `1080x1920` (IG Reel / Story / TikTok), `1080x1080` (IG Feed),
 * `1200x675` (X post). The size param is parsed via `parseSize` from
 * `@/lib/social-sizes` so an unknown value 400s before any data fetch.
 *
 * Edge runtime — see `og-route-helpers.ts` for the auth + Supabase
 * pre-flight that's shared across the 5 social OG routes.
 *
 * Spec: `docs/superpowers/specs/2026-05-05-broadcast-social-media.md` §6.
 */

import { ImageResponse } from "next/og";

import { SIZE_PRESETS, type SocialSize } from "@/lib/social-sizes";
import {
  Wrapper,
  BrandHeader,
  SponsorRow,
  TitleBlock,
  loadFonts,
  BRAND,
} from "@/server/social/og-shared";
import {
  fetchLeaderboardPayload,
  type LeaderboardPayload,
  type LeaderboardRow,
} from "@/server/social/data";
import {
  ogPreflight,
  OG_CACHE_HEADER,
} from "@/server/social/og-route-helpers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ *
 * Per-size render                                                     *
 * ------------------------------------------------------------------ *
 * Three layouts share the same building blocks:
 *
 *   1080x1920 — full vertical reel: header → title → 13-row table → sponsors
 *   1080x1080 — square IG feed:    header → title → top-10 only, no sponsors
 *   1200x675  — X landscape:       2-column — header+title left, top-5 right
 *
 * Top-3 rows are pinned green pills with a chevron right-edge cut; rows 4+
 * use the white pill style. This mirrors the leaderboard reel design
 * language (see `KNOWLEDGE/brand-assets/elements/v2/07-leaderboard/`).
 */

type RowVariant = "top3" | "rest";

function variantFor(pos: number): RowVariant {
  return pos <= 3 ? "top3" : "rest";
}

/**
 * Single leaderboard row — pos / name / mp / w / l / d / g / gd / pts.
 * Top-3 rows render as filled green pills with a chevron right-edge cut
 * (signals "ascending into the lead" visually). Rows 4+ render as white
 * pills with dark text.
 */
function LeaderboardRowCard({
  row,
  size,
}: {
  row: LeaderboardRow;
  size: SocialSize;
}) {
  const v = variantFor(row.pos);
  const isCompact = size === "1200x675";
  const rowH = isCompact ? 44 : 64;
  const fsBig = isCompact ? 22 : 30;
  const fsNum = isCompact ? 18 : 22;

  // top-3 chevron right-edge:
  // Satori's polygon-clipPath parser crashes ("Cannot read properties of
  // undefined (reading 'trim')" on the value parser path inside
  // next/dist/.../@vercel/og/index.edge.js — line 1862 / 2070) the moment
  // a `clipPath` style key appears on a <div>, even with `polygon(...)`
  // values that read fine in the browser. Workaround: pure CSS triangle
  // trick on a sibling wedge — `border-left: <green>` + transparent
  // top/bottom borders give us a right-pointing arrow without any clip
  // path. The wedge is 24px wide and matches the row height.

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: `${rowH}px`,
        marginBottom: isCompact ? "4px" : "6px",
        background: v === "top3" ? BRAND.green : BRAND.white,
        color: v === "top3" ? BRAND.white : BRAND.black,
        borderRadius: v === "top3" ? "8px 0 0 8px" : "8px",
        position: "relative",
        boxShadow:
          v === "top3"
            ? `0 4px 16px rgba(107,205,6,0.35)`
            : `0 2px 8px rgba(0,0,0,0.25)`,
        border: v === "rest" ? `1px solid rgba(0,0,0,0.08)` : "none",
        paddingLeft: isCompact ? "12px" : "20px",
        paddingRight: isCompact ? "44px" : "56px",
        gap: isCompact ? "8px" : "14px",
        fontFamily: "Quedora, sans-serif",
      }}
    >
      <div
        style={{
          width: isCompact ? "28px" : "40px",
          fontFamily: "Agharti, sans-serif",
          fontWeight: 900,
          fontSize: `${fsBig}px`,
          color: v === "top3" ? BRAND.white : BRAND.black,
          textAlign: "center",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {row.pos}
      </div>
      <div
        style={{
          flex: 1,
          fontFamily: "Quedora, sans-serif",
          fontWeight: 700,
          fontSize: `${fsBig}px`,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: v === "top3" ? BRAND.white : BRAND.black,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          display: "flex",
        }}
      >
        {row.name}
      </div>
      {/* Numeric columns — fixed widths so columns line up across rows. */}
      <RowNum label="MP" value={row.mp} fs={fsNum} v={v} />
      <RowNum label="W" value={row.w} fs={fsNum} v={v} />
      <RowNum label="L" value={row.l} fs={fsNum} v={v} />
      <RowNum label="D" value={row.d} fs={fsNum} v={v} />
      <RowNum label="G" value={row.g} fs={fsNum} v={v} />
      <RowNum
        label="GD"
        value={`${row.gd > 0 ? "+" : ""}${row.gd}`}
        fs={fsNum}
        v={v}
        color={
          row.gd > 0
            ? v === "top3"
              ? BRAND.white
              : BRAND.green
            : row.gd < 0
              ? BRAND.pink
              : undefined
        }
      />
      <RowNum
        label="PTS"
        value={row.pts}
        fs={isCompact ? fsBig : 30}
        v={v}
        emphasize
      />
      {/* Chevron right-edge for top-3 rows. Pure CSS triangle: solid
          border-left in brand green + transparent top/bottom borders
          collapses into a right-pointing arrow without any `clip-path`. */}
      {v === "top3" ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            right: `-${isCompact ? 22 : 28}px`,
            top: 0,
            width: 0,
            height: 0,
            borderTop: `${rowH / 2}px solid transparent`,
            borderBottom: `${rowH / 2}px solid transparent`,
            borderLeft: `${isCompact ? 22 : 28}px solid ${BRAND.green}`,
          }}
        />
      ) : null}
    </div>
  );
}

function RowNum({
  label,
  value,
  fs,
  v,
  emphasize,
  color,
}: {
  label: string;
  value: number | string;
  fs: number;
  v: RowVariant;
  emphasize?: boolean;
  color?: string;
}) {
  const fg = color ?? (v === "top3" ? BRAND.white : BRAND.black);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: emphasize ? "60px" : "44px",
      }}
    >
      <div
        style={{
          fontFamily: "Quedora, sans-serif",
          fontWeight: 500,
          fontSize: "11px",
          letterSpacing: "1.5px",
          color: v === "top3" ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.55)",
          textTransform: "uppercase",
          marginBottom: "2px",
          display: "flex",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: emphasize ? "Agharti, sans-serif" : "Quedora, sans-serif",
          fontWeight: emphasize ? 900 : 700,
          fontSize: `${fs}px`,
          color: fg,
          display: "flex",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LeaderboardBody({
  payload,
  size,
}: {
  payload: LeaderboardPayload;
  size: SocialSize;
}) {
  // Per-size row truncation. 1080×1920 → all 13. 1080×1080 → 10. 1200×675 → 5.
  let rows: LeaderboardRow[];
  switch (size) {
    case "1080x1920":
      rows = payload.rows;
      break;
    case "1080x1080":
      rows = payload.rows.slice(0, 10);
      break;
    case "1200x675":
      rows = payload.rows.slice(0, 5);
      break;
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          fontFamily: "Quedora, sans-serif",
          fontSize: "32px",
          color: BRAND.white,
          opacity: 0.6,
          textTransform: "uppercase",
          letterSpacing: "4px",
        }}
      >
        STANDINGS POSTED AFTER FIRST MATCH
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        width: "100%",
        marginTop: "16px",
        marginBottom: "16px",
      }}
    >
      {rows.map((r) => (
        <LeaderboardRowCard key={`${r.pos}-${r.slug}`} row={r} size={size} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Landscape (1200x675) layout                                         *
 * ------------------------------------------------------------------ *
 * X post is wide-and-short — header on the left column, table on the
 * right.
 */

function LandscapeLayout({
  payload,
  origin,
}: {
  payload: LeaderboardPayload;
  origin: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        gap: "32px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "440px",
          justifyContent: "space-between",
          paddingRight: "24px",
          borderRight: `1px solid rgba(255,255,255,0.08)`,
        }}
      >
        <BrandHeader size="1200x675" origin={origin} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontFamily: "Quedora, sans-serif",
              fontWeight: 500,
              fontSize: "20px",
              letterSpacing: "6px",
              color: BRAND.pink,
              textTransform: "uppercase",
              marginBottom: "8px",
              display: "flex",
            }}
          >
            ELITE LEAGUE SEASON 2
          </div>
          <div
            style={{
              fontFamily: "Agharti, sans-serif",
              fontWeight: 900,
              fontSize: "92px",
              lineHeight: 0.85,
              letterSpacing: "4px",
              textTransform: "uppercase",
              color: BRAND.greenBright,
              textShadow: [
                `0 4px 0 ${BRAND.greenDeep}`,
                `0 0 28px rgba(107,205,6,0.55)`,
                `0 3px 0 rgba(0,0,0,0.65)`,
              ].join(", "),
              display: "flex",
            }}
          >
            LEADERBOARD
          </div>
          <div
            style={{
              fontFamily: "Quedora, sans-serif",
              fontWeight: 500,
              fontSize: "18px",
              letterSpacing: "4px",
              color: BRAND.white,
              opacity: 0.85,
              marginTop: "12px",
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            {payload.weekLabel}
          </div>
        </div>
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontSize: "14px",
            color: "rgba(255,255,255,0.5)",
            letterSpacing: "3px",
            textTransform: "uppercase",
            display: "flex",
          }}
        >
          PRESENTED BY GAMEEVO ESPORTS
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
        }}
      >
        <LeaderboardBody payload={payload} size="1200x675" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Route handler                                                       *
 * ------------------------------------------------------------------ */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ size: string }> },
): Promise<Response> {
  const pre = await ogPreflight(req, params);
  if (!pre.ok) return pre.response;
  const { size, sessionId, sb, origin } = pre;

  try {
    const payload = await fetchLeaderboardPayload(sb, sessionId, size);
    const fonts = await loadFonts(origin);
    const { width, height } = SIZE_PRESETS[size];

    if (size === "1200x675") {
      return new ImageResponse(
        (
          <Wrapper size={size}>
            <LandscapeLayout payload={payload} origin={origin} />
          </Wrapper>
        ),
        {
          width,
          height,
          fonts: fonts.map((f) => ({
            name: f.name,
            data: f.data,
            weight: f.weight,
            style: f.style,
          })),
          headers: { "Cache-Control": OG_CACHE_HEADER },
        },
      );
    }

    return new ImageResponse(
      (
        <Wrapper size={size}>
          <BrandHeader size={size} origin={origin} />
          <TitleBlock
            subtitle="ELITE LEAGUE SEASON 2"
            title="LEADERBOARD"
            dateText={payload.weekLabel.toUpperCase()}
          />
          <LeaderboardBody payload={payload} size={size} />
          {size === "1080x1920" ? <SponsorRow size={size} origin={origin} /> : null}
        </Wrapper>
      ),
      {
        width,
        height,
        fonts: fonts.map((f) => ({
          name: f.name,
          data: f.data,
          weight: f.weight,
          style: f.style,
        })),
        headers: { "Cache-Control": OG_CACHE_HEADER },
      },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "render error";
    return new Response(msg, { status: 500 });
  }
}
