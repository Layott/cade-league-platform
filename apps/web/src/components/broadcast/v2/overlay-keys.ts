/**
 * Plan 51 — broadcast v2 overlay key registry.
 *
 * 16 overlay keys driven from the control room. The keys mirror the v2
 * mockup folders at `KNOWLEDGE/brand-assets/elements/v2/<NN-slug>/`. The
 * sibling agent UI-OV ships `/overlay/v2/<key>?session=...&token=...` for
 * each key — control panel iframes embed those routes.
 *
 * Excludes `03-animated-bg-*` (meta overlays) + `18-partners-strip`
 * (subsumed). MULTI_INSTANCE_KEYS is the v2 analogue of the legacy set
 * in `server/broadcast/v2/off_routing.ts` — only `08-lower-third` is
 * multi-instance (3 simultaneous slots) per spec §8.2.
 */

export const V2_OVERLAY_KEYS = [
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
  "19-player-squads",
  "20-highlight",
  "21-streaks",
  "22-power-rankings",
  "23-org-standings",
  "24-biggest-margins",
  "25-did-you-know",
  "26-card-meta",
  "27-schedule",
  "28-punditry",
  "29-goalfests",
] as const;

export type V2OverlayKey = (typeof V2_OVERLAY_KEYS)[number];

export const V2_MULTI_INSTANCE_KEYS: ReadonlySet<V2OverlayKey> = new Set([
  "08-lower-third",
] as V2OverlayKey[]);

export function isV2MultiInstanceKey(key: string): boolean {
  return V2_MULTI_INSTANCE_KEYS.has(key as V2OverlayKey);
}

export const V2_OVERLAY_LABELS: Record<V2OverlayKey, string> = {
  "01-brb": "BRB / Intermission",
  "02-timer": "Timer",
  "04-h2h-2": "H2H — 2 Players",
  "05-h2h-3": "H2H — 3 Players",
  "06-h2h-5": "H2H — 5 Players",
  "07-leaderboard": "Animated Leaderboard",
  "08-lower-third": "Lower Third (3 slots)",
  "09-secondary-score-bug": "Secondary Score Bug",
  "10-up-next-bug": "Up Next Bug",
  "11-match-scores-day": "Match Scores — Today",
  "12-starting-soon": "Starting Soon",
  "13-stream-ended": "Stream Ended",
  "14-top-scorers": "Top 10 Goal Scorers",
  "15-orgs": "Registered Orgs",
  "16-coaches": "Coach Introductions",
  "17-penalties": "Player Penalties",
  "19-player-squads": "Player Squads",
  "20-highlight": "Highlight",
  "21-streaks": "Win Streaks",
  "22-power-rankings": "Power Rankings",
  "23-org-standings": "Org Standings",
  "24-biggest-margins": "Biggest Wins",
  "25-did-you-know": "Did You Know",
  "26-card-meta": "Card Meta",
  "27-schedule": "Schedule Strip",
  "28-punditry": "Punditry Quote",
  "29-goalfests": "Goalfest Threshold",
};

/**
 * Build the relative URL for the v2 overlay route. Caller is responsible
 * for prefixing with the deployment origin when copying-to-clipboard.
 *
 * `active` is honoured ONLY on preview iframes (admin control room) so
 * the mini-preview can decide whether to seed the iframe with live data
 * or render in default-OFF idle state. Live (OBS) URLs never include it
 * — copy-to-clipboard / open-in-new-tab paths render the public overlay
 * which always seeds, since OBS browser sources have no notion of an
 * "off" state. Without this flag the mini-preview would always look
 * "live" regardless of the server's `overlay_active_instances` row.
 *
 * Ambient (2026-04-26):
 *
 *   When `preview=false` the URL omits `session` + `token` entirely so
 *   operators can paste a stable browser-source URL into OBS once and
 *   never re-paste across broadcast sessions / redeploys. The page-side
 *   resolver (`/overlay/v2/[key]/page.tsx`) calls
 *   `getActiveSession(getServiceRoleSupabase())` at request time and
 *   `OverlayDataInjector` polls `/api/broadcast/active-session` every
 *   30s so live overlays auto-resubscribe when the active session flips.
 *
 *   Slot is the only query param that survives onto a live URL — each
 *   lower-third slot needs its own browser source.
 *
 *   Preview URLs (`preview=true`) still embed the operator-pinned session
 *   so mini-previews in the control room never accidentally swap.
 */
export function v2OverlayUrl(
  key: V2OverlayKey,
  sessionId: string,
  viewToken: string | null,
  preview = false,
  active = false,
  slot: 1 | 2 | 3 | null = null,
): string {
  const params = new URLSearchParams();
  if (preview) {
    // Mini-preview iframes pin to the operator-picked session.
    params.set("session", sessionId);
    if (viewToken) params.set("token", viewToken);
    params.set("preview", "1");
    // Only mini-previews carry the active flag — see jsdoc above.
    params.set("active", active ? "1" : "0");
  }
  // 2026-04-26 lower-third slot isolation — broadcast control mounts
  // 3 mini-preview iframes (one per slot 1..3) for `08-lower-third`.
  // Each card passes its slot via this param so the static HTML can
  // hide the other 2 slots + drop incoming postMessages targeting other
  // slots. Live (OBS) URLs preserve slot so each anchor gets a separate
  // OBS browser-source URL.
  if (slot != null) params.set("slot", String(slot));
  const qs = params.toString();
  return qs ? `/overlay/v2/${key}?${qs}` : `/overlay/v2/${key}`;
}
