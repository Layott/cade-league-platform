import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 51 — snapshot-captured realtime publisher.
 *
 * Fires when `captureSnapshot(matchDayId)` lands a new row. Subscribers
 * (admin standings page, archive panel) refresh their "Match Day N
 * snapshot" listing without polling.
 */

export const SNAPSHOT_CAPTURED_EVENT = "snapshot.captured" as const;

export type SnapshotCapturedPayload = {
  seasonId: string;
  matchDayId: number;
  snapshotId: number;
  at: string;
};

export function snapshotCapturedChannelName(seasonId: string): string {
  return `public:standings:${seasonId}`;
}

export type PublishResult = "ok" | "timed out" | "error";

export async function publishSnapshotCaptured(
  sb: SupabaseClient,
  payload: SnapshotCapturedPayload,
): Promise<PublishResult> {
  const channel = sb.channel(snapshotCapturedChannelName(payload.seasonId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: SNAPSHOT_CAPTURED_EVENT,
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
