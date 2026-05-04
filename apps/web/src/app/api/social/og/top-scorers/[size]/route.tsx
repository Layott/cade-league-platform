/**
 * Plan 54 — `next/og` route for the GOLDEN BOOT RACE social asset.
 *
 * Renders the season's top scorers (max 10) at one of two pixel sizes:
 * `1080x1920` (IG Reel / Story / TikTok) or `1080x1080` (IG Feed).
 * The `1200x675` X size is NOT supported for this template — top-scorers
 * needs vertical room for the dominance bars to read correctly.
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
  SideBrackets,
  PlayerHeadshot,
  loadFonts,
  BRAND,
} from "@/server/social/og-shared";
import {
  fetchTopScorersPayload,
  type TopScorersPayload,
  type TopScorerRow,
} from "@/server/social/data";
import {
  ogPreflight,
  OG_CACHE_HEADER,
} from "@/server/social/og-route-helpers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Single top-scorer row — rank circle + name + goal count + dominance bar.
 *
 * The dominance bar is a horizontal green progress bar whose width is the
 * row's goals divided by the leader's goals. Rank 1 always renders at 100%,
 * subsequent rows shrink proportionally — visualises "the gap" intuitively.
 */
function TopScorerCard({
  row,
  leaderGoals,
  size,
  origin,
}: {
  row: TopScorerRow;
  leaderGoals: number;
  size: SocialSize;
  origin: string;
}) {
  const isReel = size === "1080x1920";
  const rowH = isReel ? 110 : 80;
  const rankSize = isReel ? 56 : 42;
  const headSize = isReel ? 96 : 70;
  const fsName = isReel ? 36 : 26;
  const fsGoals = isReel ? 64 : 44;
  const isLeader = row.pos === 1;

  // Avoid divide-by-zero when leaderGoals === 0 (fresh season).
  const pct =
    leaderGoals > 0 ? Math.max(8, (row.goals / leaderGoals) * 100) : 8;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: `${rowH}px`,
        marginBottom: isReel ? "16px" : "10px",
        gap: isReel ? "20px" : "14px",
      }}
    >
      {/* Rank circle. Leader gets bright green fill, others get outlined ring. */}
      <div
        style={{
          width: `${rankSize}px`,
          height: `${rankSize}px`,
          borderRadius: "999px",
          background: isLeader ? BRAND.green : "transparent",
          border: isLeader
            ? `none`
            : `2px solid rgba(107,205,6,0.5)`,
          color: isLeader ? BRAND.black : BRAND.greenBright,
          fontFamily: "Agharti, sans-serif",
          fontWeight: 900,
          fontSize: `${rankSize * 0.5}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {row.pos}
      </div>

      {/* Player headshot — keeps the row from looking text-only. */}
      <div style={{ display: "flex", flexShrink: 0 }}>
        <PlayerHeadshot
          slug={row.slug}
          size={headSize}
          origin={origin}
          ringColor={isLeader ? BRAND.greenBright : "rgba(255,255,255,0.5)"}
        />
      </div>

      {/* Body — name on top, dominance bar underneath. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          gap: isReel ? "10px" : "6px",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontFamily: "Quedora, sans-serif",
            fontWeight: 700,
            fontSize: `${fsName}px`,
            letterSpacing: "2px",
            color: isLeader ? BRAND.greenBright : BRAND.white,
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
            height: isReel ? "12px" : "8px",
            background: "rgba(255,255,255,0.08)",
            borderRadius: "999px",
            overflow: "hidden",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              width: `${pct}%`,
              height: "100%",
              background: isLeader
                ? `linear-gradient(90deg, ${BRAND.greenBright}, ${BRAND.green})`
                : `linear-gradient(90deg, rgba(107,205,6,0.6), rgba(107,205,6,0.3))`,
              borderRadius: "999px",
            }}
          />
        </div>
      </div>

      {/* Goal count — Agharti, big, with "GOALS" label when reel size. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "center",
          width: isReel ? "120px" : "84px",
        }}
      >
        <div
          style={{
            fontFamily: "Agharti, sans-serif",
            fontWeight: 900,
            fontSize: `${fsGoals}px`,
            color: isLeader ? BRAND.greenBright : BRAND.white,
            lineHeight: 1,
            display: "flex",
            textShadow: isLeader
              ? `0 0 20px rgba(107,205,6,0.5)`
              : "none",
          }}
        >
          {row.goals}
        </div>
        {isReel ? (
          <div
            style={{
              fontFamily: "Quedora, sans-serif",
              fontWeight: 500,
              fontSize: "13px",
              letterSpacing: "2px",
              color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              marginTop: "2px",
              display: "flex",
            }}
          >
            GOALS
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TopScorersBody({
  payload,
  size,
  origin,
}: {
  payload: TopScorersPayload;
  size: SocialSize;
  origin: string;
}) {
  // 1080x1920 → top 5 (room for big rows). 1080x1080 → top 5 (compact).
  const rows = payload.rows.slice(0, size === "1080x1920" ? 5 : 5);
  const leaderGoals = rows[0]?.goals ?? 0;

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
        NO SCORERS YET
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
        <TopScorerCard
          key={`${r.pos}-${r.slug}`}
          row={r}
          leaderGoals={leaderGoals}
          size={size}
          origin={origin}
        />
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

  // top-scorers does not support 1200x675 — landscape vert-bar ratios fail.
  if (size === "1200x675") {
    return new Response(
      "top-scorers does not support 1200x675; use 1080x1920 or 1080x1080",
      { status: 400 },
    );
  }
  // Locked-narrowed for the renderer below.
  const renderSize: Exclude<SocialSize, "1200x675"> = size;

  try {
    const payload = await fetchTopScorersPayload(sb, sessionId, renderSize);
    const fonts = await loadFonts(origin);
    const { width, height } = SIZE_PRESETS[renderSize];

    return new ImageResponse(
      (
        <Wrapper size={renderSize} origin={origin}>
          <SideBrackets size={renderSize} />
          <BrandHeader size={renderSize} origin={origin} />
          <TitleBlock
            subtitle="ELITE LEAGUE SEASON 2"
            title="GOLDEN BOOT"
            dateText={payload.weekLabel.toUpperCase()}
          />
          <TopScorersBody payload={payload} size={renderSize} origin={origin} />
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
