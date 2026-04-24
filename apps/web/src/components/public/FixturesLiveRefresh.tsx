"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  fixturesChannelName,
  FIXTURES_EVENT_CHANGED,
} from "@/server/fixtures/realtime";

/**
 * Live-refresh (2026-04-24) — client subscriber for `/fixtures`.
 *
 * Mirrors `StandingsLiveRefresh`: on mount, joins
 * `public:fixtures:<seasonId>` and re-runs the Server Component's
 * data fetch on every `fixtures.changed` event. No-op when there's
 * no active season.
 *
 * Fires on: match result entered / edited / confirmed, fixture
 * added / edited / removed, match day published / unpublished,
 * match re-ordered.
 */
export function FixturesLiveRefresh({
  seasonId,
}: {
  seasonId: string | null;
}): null {
  const router = useRouter();

  useEffect(() => {
    if (!seasonId) return;

    const sb = getBrowserSupabase();
    const channel = sb.channel(fixturesChannelName(seasonId), {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: FIXTURES_EVENT_CHANGED }, () => {
        router.refresh();
      })
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [seasonId, router]);

  return null;
}
