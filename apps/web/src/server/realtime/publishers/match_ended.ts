import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 51 — match-ended realtime publisher.
 *
 * Companion to `score_changed`. Fires when a match transitions from
 * in-progress to confirmed. The tournament page replaces the live score
 * panel with the final result, and the leaderboard widget refreshes
 * (recompute already fires its own standings.changed, but this carries
 * the matchId for direct UI swaps).
 */

export const MATCH_ENDED_EVENT = "match.ended" as const;

export type MatchEndedPayload = {
  seasonId: string;
  matchId: string;
  homePlayerId: string;
  awayPlayerId: string;
  homeScore: number;
  awayScore: number;
  resultType: "normal" | "forfeit" | "void";
  at: string;
};

export function matchEndedChannelName(seasonId: string): string {
  return `public:standings:${seasonId}`;
}

export type PublishResult = "ok" | "timed out" | "error";

export async function publishMatchEnded(
  sb: SupabaseClient,
  payload: MatchEndedPayload,
): Promise<PublishResult> {
  const channel = sb.channel(matchEndedChannelName(payload.seasonId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: MATCH_ENDED_EVENT,
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
