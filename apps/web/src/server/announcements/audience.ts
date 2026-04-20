import type { SupabaseClient } from "@supabase/supabase-js";

export type AnnouncementAudience = {
  audience_type: "all" | "role" | "users" | "players_in_season";
  audience_role?: string | null;
  audience_user_ids?: string[] | null;
};

/**
 * Expand an announcement's audience declaration into a concrete list
 * of public.users.id values. Always dedupes and filters out soft-deleted users.
 */
export async function expandAudience(
  sb: SupabaseClient,
  ann: AnnouncementAudience
): Promise<string[]> {
  const ids: string[] = [];

  switch (ann.audience_type) {
    case "all": {
      const { data } = await sb
        .from("users")
        .select("id")
        .is("deleted_at", null);
      for (const r of (data ?? []) as { id: string }[]) ids.push(r.id);
      break;
    }

    case "role": {
      if (!ann.audience_role) return [];
      const { data } = await sb
        .from("user_roles")
        .select("user_id")
        .eq("role", ann.audience_role)
        .is("deleted_at", null);
      for (const r of (data ?? []) as { user_id: string }[]) ids.push(r.user_id);
      break;
    }

    case "users": {
      const requested = ann.audience_user_ids ?? [];
      if (requested.length === 0) return [];
      const { data } = await sb
        .from("users")
        .select("id")
        .in("id", requested)
        .is("deleted_at", null);
      for (const r of (data ?? []) as { id: string }[]) ids.push(r.id);
      break;
    }

    case "players_in_season": {
      // season_participants → players → users.id, active seasons only.
      const { data } = await sb
        .from("season_participants")
        .select("player:players(user_id), season:seasons(status)")
        .is("deleted_at", null);
      for (const r of (data ?? []) as {
        player: { user_id: string | null } | null;
        season: { status: string } | null;
      }[]) {
        if (r.season?.status === "active" && r.player?.user_id) {
          ids.push(r.player.user_id);
        }
      }
      break;
    }
  }

  return Array.from(new Set(ids));
}
