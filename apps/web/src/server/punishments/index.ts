import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const issueSchema = z
  .object({
    playerId: z.string().uuid(),
    matchId: z.string().uuid().optional().nullable(),
    incidentType: z.enum([
      "late_arrival",
      "absent",
      "forfeit",
      "equipment",
      "social_media",
      "unauthorized_access",
      "betting",
      "match_fixing",
      "dress_code",
      "preseason_miss",
      "other",
    ]),
    sanctionType: z.enum(["warning", "point_deduction", "gd_deduction", "forfeit", "ban"]),
    magnitude: z.coerce.number().int().min(0).default(0),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    effectiveUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable(),
    publicVisible: z.boolean().default(true),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (v) =>
      v.sanctionType !== "ban" ||
      (!!v.effectiveFrom && !!v.effectiveUntil && v.effectiveUntil >= v.effectiveFrom),
    {
      message:
        "ban sanction requires effectiveFrom + effectiveUntil (with until >= from); " +
        "the DB trigger propagates voids over that window",
      path: ["effectiveUntil"],
    },
  );
export type IssueInput = z.infer<typeof issueSchema>;

export type IssueResult = { caseId: string; actionId: string };

export async function issue(
  sb: SupabaseClient,
  reportedBy: string,
  raw: IssueInput
): Promise<IssueResult> {
  const input = issueSchema.parse(raw);

  const { data: caseRow, error: caseErr } = await sb
    .from("disciplinary_cases")
    .insert({
      player_id: input.playerId,
      match_id: input.matchId ?? null,
      incident_type: input.incidentType,
      reported_by: reportedBy,
    })
    .select("id")
    .single();
  if (caseErr || !caseRow) throw new Error(`case insert: ${caseErr?.message}`);

  const { data: actionRow, error: actionErr } = await sb
    .from("disciplinary_actions")
    .insert({
      case_id: caseRow.id,
      sanction_type: input.sanctionType,
      magnitude: input.magnitude,
      effective_from: input.effectiveFrom,
      effective_until: input.effectiveUntil ?? null,
      imposed_by: reportedBy,
      public_visible: input.publicVisible,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (actionErr || !actionRow) throw new Error(`action insert: ${actionErr?.message}`);

  if (input.sanctionType === "forfeit" && input.matchId) {
    await applyForfeitMatchResult(sb, input.matchId, input.playerId, reportedBy);
  }

  return { caseId: caseRow.id, actionId: actionRow.id };
}

export async function revoke(
  sb: SupabaseClient,
  actionId: string,
  reason: string
): Promise<void> {
  if (!reason || !reason.trim()) throw new Error("revoke requires a reason");

  const { error } = await sb
    .from("disciplinary_actions")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq("id", actionId);
  if (error) throw new Error(`revoke: ${error.message}`);
}

export type PublicPunishment = {
  id: string;
  case_id: string;
  sanction_type: string;
  magnitude: number;
  imposed_at: string;
  effective_from: string;
  notes: string | null;
  player: { id: string; gamer_tag: string; display_name: string };
  incident_type: string;
};

export async function listPublic(sb: SupabaseClient, limit = 50): Promise<PublicPunishment[]> {
  const { data, error } = await sb
    .from("disciplinary_actions")
    .select(
      `
      id, case_id, sanction_type, magnitude, imposed_at, effective_from, notes,
      disciplinary_cases!inner (
        incident_type,
        players!inner (
          id, gamer_tag,
          users:users!players_user_id_fkey!inner ( display_name )
        )
      )
      `
    )
    .eq("public_visible", true)
    .is("revoked_at", null)
    .is("deleted_at", null)
    .order("imposed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listPublic: ${error.message}`);

  type Row = {
    id: string;
    case_id: string;
    sanction_type: string;
    magnitude: number;
    imposed_at: string;
    effective_from: string;
    notes: string | null;
    disciplinary_cases: {
      incident_type: string;
      players: {
        id: string;
        gamer_tag: string;
        users: { display_name: string };
      };
    };
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    case_id: r.case_id,
    sanction_type: r.sanction_type,
    magnitude: r.magnitude,
    imposed_at: r.imposed_at,
    effective_from: r.effective_from,
    notes: r.notes,
    player: {
      id: r.disciplinary_cases.players.id,
      gamer_tag: r.disciplinary_cases.players.gamer_tag,
      display_name: r.disciplinary_cases.players.users.display_name,
    },
    incident_type: r.disciplinary_cases.incident_type,
  }));
}

export async function listAllForAdmin(sb: SupabaseClient): Promise<
  Array<PublicPunishment & { revoked_at: string | null; revoke_reason: string | null }>
> {
  const { data, error } = await sb
    .from("disciplinary_actions")
    .select(
      `
      id, case_id, sanction_type, magnitude, imposed_at, effective_from, notes,
      revoked_at, revoke_reason,
      disciplinary_cases!inner (
        incident_type,
        players!inner (
          id, gamer_tag,
          users:users!players_user_id_fkey!inner ( display_name )
        )
      )
      `
    )
    .is("deleted_at", null)
    .order("imposed_at", { ascending: false });
  if (error) throw new Error(`listAll: ${error.message}`);

  type Row = {
    id: string;
    case_id: string;
    sanction_type: string;
    magnitude: number;
    imposed_at: string;
    effective_from: string;
    notes: string | null;
    revoked_at: string | null;
    revoke_reason: string | null;
    disciplinary_cases: {
      incident_type: string;
      players: {
        id: string;
        gamer_tag: string;
        users: { display_name: string };
      };
    };
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    case_id: r.case_id,
    sanction_type: r.sanction_type,
    magnitude: r.magnitude,
    imposed_at: r.imposed_at,
    effective_from: r.effective_from,
    notes: r.notes,
    revoked_at: r.revoked_at,
    revoke_reason: r.revoke_reason,
    player: {
      id: r.disciplinary_cases.players.id,
      gamer_tag: r.disciplinary_cases.players.gamer_tag,
      display_name: r.disciplinary_cases.players.users.display_name,
    },
    incident_type: r.disciplinary_cases.incident_type,
  }));
}

export async function listForPlayer(
  sb: SupabaseClient,
  playerId: string
): Promise<PublicPunishment[]> {
  const { data, error } = await sb
    .from("disciplinary_cases")
    .select(
      `
      incident_type,
      players!inner ( id, gamer_tag, users:users!players_user_id_fkey!inner ( display_name ) ),
      disciplinary_actions!inner (
        id, case_id, sanction_type, magnitude, imposed_at, effective_from, notes,
        public_visible, revoked_at, deleted_at
      )
      `
    )
    .eq("player_id", playerId)
    .is("deleted_at", null);
  if (error) throw new Error(`listForPlayer: ${error.message}`);

  type Row = {
    incident_type: string;
    players: {
      id: string;
      gamer_tag: string;
      users: { display_name: string };
    };
    disciplinary_actions: Array<{
      id: string;
      case_id: string;
      sanction_type: string;
      magnitude: number;
      imposed_at: string;
      effective_from: string;
      notes: string | null;
      public_visible: boolean;
      revoked_at: string | null;
      deleted_at: string | null;
    }>;
  };

  const rows: PublicPunishment[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    for (const a of r.disciplinary_actions) {
      if (a.deleted_at || a.revoked_at || !a.public_visible) continue;
      rows.push({
        id: a.id,
        case_id: a.case_id,
        sanction_type: a.sanction_type,
        magnitude: a.magnitude,
        imposed_at: a.imposed_at,
        effective_from: a.effective_from,
        notes: a.notes,
        player: {
          id: r.players.id,
          gamer_tag: r.players.gamer_tag,
          display_name: r.players.users.display_name,
        },
        incident_type: r.incident_type,
      });
    }
  }
  return rows.sort((a, b) => b.imposed_at.localeCompare(a.imposed_at));
}

export async function applyForfeitMatchResult(
  sb: SupabaseClient,
  matchId: string,
  forfeitingPlayerId: string,
  actorUserId: string
): Promise<void> {
  const { data: match, error } = await sb
    .from("matches")
    .select("id, home_player_id, away_player_id")
    .eq("id", matchId)
    .single();
  if (error || !match) throw new Error(`forfeit: match ${matchId} not found`);

  const forfeitingIsHome = match.home_player_id === forfeitingPlayerId;
  const homeScore = forfeitingIsHome ? 0 : 3;
  const awayScore = forfeitingIsHome ? 3 : 0;

  await sb.from("match_results").upsert(
    {
      match_id: matchId,
      home_score: homeScore,
      away_score: awayScore,
      result_type: "forfeit",
      entered_by: actorUserId,
      confirmed_by: actorUserId,
      confirmed_at: new Date().toISOString(),
      notes: "auto-set by forfeit sanction",
    },
    { onConflict: "match_id" }
  );

  await sb.from("matches").update({ status: "forfeited" }).eq("id", matchId);
}
