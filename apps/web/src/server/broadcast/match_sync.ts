import type { SupabaseClient } from "@supabase/supabase-js";
import { publish } from "./realtime";
import { REALTIME } from "@/server/overlays/registry";
import { triggerOverlay, listActiveOverlays } from "./events";

/**
 * Slice 2 of the leaderboard / broadcast linking audit
 * (see `docs/superpowers/specs/2026-04-24-leaderboard-broadcast-linking-audit.md`
 *  §3 gap P0-M2).
 *
 * Bridges the admin `/admin/match-days/[id]` score-entry path into the live
 * broadcast overlay system. When a ref types a score via the match-days
 * form and the same match is currently pinned to a live `stream_sessions`
 * slot (primary or secondary), this helper finds the active `score_bug`
 * overlay for that slot, rewrites its payload with the just-entered
 * absolute score, and re-triggers it via Supabase Realtime so the on-air
 * scorebug updates immediately.
 *
 * Design notes
 * ------------
 * • Authoritative direction. match-days writes absolute scores (0..99) —
 *   NOT deltas. We replace the payload wholesale, preserving player
 *   identity + photos from the existing payload so we don't accidentally
 *   re-seed them (and silently drop the slot's current displayed
 *   jersey/photo metadata).
 * • Idempotent. If the existing score_bug payload already reflects
 *   (homeGoals, awayGoals), we skip the trigger + publish entirely. A
 *   double-emit from a race between the match-days form and the
 *   broadcast-panel +1 buttons is therefore silently collapsed — the
 *   matchId-pinned slot is the natural dedup key.
 * • Perms. This helper is invoked from an already perm-gated server
 *   action (`enterResultAction` / `editResultAction` checked
 *   `matches.edit` / `broadcast.match_control` upstream). The helper
 *   itself is pure plumbing — no extra perm check.
 * • Best-effort. Realtime publish failures are swallowed; DB writes for
 *   the match_result already committed in the caller's transaction-ish
 *   flow.
 *
 * Does NOT touch:
 *   - `match_results` (caller already wrote it)
 *   - `recompute_standings` (DB trigger handles that)
 *   - The overlay renderer pages under `apps/web/src/app/(overlay)/**`
 *   - `endMatch` — remains the authoritative "game is over" path
 */

const SCORE_BUG_KEY = "score_bug";

export type SlotKey = "primary" | "secondary";

export type LiveSessionSlot = {
  sessionId: string;
  slot: SlotKey;
};

export type SyncResult = {
  /** Total sessions × slots that had the match pinned. */
  pinnedSlots: LiveSessionSlot[];
  /** Sessions × slots where we actually retriggered the score_bug
   *  (a pinned slot with no active bug OR a bug already at the target
   *  score is NOT retriggered). */
  updatedSlots: LiveSessionSlot[];
};

/**
 * Find every currently-live (ended_at IS NULL, deleted_at IS NULL)
 * stream_sessions row that has `matchId` pinned on the primary or
 * secondary slot. Returns one entry per (session, slot). An unusual
 * scenario where the same match is pinned to BOTH slots of the same
 * session (primary AND secondary) would produce two entries — we honour
 * whatever the DB says.
 */
export async function findLiveSessionSlotsForMatch(
  sb: SupabaseClient,
  matchId: string,
): Promise<LiveSessionSlot[]> {
  // One round-trip: OR-filter on both slot columns. `.or(...)` syntax
  // matches supabase-js v2.
  const { data, error } = await sb
    .from("stream_sessions")
    .select("id, primary_match_id, secondary_match_id")
    .or(`primary_match_id.eq.${matchId},secondary_match_id.eq.${matchId}`)
    .is("ended_at", null)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`findLiveSessionSlotsForMatch failed: ${error.message}`);
  }
  const rows = (data ?? []) as {
    id: string;
    primary_match_id: string | null;
    secondary_match_id: string | null;
  }[];
  const out: LiveSessionSlot[] = [];
  for (const r of rows) {
    if (r.primary_match_id === matchId) {
      out.push({ sessionId: r.id, slot: "primary" });
    }
    if (r.secondary_match_id === matchId) {
      out.push({ sessionId: r.id, slot: "secondary" });
    }
  }
  return out;
}

type ScoreBugOverlayRow = {
  id: string;
  payload: {
    players?: Array<{
      displayName?: string;
      photoUrl?: string;
      score?: number;
    }>;
    matchId?: string;
    slot?: string;
  };
};

/**
 * Find the currently-active score_bug overlay row for a session + slot.
 * Mirrors `findScoreBugForSlot` inside match_flow.ts so we don't have to
 * export private helpers.
 */
async function findScoreBugForSlot(
  sb: SupabaseClient,
  sessionId: string,
  slot: SlotKey,
): Promise<ScoreBugOverlayRow | null> {
  const active = await listActiveOverlays(sb, sessionId);
  const match = active.find(
    (a) =>
      a.template_key === SCORE_BUG_KEY &&
      ((a.payload as { slot?: string } | null)?.slot ?? "primary") === slot,
  );
  if (!match) return null;
  return {
    id: match.id,
    payload: match.payload as ScoreBugOverlayRow["payload"],
  };
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(99, Math.trunc(n)));
}

/**
 * Main entry point. Call from server actions that mutate match_results
 * with absolute scores. Safe to call with a matchId that isn't pinned
 * anywhere — that's a no-op returning `{pinnedSlots: [], updatedSlots: []}`.
 *
 * The actorUserId is used as the `triggered_by_user_id` on the new
 * overlay_events row. Pass the caller's public users.id — the match-days
 * score-entry action already resolves this via `currentPublicUserId()`.
 */
export async function syncScoreToLiveSessions(
  sb: SupabaseClient,
  matchId: string,
  homeGoals: number,
  awayGoals: number,
  actorUserId: string,
): Promise<SyncResult> {
  const home = clampScore(homeGoals);
  const away = clampScore(awayGoals);

  const pinnedSlots = await findLiveSessionSlotsForMatch(sb, matchId);
  if (pinnedSlots.length === 0) {
    return { pinnedSlots: [], updatedSlots: [] };
  }

  const updatedSlots: LiveSessionSlot[] = [];

  for (const entry of pinnedSlots) {
    const existing = await findScoreBugForSlot(sb, entry.sessionId, entry.slot);
    if (!existing) {
      // No active score_bug for this slot. Don't synthesise one — match
      // isn't "in the bug's universe" yet. Producer must start the match
      // via broadcast panel (spawns the bug). Skipping matches the
      // upstream spec intent: the bug is owned by the broadcast flow.
      continue;
    }

    const players = Array.isArray(existing.payload.players)
      ? existing.payload.players
      : [];
    if (players.length !== 2) {
      // Malformed payload — don't risk a Zod-reject loop. Log-silent skip.
      continue;
    }

    const currentHome = clampScore(players[0]?.score ?? 0);
    const currentAway = clampScore(players[1]?.score ?? 0);
    if (currentHome === home && currentAway === away) {
      // Idempotency — bug already shows the target score. No-op.
      continue;
    }

    const nextPayload = {
      players: [
        {
          displayName: players[0]?.displayName ?? "—",
          ...(players[0]?.photoUrl ? { photoUrl: players[0].photoUrl } : {}),
          score: home,
        },
        {
          displayName: players[1]?.displayName ?? "—",
          ...(players[1]?.photoUrl ? { photoUrl: players[1].photoUrl } : {}),
          score: away,
        },
      ],
      matchId: existing.payload.matchId ?? matchId,
      slot: entry.slot,
    };

    // Clear the old active row + trigger a fresh one so the
    // "one active score_bug per (session, slot)" invariant in
    // match_flow.ts is preserved.
    const now = new Date().toISOString();
    const { error: clearErr } = await sb
      .from("overlay_events")
      .update({ cleared_at: now })
      .eq("id", existing.id)
      .is("cleared_at", null);
    if (clearErr) {
      throw new Error(
        `syncScoreToLiveSessions: clear existing score_bug failed: ${clearErr.message}`,
      );
    }

    await triggerOverlay(sb, {
      sessionId: entry.sessionId,
      templateKey: SCORE_BUG_KEY,
      payload: nextPayload,
      userId: actorUserId,
    });

    // Secondary signal for non-overlay consumers (mirrors match_flow.updateScoreBug).
    try {
      await publish(sb, entry.sessionId, REALTIME.eventScoreChanged, {
        matchId,
        slot: entry.slot,
        homeScore: home,
        awayScore: away,
      });
    } catch {
      // swallow — best-effort
    }

    updatedSlots.push(entry);
  }

  return { pinnedSlots, updatedSlots };
}
