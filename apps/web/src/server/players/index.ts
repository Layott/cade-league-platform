import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerView } from "./types";
import { getActiveSeason } from "@/server/seasons";

export async function listPlayersInActiveSeason(
  sb: SupabaseClient
): Promise<PlayerView[]> {
  const season = await getActiveSeason(sb);
  if (!season) return [];

  const { data, error } = await sb
    .from("season_participants")
    .select(
      `
      entry_status,
      players!inner (
        id, user_id, gamer_tag, psn_id, jersey_number, photo_url, bio,
        users!inner ( id, display_name )
      )
      `
    )
    .eq("season_id", season.id)
    .eq("entry_status", "confirmed")
    .is("deleted_at", null)
    .order("registered_at", { ascending: true });
  if (error) throw error;

  type Row = {
    entry_status: PlayerView["entry_status"];
    players: {
      id: string;
      user_id: string;
      gamer_tag: string;
      psn_id: string | null;
      jersey_number: number | null;
      photo_url: string | null;
      bio: string | null;
      users: { id: string; display_name: string };
    };
  };

  const rows = ((data ?? []) as unknown as Row[]).map<PlayerView>((r) => ({
    id: r.players.id,
    user_id: r.players.user_id,
    display_name: r.players.users.display_name,
    gamer_tag: r.players.gamer_tag,
    psn_id: r.players.psn_id,
    jersey_number: r.players.jersey_number,
    photo_url: r.players.photo_url,
    bio: r.players.bio,
    entry_status: r.entry_status,
  }));

  return rows.sort((a, b) => {
    const aj = a.jersey_number ?? Number.POSITIVE_INFINITY;
    const bj = b.jersey_number ?? Number.POSITIVE_INFINITY;
    if (aj !== bj) return aj - bj;
    return a.display_name.localeCompare(b.display_name);
  });
}

export async function getPlayerById(
  sb: SupabaseClient,
  playerId: string
): Promise<PlayerView | null> {
  const { data, error } = await sb
    .from("players")
    .select(
      `
      id, user_id, gamer_tag, psn_id, jersey_number, photo_url, bio,
      users!inner ( id, display_name )
      `
    )
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  type Row = {
    id: string;
    user_id: string;
    gamer_tag: string;
    psn_id: string | null;
    jersey_number: number | null;
    photo_url: string | null;
    bio: string | null;
    users: { id: string; display_name: string };
  };

  const row = data as unknown as Row;
  return {
    id: row.id,
    user_id: row.user_id,
    display_name: row.users.display_name,
    gamer_tag: row.gamer_tag,
    psn_id: row.psn_id,
    jersey_number: row.jersey_number,
    photo_url: row.photo_url,
    bio: row.bio,
    entry_status: "confirmed",
  };
}
