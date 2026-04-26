import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ambient-session resolver (2026-04-26).
 *
 * OBS / vMix browser sources should be able to point at a stable URL like
 * `https://cade-league.vercel.app/overlay/v2/<key>` (NO `?session=<uuid>`)
 * and have the server resolve to the currently live `stream_sessions` row
 * at request time. Without this, every new broadcast forces operators to
 * re-paste 16+ browser-source URLs into OBS — a non-starter mid-event.
 *
 * "Active" = the most recent `stream_sessions` row where:
 *   - `ended_at IS NULL`           (still live)
 *   - `deleted_at IS NULL`         (not soft-deleted)
 * ordered by `started_at DESC`. If none exist (between events / on a fresh
 * deploy) the resolver returns null and the page renders the overlay
 * frame anyway in idle / default-OFF state — no crash, no redirect.
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
 * Lightweight variant — fetches just the session id. Skips the join with
 * `match_days` so the page-level resolve when only `?session` is empty
 * doesn't pay for the season hop unless it actually needs it (the page
 * will re-query season via `resolveSeasonId` if the URL didn't carry one).
 */
export async function getActiveSessionId(
  sb: SupabaseClient,
): Promise<string | null> {
  try {
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
 * Full variant — fetches sessionId + matchDayId + seasonId so callers
 * can pass everything to the overlay injector in one round-trip. Used by
 * the `/api/broadcast/active-session` endpoint.
 */
export async function getActiveSession(
  sb: SupabaseClient,
): Promise<ActiveSessionInfo | null> {
  try {
    const { data } = await sb
      .from("stream_sessions")
      .select(
        "id, match_day_id, view_token, match_days:match_day_id ( season_id )",
      )
      .is("ended_at", null)
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
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
  } catch {
    return null;
  }
}
