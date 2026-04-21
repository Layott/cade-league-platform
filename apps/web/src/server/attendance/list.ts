import type { SupabaseClient } from "@supabase/supabase-js";

export type RosterRow = {
  player_id: string;
  display_name: string;
  gamer_tag: string | null;
  jersey_number: number | null;
  mark_id: string | null;
  status: "present" | "late" | "absent" | null;
  marked_at: string | null;
  marked_by_id: string | null;
  marked_by_name: string | null;
  auto_action_id: string | null;
};

/**
 * Load the full participant roster for the match day's season, left-joined with
 * any existing attendance_mark. Players without a mark come back with nulls.
 */
export async function listByMatchDay(
  sb: SupabaseClient,
  matchDayId: string
): Promise<RosterRow[]> {
  // Resolve season for this match day.
  const { data: md } = await sb
    .from("match_days")
    .select("season_id")
    .eq("id", matchDayId)
    .single();
  if (!md) return [];

  // Pull season participants with player details.
  const { data: participants } = await sb
    .from("season_participants")
    .select(
      "player_id, players:player_id (id, jersey_number, gamer_tag, users:users!players_user_id_fkey (display_name))"
    )
    .eq("season_id", (md as { season_id: string }).season_id)
    .is("deleted_at", null);

  // Pull existing marks for this match day.
  const { data: marks } = await sb
    .from("attendance_marks")
    .select(
      "id, player_id, status, marked_at, auto_action_id, marked_by, markers:marked_by (display_name)"
    )
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null);

  type MarkJoin = {
    id: string;
    player_id: string;
    status: "present" | "late" | "absent";
    marked_at: string;
    auto_action_id: string | null;
    marked_by: string | null;
    markers: { display_name: string | null } | null;
  };
  const marksByPlayer = new Map<string, MarkJoin>();
  ((marks ?? []) as unknown as MarkJoin[]).forEach((m) => {
    marksByPlayer.set(m.player_id, m);
  });

  type ParticipantJoin = {
    player_id: string;
    players: {
      id: string;
      jersey_number: number | null;
      gamer_tag: string | null;
      users: { display_name: string | null } | null;
    } | null;
  };

  return ((participants ?? []) as unknown as ParticipantJoin[]).map((p) => {
    const player = p.players;
    const users = player?.users ?? null;
    const mark = marksByPlayer.get(p.player_id) ?? null;
    const markers = mark?.markers ?? null;
    return {
      player_id: p.player_id,
      display_name: users?.display_name ?? "(unknown)",
      gamer_tag: player?.gamer_tag ?? null,
      jersey_number: player?.jersey_number ?? null,
      mark_id: mark?.id ?? null,
      status: mark?.status ?? null,
      marked_at: mark?.marked_at ?? null,
      marked_by_id: mark?.marked_by ?? null,
      marked_by_name: markers?.display_name ?? null,
      auto_action_id: mark?.auto_action_id ?? null,
    };
  });
}
