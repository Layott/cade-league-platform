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
};

/**
 * Build the relative URL for the v2 overlay route. Caller is responsible
 * for prefixing with the deployment origin when copying-to-clipboard.
 */
export function v2OverlayUrl(
  key: V2OverlayKey,
  sessionId: string,
  viewToken: string | null,
  preview = false,
): string {
  const params = new URLSearchParams();
  params.set("session", sessionId);
  if (viewToken) params.set("token", viewToken);
  if (preview) params.set("preview", "1");
  return `/overlay/v2/${key}?${params.toString()}`;
}
