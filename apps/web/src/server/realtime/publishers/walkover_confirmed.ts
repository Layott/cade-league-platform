import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 51 — walkover-confirmed realtime publisher.
 *
 * Fires when an admin confirms a referee-marked walkover, OR when an admin
 * triggers a walkover directly (which is implicitly already confirmed).
 * Subscribers display a "WALKOVER" pill on the match card + flip the
 * fixture state to forfeited.
 */

export const WALKOVER_CONFIRMED_EVENT = "walkover.confirmed" as const;

export type WalkoverConfirmedPayload = {
  seasonId: string;
  matchId: string;
  winnerPlayerId: string;
  initiatedBy: "admin" | "ref";
  at: string;
};

export function walkoverConfirmedChannelName(seasonId: string): string {
  return `public:standings:${seasonId}`;
}

export type PublishResult = "ok" | "timed out" | "error";

export async function publishWalkoverConfirmed(
  sb: SupabaseClient,
  payload: WalkoverConfirmedPayload,
): Promise<PublishResult> {
  const channel = sb.channel(walkoverConfirmedChannelName(payload.seasonId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: WALKOVER_CONFIRMED_EVENT,
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
