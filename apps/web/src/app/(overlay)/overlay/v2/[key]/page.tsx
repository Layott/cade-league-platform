import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import OverlayDataInjector from "@/components/broadcast/v2/OverlayDataInjector";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { getActiveSession } from "@/server/broadcast/active_session";
import { isOverlayActive } from "@/server/broadcast/v2/overlay_active_state";
import type { V2OverlayKey } from "@/components/broadcast/v2/overlay-keys";

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

  // Ambient-session resolve (2026-04-26):
  //
  // OBS / vMix browser sources should be able to point at a stable
  // `https://cade-league.vercel.app/overlay/v2/<key>` URL with NO
  // `?session=` query param and have the server resolve to whichever
  // `stream_sessions` row is currently live. Operators paste the URL once
  // into OBS, then never re-paste across sessions / redeploys.
  //
  // Behaviour:
  //   - explicit `?session=<uuid>` in the URL  → use it (back-compat)
  //   - `?session=current` (sentinel)          → resolve server-side
  //   - missing `session`                      → resolve server-side
  //   - resolve returns null (no live session) → render anyway with
  //     `sessionId=undefined`. The injector handles the empty case
  //     gracefully (no fetch, no channel) and the static HTML stays
  //     in default-OFF state.
  let resolvedSession = session;
  let resolvedSeason: string | null | undefined = season;
  // 2026-04-26 — when ambient resolution kicks in, also adopt the active
  // session's `view_token` so the iframe's INITIAL_FETCH_PATH calls pass
  // the gate. OBS browser sources paste the bare ambient URL with no
  // `?token=` query param; without this, every `/api/broadcast/sessions/
  // <id>/<feed>` call returns 401 and the static demo HTML leaks
  // through. Explicit `?token=<...>` from the caller wins.
  let resolvedToken: string | undefined = token;
  if (!resolvedSession || resolvedSession === "current") {
    const ambient = await getActiveSession(getServiceRoleSupabase());
    if (ambient) {
      resolvedSession = ambient.sessionId;
      // Prefer ambient season unless caller explicitly passed `?season=`.
      if (!resolvedSeason) resolvedSeason = ambient.seasonId ?? undefined;
      if (!resolvedToken && ambient.viewToken) {
        resolvedToken = ambient.viewToken;
      }
    } else {
      resolvedSession = undefined;
    }
  }
  // If we still don't have a season but we DO have a session, fall back
  // to the legacy per-session resolver (joins via match_day).
  if (!resolvedSeason && resolvedSession) {
    resolvedSeason = (await resolveSeasonId(resolvedSession)) ?? undefined;
  }

  // S2 smoke fix (2026-04-26) — Bug CC#2.
  //
  // The mini-preview iframes inside the broadcast control room append
  // `?preview=1&active=0|1` so the injector can decide whether to seed
  // the iframe with current server data (active=1, mirrors stream) or
  // leave it idle (active=0, overlay HTML stays in default-OFF state).
  //
  // Live (OBS) URLs DO NOT carry `preview=1`. Until 2026-04-26 they
  // ALWAYS rendered as active=true, which caused data-driven overlays
  // (match-scores-day, leaderboard, top-scorers) to "auto-load" with
  // current data the moment the OBS browser source opened — even when
  // the operator had not yet triggered the overlay on stream. User
  // bug 2026-04-26: "the match scores today overlay loads automatically
  // without trigger". Fix: probe `overlay_events` for an active row
  // and only flip `active=true` when the server says the overlay is
  // currently triggered. Realtime `overlay.triggered` / `instance.
  // triggered` events still flip the iframe to visible mid-stream.
  const isPreview = preview === "1";
  let isActive: boolean;
  if (isPreview) {
    isActive = active === "1";
  } else if (resolvedSession && (key as V2OverlayKey)) {
    try {
      isActive = await isOverlayActive(
        getServiceRoleSupabase(),
        resolvedSession,
        key as V2OverlayKey,
      );
    } catch {
      // Probe failure must not crash the overlay route — fall back to
      // hidden so a broken DB read does not flash stale data on stream.
      isActive = false;
    }
  } else {
    // No session resolved (no live broadcast) — keep overlay hidden.
    isActive = false;
  }

  // 2026-04-26 lower-third slot isolation — broadcast control mounts
  // 3 mini-preview iframes (one per slot 1..3). Each card passes
  // `?slot=N` so the static HTML can hide the other anchors + drop
  // postMessages / realtime targeting other slots. OBS URLs leave it
  // null so all 3 anchors render simultaneously on stream.
  const slotParsed = (() => {
    const n = Number(slot);
    return n === 1 || n === 2 || n === 3 ? (n as 1 | 2 | 3) : null;
  })();

  // Ambient mode — only enabled for non-preview (live OBS / vMix) URLs.
  // Mini-previews in the broadcast control room embed `?preview=1` so they
  // stay pinned to the operator-picked session and never auto-swap.
  const ambient = !isPreview;

  return (
    <OverlayDataInjector
      overlayKey={key}
      sessionId={resolvedSession}
      token={resolvedToken}
      seasonId={resolvedSeason ?? undefined}
      active={isActive}
      slot={slotParsed}
      ambient={ambient}
    />
  );
}
