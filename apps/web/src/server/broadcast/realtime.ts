import type { SupabaseClient } from "@supabase/supabase-js";
import { REALTIME } from "@/server/overlays/registry";

/**
 * Plan 12 — thin realtime publisher.
 *
 * Kept isolated so unit tests can mock this module without stubbing the
 * full supabase client. The publisher uses the caller-supplied client
 * (service-role in API routes) to push a "broadcast"-type message onto
 * the per-session channel. Fire-and-forget: the DB row is the durable
 * record, the broadcast is only the wake-up signal for subscribers.
 */

export type PublishResult = "ok" | "timed out" | "error";

export async function publish(
  sb: SupabaseClient,
  sessionId: string,
  event:
    | typeof REALTIME.eventTriggered
    | typeof REALTIME.eventCleared
    | typeof REALTIME.eventSessionEnded
    | typeof REALTIME.eventInstanceTriggered
    | typeof REALTIME.eventInstanceCleared
    | typeof REALTIME.eventClockChanged,
  payload: Record<string, unknown>,
): Promise<PublishResult> {
  const channel = sb.channel(REALTIME.channel(sessionId));
  try {
    // supabase-js returns "ok" | "timed out" | "error".
    const status = (await channel.send({
      type: "broadcast",
      event,
      payload,
    })) as unknown as PublishResult;
    return status ?? "ok";
  } finally {
    // Remove to avoid leaking channels. We don't need a long-lived
    // subscription — this is a one-shot signal.
    try {
      await sb.removeChannel(channel);
    } catch {
      // best-effort cleanup
    }
  }
}

// Re-export so tests can mock the channel wiring without touching the
// overlay registry.
export const channelName = REALTIME.channel;
