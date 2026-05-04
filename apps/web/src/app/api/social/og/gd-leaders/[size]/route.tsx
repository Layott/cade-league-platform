/**
 * Plan 54 — `next/og` route for the GOAL DIFFERENCE LEADERS social asset.
 *
 * Renders the top 5 by goal difference at `1080x1080` (IG Feed only —
 * derived asset, not a flagship reel).
 *
 * Edge runtime — see `og-route-helpers.ts` for the auth + Supabase
 * pre-flight.
 *
 * Spec: `docs/superpowers/specs/2026-05-05-broadcast-social-media.md` §6.
 */

import { ImageResponse } from "next/og";

import { SIZE_PRESETS, type SocialSize } from "@/lib/social-sizes";
import {
  Wrapper,
  BrandHeader,
  TitleBlock,
  SideBrackets,
  PlayerHeadshot,
  loadFonts,
  BRAND,
} from "@/server/social/og-shared";
import {
  fetchGdLeadersPayload,
  type GdLeadersPayload,
  type GdLeaderRow,
} from "@/server/social/data";
import {
  ogPreflight,
  OG_CACHE_HEADER,
} from "@/server/social/og-route-helpers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Single GD-leader card — name + (huge) GD number + GF/GA breakdown.
 * GD colour: green when positive, pink when negative, white when zero.
 */
function GdLeaderCard({ row, origin }: { row: GdLeaderRow; origin: string }) {
  const gdColor =
    row.gd > 0
      ? BRAND.greenBright
      : row.gd < 0
        ? BRAND.pink
        : BRAND.white;
  const gdSign = row.gd > 0 ? "+" : row.gd < 0 ? "" : "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: "120px",
        marginBottom: "10px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        paddingLeft: "20px",
        paddingRight: "20px",
        gap: "20px",
      }}
    >
      {/* Rank badge */}
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "999px",
          background:
            row.pos === 1
              ? `linear-gradient(135deg, ${BRAND.greenBright}, ${BRAND.green})`
              : "rgba(255,255,255,0.08)",
          color: row.pos === 1 ? BRAND.black : BRAND.white,
          fontFamily: "Agharti, sans-serif",
          fontWeight: 900,
          fontSize: "30px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {row.pos}
      </div>

      {/* Player headshot */}
      <div style={{ display: "flex", flexShrink: 0 }}>
        <PlayerHeadshot
          slug={row.slug}
          size={84}
          origin={origin}
          ringColor={row.pos === 1 ? BRAND.greenBright : "rgba(255,255,255,0.45)"}
        />
      </div>

      {/* Name + GF/GA breakdown */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          gap: "4px",
        }}
      >
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 700,
            fontSize: "30px",
            letterSpacing: "2px",
            color: BRAND.white,
            textTransform: "uppercase",
            display: "flex",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {row.name}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "Quedora, sans-serif",
              fontSize: "16px",
              color: "rgba(255,255,255,0.55)",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
            }}
          >
            GF {row.gf}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Quedora, sans-serif",
              fontSize: "16px",
              color: "rgba(255,255,255,0.55)",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
            }}
          >
            GA {row.ga}
          </div>
        </div>
      </div>

      {/* GD number — huge */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "center",
          minWidth: "120px",
        }}
      >
        <div
          style={{
            fontFamily: "Agharti, sans-serif",
            fontWeight: 900,
            fontSize: "72px",
            color: gdColor,
            lineHeight: 0.9,
            display: "flex",
            textShadow:
              row.gd > 0 ? `0 0 24px rgba(107,205,6,0.4)` : "none",
          }}
        >
          {gdSign}
          {row.gd}
        </div>
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 500,
            fontSize: "12px",
            color: "rgba(255,255,255,0.45)",
            letterSpacing: "2px",
            textTransform: "uppercase",
            marginTop: "2px",
            display: "flex",
          }}
        >
          GOAL DIFF
        </div>
      </div>
    </div>
  );
}

function GdBody({ payload, origin }: { payload: GdLeadersPayload; origin: string }) {
  if (payload.rows.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          fontFamily: "Quedora, sans-serif",
          fontSize: "28px",
          color: BRAND.white,
          opacity: 0.6,
          textTransform: "uppercase",
          letterSpacing: "4px",
        }}
      >
        STATS POSTED AFTER FIRST MATCH
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
        justifyContent: "center",
      }}
    >
      {payload.rows.map((r) => (
        <GdLeaderCard key={`${r.pos}-${r.slug}`} row={r} origin={origin} />
      ))}
    </div>
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ size: string }> },
): Promise<Response> {
  const pre = await ogPreflight(req, params);
  if (!pre.ok) return pre.response;
  const { size, sessionId, sb, origin } = pre;

  // gd-leaders is square-only.
  if (size !== "1080x1080") {
    return new Response(
      "gd-leaders only supports 1080x1080",
      { status: 400 },
    );
  }
  const renderSize: SocialSize = "1080x1080";

  try {
    const payload = await fetchGdLeadersPayload(sb, sessionId, renderSize);
    const fonts = await loadFonts(origin);
    const { width, height } = SIZE_PRESETS[renderSize];

    return new ImageResponse(
      (
        <Wrapper size={renderSize} origin={origin}>
          <SideBrackets size={renderSize} />
          <BrandHeader size={renderSize} origin={origin} />
          <TitleBlock
            subtitle="ELITE LEAGUE SEASON 2"
            title="GD LEADERS"
            dateText={payload.weekLabel.toUpperCase()}
          />
          <GdBody payload={payload} origin={origin} />
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
