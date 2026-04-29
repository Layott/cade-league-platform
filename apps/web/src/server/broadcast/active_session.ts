import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ambient-session resolver (2026-04-26 / hardened 2026-04-29).
 *
 * OBS / vMix browser sources should be able to point at a stable URL like
 * `https://cade-league.vercel.app/overlay/v2/<key>` (NO `?session=<uuid>`)
 * and have the server resolve to the currently live `stream_sessions` row
 * at request time. Without this, every new broadcast forces operators to
 * re-paste 16+ browser-source URLs into OBS — a non-starter mid-event.
 *
 * Bug 4 (2026-04-29) — "operator triggers MD-1 from admin but OBS shows
 * MD-8" was caused by selection ambiguity when multiple sessions share
 * `ended_at IS NULL`. Stale leftover sessions (test runs, mid-event
 * accidents, sessions a producer forgot to End) compete with the session
 * the operator is actually driving. Picking "latest started_at" reliably
 * pointed at the wrong session whenever a fresh leftover existed.
 *
 * The new selection rule:
 *   1. Prefer the session whose most-recent overlay-trigger activity
 *      (`overlay_events.triggered_at` ∪ `overlay_active_instances.
 *      triggered_at`) is the freshest. This naturally tracks "the
 *      session the operator is driving right now" because trigger
 *      events fire whenever an admin clicks a control card — exactly
 *      the action that should make a session the canonical "live"
 *      one.
 *   2. Fall back to the most-recent `started_at` when no trigger
 *      activity exists (fresh session that nobody has driven yet —
 *      the existing behaviour).
 *
 * Both candidate sets are restricted to:
 *   - `stream_sessions.ended_at IS NULL`
 *   - `stream_sessions.deleted_at IS NULL`
 *
 * Used by:
 *   - `/overlay/v2/[key]/page.tsx` (server-side resolve when query param
 *     is missing or set to the literal string `current`).
 *   - `/api/broadcast/active-session` (polled by `OverlayDataInjector`
 *     every 30s so live browser sources auto-resubscribe to the new
 *     channel when one session ends + another starts mid-stream).
 */

export type ActiveSessionInfo = {
  sessionId: string;
  matchDayId: string | null;
  seasonId: string | null;
  /**
   * 2026-04-26 — view_token surfaced so OBS / vMix browser sources hitting
   * the bare `https://cade-league.vercel.app/overlay/v2/<key>` URL can
   * authenticate the per-session data-feed endpoints (which require a
   * matching `?t=<view_token>`). Null for pre-Plan 39 historical rows.
   */
  viewToken: string | null;
};

/**
 * Internal — set of session IDs currently active (`ended_at IS NULL,
 * deleted_at IS NULL`). Returned as a Set for O(1) membership checks
 * during the activity-rank step.
 */
async function fetchActiveSessionIds(
  sb: SupabaseClient,
): Promise<Set<string>> {
  const { data } = await sb
    .from("stream_sessions")
    .select("id")
    .is("ended_at", null)
    .is("deleted_at", null);
  const out = new Set<string>();
  for (const r of (data ?? []) as { id: string }[]) {
    if (r.id) out.add(r.id);
  }
  return out;
}

/**
 * Bug 4 (2026-04-29) — pick the session ID with the most recent overlay
 * trigger activity, restricted to the candidate set passed in.
 *
 * Strategy:
 *   - Pull the latest `overlay_events.triggered_at` row across the live
 *     session set (1 round-trip, ordered DESC).
 *   - Pull the latest `overlay_active_instances.triggered_at` row across
 *     the same set (1 round-trip).
 *   - Return whichever stream_session_id has the freshest triggered_at
 *     between the two.
 *
 * Returns null when neither table has any row tied to a live session
 * (legitimate case: fresh session, never triggered yet → fall back to
 * `started_at` ordering at the call site).
 *
 * The query intentionally LIMITs broadly (top 25) so an `.in(...)` call
 * isn't required — overlay_events is high-cardinality, but pulling the
 * top N rows ordered by `triggered_at DESC` and filtering client-side
 * is cheaper than chunking an in-clause across hundreds of session ids.
 */
async function pickByMostRecentActivity(
  sb: SupabaseClient,
  liveIds: Set<string>,
): Promise<string | null> {
  if (liveIds.size === 0) return null;

  // Accumulator stored on a single object so TS doesn't narrow `bestAt`
  // to `never` after the first conditional update (which it tries to do
  // with bare `let bestAt: string | null = null` followed by `bestAt > x`
  // comparisons).
  const acc: { id: string | null; at: string | null } = {
    id: null,
    at: null,
  };

  function consider(row: {
    stream_session_id: string;
    triggered_at: string;
  }): void {
    if (!liveIds.has(row.stream_session_id)) return;
    const cur: string | null = acc.at;
    if (cur === null || row.triggered_at > cur) {
      acc.at = row.triggered_at;
      acc.id = row.stream_session_id;
    }
  }

  // overlay_events — single-instance triggers (most overlays)
  try {
    const { data } = await sb
      .from("overlay_events")
      .select("stream_session_id, triggered_at")
      .is("deleted_at", null)
      .order("triggered_at", { ascending: false })
      .limit(25);
    for (const row of (data ?? []) as {
      stream_session_id: string;
      triggered_at: string;
    }[]) {
      if (!liveIds.has(row.stream_session_id)) continue;
      consider(row);
      break; // ordered DESC + first live match wins
    }
  } catch {
    /* swallow — table may be empty / column missing in dev fixtures */
  }

  // overlay_active_instances — multi-instance (lower-third)
  try {
    const { data } = await sb
      .from("overlay_active_instances")
      .select("stream_session_id, triggered_at")
      .is("deleted_at", null)
      .order("triggered_at", { ascending: false })
      .limit(25);
    for (const row of (data ?? []) as {
      stream_session_id: string;
      triggered_at: string;
    }[]) {
      if (!liveIds.has(row.stream_session_id)) continue;
      consider(row);
      break;
    }
  } catch {
    /* swallow */
  }

  return acc.id;
}

/**
 * Lightweight variant — fetches just the session id. Skips the join with
 * `match_days` so the page-level resolve when only `?session` is empty
 * doesn't pay for the season hop unless it actually needs it (the page
 * will re-query season via `resolveSeasonId` if the URL didn't carry one).
 *
 * Bug 4 (2026-04-29) — selection now prefers most-recent overlay-trigger
 * activity over raw `started_at`. See module-level docstring.
 */
export async function getActiveSessionId(
  sb: SupabaseClient,
): Promise<string | null> {
  try {
    const liveIds = await fetchActiveSessionIds(sb);
    if (liveIds.size === 0) return null;
    if (liveIds.size === 1) {
      // Only one candidate — return it directly.
      return Array.from(liveIds)[0] ?? null;
    }
    const byActivity = await pickByMostRecentActivity(sb, liveIds);
    if (byActivity) return byActivity;
    // No triggers exist yet across any live session — fall back to
    // most-recent `started_at`.
    const { data } = await sb
      .from("stream_sessions")
      .select("id")
      .is("ended_at", null)
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Hydrate the full ActiveSessionInfo for a given session id (joins
 * match_days for season_id). Returns null when the session has been
 * deleted between the activity probe + this read.
 */
async function hydrateActiveSession(
  sb: SupabaseClient,
  sessionId: string,
): Promise<ActiveSessionInfo | null> {
  const { data } = await sb
    .from("stream_sessions")
    .select(
      "id, match_day_id, view_token, match_days:match_day_id ( season_id )",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    match_day_id: string | null;
    view_token: string | null;
    match_days?:
      | { season_id?: string | null }
      | { season_id?: string | null }[]
      | null;
  };
  const md = row.match_days;
  let seasonId: string | null = null;
  if (md) {
    seasonId = Array.isArray(md)
      ? md[0]?.season_id ?? null
      : md.season_id ?? null;
  }
  return {
    sessionId: row.id,
    matchDayId: row.match_day_id ?? null,
    seasonId,
    viewToken: row.view_token ?? null,
  };
}

/**
 * Full variant — fetches sessionId + matchDayId + seasonId so callers
 * can pass everything to the overlay injector in one round-trip. Used by
 * the `/api/broadcast/active-session` endpoint.
 *
 * Bug 4 (2026-04-29) — selection now prefers most-recent overlay-trigger
 * activity over raw `started_at`. See module-level docstring.
 */
export async function getActiveSession(
  sb: SupabaseClient,
): Promise<ActiveSessionInfo | null> {
  try {
    const liveIds = await fetchActiveSessionIds(sb);
    if (liveIds.size === 0) return null;

    let chosenId: string | null = null;
    if (liveIds.size === 1) {
      chosenId = Array.from(liveIds)[0] ?? null;
    } else {
      chosenId = await pickByMostRecentActivity(sb, liveIds);
      if (!chosenId) {
        // Fall back to most-recent started_at when no trigger activity
        // exists across any live session.
        const { data } = await sb
          .from("stream_sessions")
          .select("id")
          .is("ended_at", null)
          .is("deleted_at", null)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        chosenId = (data as { id?: string } | null)?.id ?? null;
      }
    }

    if (!chosenId) return null;
    return await hydrateActiveSession(sb, chosenId);
  } catch {
    return null;
  }
}
