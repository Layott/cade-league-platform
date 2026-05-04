/**
 * Plan 54 — `next/og` route for the LEAGUE AVERAGE STATS social asset.
 *
 * Renders a 4-tile grid of aggregate stats at `1080x1080` (IG Feed only).
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
  loadFonts,
  BRAND,
} from "@/server/social/og-shared";
import {
  fetchLeagueAvgPayload,
  type LeagueAvgPayload,
} from "@/server/social/data";
import {
  ogPreflight,
  OG_CACHE_HEADER,
} from "@/server/social/og-route-helpers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * One stat tile in the 2×2 grid. Big number on top, label underneath.
 *
 * The accent color flows from a small palette (`tone`): "primary" picks
 * the bright green, "alt" picks pink for the win-percentage tile so the
 * grid doesn't read as monochrome green.
 */
function StatTile({
  bigText,
  label,
  smallText,
  tone,
}: {
  bigText: string;
  label: string;
  smallText?: string;
  tone: "primary" | "alt";
}) {
  const accent = tone === "primary" ? BRAND.greenBright : BRAND.pink;
  const accentDeep = tone === "primary" ? BRAND.greenDeep : "#a3023f";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(160deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)`,
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "16px",
        padding: "28px 20px",
        flex: 1,
      }}
    >
      <div
        style={{
          fontFamily: "Agharti, sans-serif",
          fontWeight: 900,
          fontSize: "108px",
          lineHeight: 1,
          color: accent,
          letterSpacing: "2px",
          textShadow: [
            `0 4px 0 ${accentDeep}`,
            `0 0 28px rgba(107,205,6,0.25)`,
          ].join(", "),
          display: "flex",
        }}
      >
        {bigText}
      </div>
      {smallText ? (
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 500,
            fontSize: "16px",
            color: "rgba(255,255,255,0.65)",
            letterSpacing: "2px",
            textTransform: "uppercase",
            marginTop: "8px",
            display: "flex",
          }}
        >
          {smallText}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: "Quedora, sans-serif",
          fontWeight: 700,
          fontSize: "20px",
          color: BRAND.white,
          letterSpacing: "3px",
          textTransform: "uppercase",
          marginTop: smallText ? "12px" : "16px",
          display: "flex",
          textAlign: "center",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function LeagueAvgBody({ payload }: { payload: LeagueAvgPayload }) {
  if (payload.playerCount === 0) {
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
          textAlign: "center",
          padding: "0 40px",
        }}
      >
        STATS POSTED AFTER FIRST MATCH
      </div>
    );
  }

  // Average win-pct = wins/(matches played, total per-side / 2 = matches).
  // Use the per-player avg matches-played as denominator since standings
  // double-count. Fall back to 0 when avg.matchesPlayed === 0 to avoid /0.
  const winPct =
    payload.avg.matchesPlayed > 0
      ? Math.round((payload.avg.wins / payload.avg.matchesPlayed) * 100)
      : 0;
  const goalsPerMatch =
    payload.total.matches > 0
      ? Math.round(
          ((payload.total.goalsFor + payload.total.goalsAgainst) /
            payload.total.matches) *
            10,
        ) / 10
      : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        width: "100%",
        marginTop: "16px",
        marginBottom: "16px",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", flex: 1, gap: "16px" }}>
        <StatTile
          bigText={String(goalsPerMatch.toFixed(1))}
          label="Goals / Match"
          tone="primary"
        />
        <StatTile
          bigText={`${winPct}`}
          smallText="%"
          label="Avg Win Rate"
          tone="alt"
        />
      </div>
      <div style={{ display: "flex", flexDirection: "row", flex: 1, gap: "16px" }}>
        <StatTile
          bigText={`${payload.avg.goalDifference > 0 ? "+" : ""}${payload.avg.goalDifference.toFixed(1)}`}
          label="Avg GD / Player"
          tone="primary"
        />
        <StatTile
          bigText={String(payload.total.matches)}
          label="Matches Played"
          tone="alt"
        />
      </div>
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

  if (size !== "1080x1080") {
    return new Response(
      "league-avg only supports 1080x1080",
      { status: 400 },
    );
  }
  const renderSize: SocialSize = "1080x1080";

  try {
    const payload = await fetchLeagueAvgPayload(sb, sessionId, renderSize);
    const fonts = await loadFonts(origin);
    const { width, height } = SIZE_PRESETS[renderSize];

    return new ImageResponse(
      (
        <Wrapper size={renderSize}>
          <BrandHeader size={renderSize} origin={origin} />
          <TitleBlock
            subtitle="ELITE LEAGUE SEASON 2"
            title="LEAGUE AVG"
            dateText={payload.weekLabel.toUpperCase()}
          />
          <LeagueAvgBody payload={payload} />
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
