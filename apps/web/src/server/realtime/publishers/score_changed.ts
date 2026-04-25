import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 51 — score-changed realtime publisher.
 *
 * Pushes a `score.changed` broadcast on `public:standings:<seasonId>`. The
 * tournament page subscribes to this topic so the league-table widget +
 * the in-progress match panel can refresh without polling.
 *
 * Channel name + event name MUST match `apps/web/src/server/standings/
 * realtime.ts` and `REALTIME` in the overlay registry — clients subscribe
 * by topic + event without knowing which side fired.
 */

export const SCORE_CHANGED_EVENT = "score.changed" as const;

export type ScoreChangedPayload = {
  seasonId: string;
  matchId: string;
  homePlayerId: string;
  awayPlayerId: string;
  homeScore: number;
  awayScore: number;
  at: string;
};

export function scoreChangedChannelName(seasonId: string): string {
  return `public:standings:${seasonId}`;
}

export type PublishResult = "ok" | "timed out" | "error";

/**
 * Fire-and-forget publish. The match_results row is the durable record;
 * a failed broadcast must never bubble up.
 */
export async function publishScoreChanged(
  sb: SupabaseClient,
  payload: ScoreChangedPayload,
): Promise<PublishResult> {
  const channel = sb.channel(scoreChangedChannelName(payload.seasonId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: SCORE_CHANGED_EVENT,
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
