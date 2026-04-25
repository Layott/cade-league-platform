import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import OverlayDataInjector from "@/components/broadcast/v2/OverlayDataInjector";

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
};

export default async function OverlayV2Page({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const { key } = await params;
  const { session, token, season } = await searchParams;
  if (!ALLOWED_KEYS.has(key)) redirect("/overlay/v2/01-brb");
  return (
    <OverlayDataInjector
      overlayKey={key}
      sessionId={session}
      token={token}
      seasonId={season}
    />
  );
}
