import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 51 — standings-recomputed realtime publisher.
 *
 * Server-side wrapper for the existing `standings.changed` event. The DB
 * trigger on `recompute_standings()` already fires this from Postgres, but
 * code paths that recompute via the API layer (admin "force recompute"
 * button, seed scripts, backfill tools) need to manually fire the same
 * event so subscribers can refresh.
 */

export const STANDINGS_RECOMPUTED_EVENT = "standings.changed" as const;

export type StandingsRecomputedPayload = {
  seasonId: string;
  at: string;
};

export function standingsRecomputedChannelName(seasonId: string): string {
  return `public:standings:${seasonId}`;
}

export type PublishResult = "ok" | "timed out" | "error";

export async function publishStandingsRecomputed(
  sb: SupabaseClient,
  payload: StandingsRecomputedPayload,
): Promise<PublishResult> {
  const channel = sb.channel(standingsRecomputedChannelName(payload.seasonId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: STANDINGS_RECOMPUTED_EVENT,
      payload,
    })) as unknown as PublishResult;
    return status ?? "ok";
  } finally {
    try {
      await sb.removeChannel(channel);
    } catch {
      // best-effort cleanup
    }
  }
}
