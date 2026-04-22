import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Plan 44 — session/YouTube-stream binding helpers.
 *
 * `bindLiveStream`  — pins a videoId + liveChatId onto the session.
 * `unbindLiveStream` — clears all three youtube_* columns.
 *
 * Both require `broadcast.match_control`. Writes audit via the generic
 * audit trigger (the caller sets `app.current_user_id` in the session
 * context; service-role supabase client is fine otherwise).
 */

const PERM = "broadcast.match_control";

export type SessionBinding = {
  sessionId: string;
  videoId: string;
  liveChatId: string;
  boundAt: string;
};

export async function bindLiveStream(
  sb: SupabaseClient,
  sessionId: string,
  videoId: string,
  liveChatId: string,
  actor: Actor,
): Promise<SessionBinding> {
  if (!sessionId.trim()) throw new Error("sessionId required");
  if (!videoId.trim()) throw new Error("videoId required");
  if (!liveChatId.trim()) throw new Error("liveChatId required");
  await requirePermAsync(sb, actor, PERM);

  const { data: sess } = await sb
    .from("stream_sessions")
    .select("id, ended_at")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!sess) throw new Error(`session not found: ${sessionId}`);
  if ((sess as { ended_at: string | null }).ended_at) {
    throw new Error(`session already ended: ${sessionId}`);
  }

  const boundAt = new Date().toISOString();
  const { error } = await sb
    .from("stream_sessions")
    .update({
      youtube_video_id: videoId,
      youtube_live_chat_id: liveChatId,
      youtube_bound_at: boundAt,
      updated_at: boundAt,
    })
    .eq("id", sessionId);
  if (error) {
    throw new Error(`bindLiveStream update failed: ${error.message}`);
  }
  return { sessionId, videoId, liveChatId, boundAt };
}

export async function unbindLiveStream(
  sb: SupabaseClient,
  sessionId: string,
  actor: Actor,
): Promise<{ sessionId: string; unboundAt: string }> {
  if (!sessionId.trim()) throw new Error("sessionId required");
  await requirePermAsync(sb, actor, PERM);

  const unboundAt = new Date().toISOString();
  const { error } = await sb
    .from("stream_sessions")
    .update({
      youtube_video_id: null,
      youtube_live_chat_id: null,
      youtube_bound_at: null,
      updated_at: unboundAt,
    })
    .eq("id", sessionId);
  if (error) {
    throw new Error(`unbindLiveStream update failed: ${error.message}`);
  }
  return { sessionId, unboundAt };
}

/**
 * Read the currently-bound YouTube video + liveChatId for a session.
 * Returns null when nothing is bound.
 */
export async function getSessionBinding(
  sb: SupabaseClient,
  sessionId: string,
): Promise<{
  videoId: string;
  liveChatId: string;
  boundAt: string;
} | null> {
  const { data } = await sb
    .from("stream_sessions")
    .select("youtube_video_id, youtube_live_chat_id, youtube_bound_at")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    youtube_video_id: string | null;
    youtube_live_chat_id: string | null;
    youtube_bound_at: string | null;
  };
  if (!row.youtube_video_id || !row.youtube_live_chat_id) return null;
  return {
    videoId: row.youtube_video_id,
    liveChatId: row.youtube_live_chat_id,
    boundAt: row.youtube_bound_at ?? "",
  };
}
