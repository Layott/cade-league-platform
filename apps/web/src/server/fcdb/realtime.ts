import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 2026-05-02 — fcdb refresh fan-out.
 *
 * Scrapers + backfill scripts publish on this channel after a batch
 * completes so chem-dependent overlays (currently only
 * `19-player-squads`) re-fetch from `/api/broadcast/v2/sessions/[id]/
 * player-squads`. Without this fan-out the live OBS source keeps the
 * pre-backfill chem total (e.g. Mr Oga 7/33) until the operator
 * manually re-triggers the overlay.
 *
 * Channel is GLOBAL (not per-season). Single subscription on the
 * iframe side covers every player.
 *
 * Mirror in Node land: `KNOWLEDGE/extracted/_lib_realtime.js` exposes
 * the same channel name + event name + payload shape so scrapers can
 * fire the same broadcast from CommonJS.
 */
export const FCDB_CHANNEL = "public:fcdb";
export const FCDB_REFRESHED_EVENT = "fcdb.refreshed";

export type FcdbRefreshedPayload = {
  rowsChanged?: number;
  source?: string;
  at: string;
};

export async function publishFcdbRefreshed(
  sb: SupabaseClient,
  payload: Omit<FcdbRefreshedPayload, "at"> = {},
  at: Date = new Date(),
): Promise<void> {
  const channel = sb.channel(FCDB_CHANNEL);
  try {
    await channel.send({
      type: "broadcast",
      event: FCDB_REFRESHED_EVENT,
      payload: {
        ...payload,
        at: at.toISOString(),
      } satisfies FcdbRefreshedPayload,
    });
  } catch (err) {
    console.error("[fcdb] publish failed:", err);
  } finally {
    try {
      await sb.removeChannel(channel);
    } catch {
      // best-effort cleanup
    }
  }
}
