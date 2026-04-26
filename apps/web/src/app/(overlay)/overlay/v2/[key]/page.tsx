import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import OverlayDataInjector from "@/components/broadcast/v2/OverlayDataInjector";
import { getServiceRoleSupabase } from "@/lib/supabase/service";

/**
 * Resolve the active season for a given broadcast session via
 * stream_sessions → match_days. Returns null if session is gone /
 * deleted or doesn't have a match-day attached.
 */
async function resolveSeasonId(sessionId: string): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const sb = getServiceRoleSupabase();
    const { data } = await sb
      .from("stream_sessions")
      .select("match_day_id, match_days:match_day_id ( season_id )")
      .eq("id", sessionId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return null;
    const md = (data as { match_days?: { season_id?: string } | { season_id?: string }[] | null }).match_days;
    if (!md) return null;
    if (Array.isArray(md)) return md[0]?.season_id ?? null;
    return md.season_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Plan 51 — `/overlay/v2/<key>` browser-source route.
 *
 * Thin server-component wrapper around `OverlayDataInjector`. The actual
 * design + animations live in the static HTML mirrored to
 * `apps/web/public/overlays/v2/<key>/index.html` by
 * `apps/web/scripts/sync-v2-overlays.mjs`. The injector iframes that HTML
 * + posts Realtime events / control-panel commands into it via
 * `window.postMessage`.
 *
 * Allowed keys are the 16 routable overlays from spec §9 (animated-bg
 * variants + 18-partners-strip are excluded — meta-only).
 *
 * Auth: routes under `/overlay/v2/*` are publicly readable so OBS / vMix
 * browser sources can pull without cookies. Per-overlay `view_token`
 * validation is optional and happens inside the HTML against the
 * session row when the broadcast control panel attaches one.
 */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "01-brb",
  "02-timer",
  "04-h2h-2",
  "05-h2h-3",
  "06-h2h-5",
  "07-leaderboard",
  "08-lower-third",
  "09-secondary-score-bug",
  "10-up-next-bug",
  "11-match-scores-day",
  "12-starting-soon",
  "13-stream-ended",
  "14-top-scorers",
  "15-orgs",
  "16-coaches",
  "17-penalties",
]);

type SearchParams = {
  session?: string;
  token?: string;
  season?: string;
  preview?: string;
  active?: string;
  slot?: string;
};

export default async function OverlayV2Page({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const { key } = await params;
  const { session, token, season, preview, active, slot } = await searchParams;
  if (!ALLOWED_KEYS.has(key)) redirect("/overlay/v2/01-brb");

  // Derive season server-side when only session is supplied (OBS URLs
  // typically only carry `?session=...&token=...`). Explicit `?season=`
  // in the URL still wins.
  const resolvedSeason = season ?? (session ? await resolveSeasonId(session) : null);

  // S2 smoke fix (2026-04-26) — Bug CC#2.
  //
  // The mini-preview iframes inside the broadcast control room append
  // `?preview=1&active=0|1` so the injector can decide whether to seed
  // the iframe with current server data (active=1, mirrors stream) or
  // leave it idle (active=0, overlay HTML stays in default-OFF state).
  //
  // Live (OBS) URLs DO NOT carry `preview=1` — they always render in
  // "isLive" mode so OBS browser sources see the current data on refresh.
  // Realtime updates flow through regardless.
  const isPreview = preview === "1";
  const isActive = !isPreview ? true : active === "1";

  // 2026-04-26 lower-third slot isolation — broadcast control mounts
  // 3 mini-preview iframes (one per slot 1..3). Each card passes
  // `?slot=N` so the static HTML can hide the other anchors + drop
  // postMessages / realtime targeting other slots. OBS URLs leave it
  // null so all 3 anchors render simultaneously on stream.
  const slotParsed = (() => {
    const n = Number(slot);
    return n === 1 || n === 2 || n === 3 ? (n as 1 | 2 | 3) : null;
  })();

  return (
    <OverlayDataInjector
      overlayKey={key}
      sessionId={session}
      token={token}
      seasonId={resolvedSeason ?? undefined}
      active={isActive}
      slot={slotParsed}
    />
  );
}
