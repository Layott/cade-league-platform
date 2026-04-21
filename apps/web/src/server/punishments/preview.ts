import type { SupabaseClient } from "@supabase/supabase-js";

export type PreviewedMatch = {
  matchId: string;
  matchDayId: string;
  matchDate: string;
  opponentId: string;
  opponentTag: string;
  opponentDisplayName: string;
  venueName: string;
};

/**
 * Read-only counterpart to `propagate_suspension_voids`. Used by the
 * /admin/punishments/new live preview so admins see which fixtures a ban
 * will void BEFORE submitting the form.
 *
 * Logic mirrors the SQL function (plus opponent details for nicer UX):
 *   - matches where the player is home or away
 *   - match_day.match_date in [from, until]
 *   - matches.deleted_at is null AND match_days.deleted_at is null
 */
export async function previewSuspensionVoids(
  sb: SupabaseClient,
  playerId: string,
  effectiveFrom: string,
  effectiveUntil: string,
): Promise<PreviewedMatch[]> {
  if (!effectiveFrom || !effectiveUntil || effectiveUntil < effectiveFrom) return [];

  const { data, error } = await sb
    .from("matches")
    .select(
      `
      id, home_player_id, away_player_id, match_day_id,
      match_days!inner ( id, match_date, venue_name, deleted_at ),
      home:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey!inner ( display_name ) ),
      away:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey!inner ( display_name ) )
      `,
    )
    .is("deleted_at", null)
    .or(`home_player_id.eq.${playerId},away_player_id.eq.${playerId}`)
    .gte("match_days.match_date", effectiveFrom)
    .lte("match_days.match_date", effectiveUntil);
  if (error) throw new Error(`previewSuspensionVoids: ${error.message}`);

  type Row = {
    id: string;
    home_player_id: string;
    away_player_id: string;
    match_day_id: string;
    match_days: {
      id: string;
      match_date: string;
      venue_name: string;
      deleted_at: string | null;
    };
    home: { id: string; gamer_tag: string; users: { display_name: string } } | null;
    away: { id: string; gamer_tag: string; users: { display_name: string } } | null;
  };

  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.match_days.deleted_at === null,
  );

  return rows.map((r) => {
    const playerIsHome = r.home_player_id === playerId;
    const opp = playerIsHome ? r.away : r.home;
    return {
      matchId: r.id,
      matchDayId: r.match_day_id,
      matchDate: r.match_days.match_date,
      opponentId: opp?.id ?? "",
      opponentTag: opp?.gamer_tag ?? "",
      opponentDisplayName: opp?.users?.display_name ?? "",
      venueName: r.match_days.venue_name,
    };
  });
}
