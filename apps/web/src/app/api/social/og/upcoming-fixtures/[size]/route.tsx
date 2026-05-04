/**
 * Plan 54 — `next/og` route for the UPCOMING FIXTURES social asset.
 *
 * Renders the next match-day's slate at one of two pixel sizes:
 * `1080x1920` (IG Reel / Story / TikTok) or `1080x1080` (IG Feed).
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
  SponsorRow,
  TitleBlock,
  SideBrackets,
  loadFonts,
  BRAND,
} from "@/server/social/og-shared";
import {
  fetchUpcomingFixturesPayload,
  type FixturesPayload,
  type FixtureRow,
} from "@/server/social/data";
import {
  ogPreflight,
  OG_CACHE_HEADER,
} from "@/server/social/og-route-helpers";
import { formatWat } from "@/lib/time";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Format an ISO timestamp into "7:30 PM" style for the fixture row.
 * Returns "TBD" when the fixture has no scheduled time yet.
 */
function fmtKickoff(scheduled: string | null): string {
  if (!scheduled) return "TBD";
  try {
    return formatWat(scheduled, "h:mm a");
  } catch {
    return "TBD";
  }
}

/**
 * One fixture row — HOME vs AWAY with VS divider + kickoff time.
 *
 * We deliberately render names only (no avatars). Player photos in next/og
 * over Edge fetch are flaky — the Wave 1B `og-shared` doc warns against
 * leaning on them in static. The accent green VS pill and the right-edge
 * time chip carry the visual rhythm instead.
 */
function FixtureCard({
  row,
  size,
}: {
  row: FixtureRow;
  size: SocialSize;
}) {
  const isReel = size === "1080x1920";
  const cardH = isReel ? 88 : 64;
  const fsName = isReel ? 30 : 22;
  const fsTime = isReel ? 24 : 18;
  const fsLabel = isReel ? 12 : 10;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: `${cardH}px`,
        marginBottom: isReel ? "12px" : "8px",
        background: BRAND.white,
        borderRadius: "10px",
        boxShadow: `0 2px 8px rgba(0,0,0,0.25)`,
        overflow: "hidden",
        gap: 0,
      }}
    >
      {/* HOME side */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          flex: 1,
          height: "100%",
          paddingRight: isReel ? "20px" : "14px",
        }}
      >
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 700,
            fontSize: `${fsName}px`,
            letterSpacing: "1.5px",
            color: BRAND.black,
            textTransform: "uppercase",
            display: "flex",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {row.home}
        </div>
      </div>

      {/* VS pill — green flag in the middle */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.green,
          color: BRAND.white,
          height: "100%",
          paddingLeft: isReel ? "16px" : "10px",
          paddingRight: isReel ? "16px" : "10px",
          minWidth: isReel ? "80px" : "60px",
          borderLeft: `3px solid ${BRAND.greenDeep}`,
          borderRight: `3px solid ${BRAND.greenDeep}`,
        }}
      >
        <div
          style={{
            fontFamily: "Agharti, sans-serif",
            fontWeight: 900,
            fontSize: isReel ? "26px" : "20px",
            letterSpacing: "2px",
            display: "flex",
            color: BRAND.white,
          }}
        >
          VS
        </div>
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 500,
            fontSize: `${fsLabel}px`,
            letterSpacing: "1px",
            color: "rgba(255,255,255,0.85)",
            textTransform: "uppercase",
            marginTop: "2px",
            display: "flex",
          }}
        >
          {fmtKickoff(row.scheduledTime)}
        </div>
      </div>

      {/* AWAY side */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-start",
          flex: 1,
          height: "100%",
          paddingLeft: isReel ? "20px" : "14px",
        }}
      >
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 700,
            fontSize: `${fsName}px`,
            letterSpacing: "1.5px",
            color: BRAND.black,
            textTransform: "uppercase",
            display: "flex",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {row.away}
        </div>
      </div>

      {/* Status chip on the very right (reel only — square is too tight) */}
      {isReel ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: BRAND.black,
            color: BRAND.greenBright,
            paddingLeft: "16px",
            paddingRight: "16px",
            height: "100%",
            minWidth: "104px",
          }}
        >
          <div
            style={{
              fontFamily: "Quedora, sans-serif",
              fontWeight: 700,
              fontSize: `${fsTime}px`,
              letterSpacing: "2px",
              textTransform: "uppercase",
              display: "flex",
              color:
                row.status === "completed"
                  ? "rgba(255,255,255,0.4)"
                  : BRAND.greenBright,
            }}
          >
            {row.status === "completed"
              ? "FT"
              : row.status === "in_progress"
                ? "LIVE"
                : "UP"}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FixturesBody({
  payload,
  size,
}: {
  payload: FixturesPayload;
  size: SocialSize;
}) {
  // 1080x1920 → all (up to 8). 1080x1080 → up to 6.
  const max = size === "1080x1920" ? 8 : 6;
  const rows = payload.rows.slice(0, max);

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
        NO FIXTURES SCHEDULED
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
        marginTop: "20px",
        marginBottom: "20px",
        justifyContent: "center",
      }}
    >
      {rows.map((r) => (
        <FixtureCard key={r.matchId} row={r} size={size} />
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

  if (size === "1200x675") {
    return new Response(
      "upcoming-fixtures does not support 1200x675; use 1080x1920 or 1080x1080",
      { status: 400 },
    );
  }
  const renderSize: Exclude<SocialSize, "1200x675"> = size;

  try {
    const payload = await fetchUpcomingFixturesPayload(sb, sessionId, renderSize);
    const fonts = await loadFonts(origin);
    const { width, height } = SIZE_PRESETS[renderSize];

    return new ImageResponse(
      (
        <Wrapper size={renderSize} origin={origin}>
          <SideBrackets size={renderSize} />
          <BrandHeader size={renderSize} origin={origin} />
          <TitleBlock
            subtitle="ELITE LEAGUE SEASON 2"
            title="UPCOMING"
            dateText={payload.weekLabel.toUpperCase()}
          />
          <FixturesBody payload={payload} size={renderSize} />
          {renderSize === "1080x1920" ? <SponsorRow size={renderSize} origin={origin} /> : null}
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
