import type { SupabaseClient } from "@supabase/supabase-js";
import { revoke as revokeAction, unrevoke as unrevokeAction } from "@/server/punishments";

/**
 * Plan 50: side-effect summary for an appeal ruling.
 *
 * When a panel UPHOLDS an appeal, the server automatically revokes every
 * live disciplinary_action on the linked case. For any ban among those,
 * the Plan 11 DB trigger (`on_ban_action_change`) then unwinds the
 * propagated match_results voids via `unpropagate_suspension_voids`. This
 * module wires both halves in one transaction-like flow.
 *
 * The structured `[appeal:<id>]` prefix on `disciplinary_actions.revoke_reason`
 * is the durable discriminator so the undo path can find exactly the
 * actions this appeal touched.
 */

export type AppealEffectDetail = {
  actionId: string;
  sanctionType: string;
  wasBan: boolean;
  /**
   * For ban actions, count of match_results rows that were voided while
   * the ban was live. Populated from the DB AFTER the revoke call — the
   * trigger wipes the voids so by the time we look they're gone, but we
   * capture the count BEFORE revoking.
   */
  voidedMatchesBefore: number;
};

export type AppealEffectSummary = {
  appealId: string;
  revokedActions: AppealEffectDetail[];
  /** Total voids that existed BEFORE the revoke cascaded (i.e. got un-voided). */
  totalMatchesUnvoided: number;
};

/**
 * Build the structured marker written into disciplinary_actions.revoke_reason
 * so the undo path can find exactly the rows this appeal revoked.
 */
export function appealRevokeReason(
  appealId: string,
  rulingSnippet: string,
  ruledAt: Date,
): string {
  const dateStr = ruledAt.toISOString().slice(0, 10);
  const safeSnippet = rulingSnippet.slice(0, 200).replace(/\s+/g, " ").trim();
  return `[appeal:${appealId}] Upheld on ${dateStr}. Panel ruling: ${safeSnippet || "(no ruling text)"}`;
}

export function parseAppealIdFromReason(reason: string | null): string | null {
  if (!reason) return null;
  const m = reason.match(/^\[appeal:([0-9a-f-]{36})\]/i);
  return m ? m[1] : null;
}

/**
 * Called from `rule()` when outcome === 'upheld'. For every non-revoked,
 * non-deleted disciplinary_action on the linked case, revoke it with a
 * reason tagged `[appeal:<id>]`. Returns the before-state count of voided
 * matches per ban action so the UI can render "N matches auto-voided".
 */
export async function onAppealUpheld(
  sb: SupabaseClient,
  args: {
    appealId: string;
    disciplinaryCaseId: string;
    actorUserId: string | null;
  },
): Promise<AppealEffectSummary> {
  // 1. Find every live action on the case.
  const { data: actions, error: actionsErr } = await sb
    .from("disciplinary_actions")
    .select("id, sanction_type, revoked_at, deleted_at")
    .eq("case_id", args.disciplinaryCaseId)
    .is("deleted_at", null)
    .is("revoked_at", null);
  if (actionsErr) {
    throw new Error(`onAppealUpheld actions lookup: ${actionsErr.message}`);
  }

  type Action = {
    id: string;
    sanction_type: string;
    revoked_at: string | null;
    deleted_at: string | null;
  };
  const liveActions = (actions ?? []) as Action[];

  // 2. Resolve the appeal's ruling text so the revoke_reason carries the
  //    panel's words, not a placeholder.
  const { data: appealRow } = await sb
    .from("appeals")
    .select("ruling, ruled_at")
    .eq("id", args.appealId)
    .maybeSingle();
  const ruling = (appealRow as { ruling: string | null } | null)?.ruling ?? "";
  const ruledAt = new Date();
  const reason = appealRevokeReason(args.appealId, ruling, ruledAt);

  // 3. For each live action, capture ban-void count BEFORE revoking (the
  //    trigger wipes them on revoke), then revoke.
  const details: AppealEffectDetail[] = [];
  let totalUnvoided = 0;
  for (const a of liveActions) {
    let voidedBefore = 0;
    if (a.sanction_type === "ban") {
      const { count } = await sb
        .from("match_results")
        .select("id", { count: "exact", head: true })
        .eq("voided_by_action_id", a.id)
        .eq("result_type", "void");
      voidedBefore = count ?? 0;
    }

    await revokeAction(sb, a.id, reason);

    details.push({
      actionId: a.id,
      sanctionType: a.sanction_type,
      wasBan: a.sanction_type === "ban",
      voidedMatchesBefore: voidedBefore,
    });
    totalUnvoided += voidedBefore;
  }

  return {
    appealId: args.appealId,
    revokedActions: details,
    totalMatchesUnvoided: totalUnvoided,
  };
}

/**
 * Called from `undoRuling()` when admin reverses an upheld appeal. Clears
 * `revoked_at` + `revoke_reason` on every action whose reason starts with
 * `[appeal:<id>]`. The DB trigger on `disciplinary_actions` detects the
 * NULL flip on a ban action and re-propagates voids via
 * `propagate_suspension_voids`.
 */
export async function onAppealUndo(
  sb: SupabaseClient,
  appealId: string,
): Promise<string[]> {
  const tagPrefix = `[appeal:${appealId}]`;

  const { data: rows, error } = await sb
    .from("disciplinary_actions")
    .select("id, revoke_reason, deleted_at")
    .ilike("revoke_reason", `${tagPrefix}%`)
    .is("deleted_at", null)
    .not("revoked_at", "is", null);
  if (error) throw new Error(`onAppealUndo lookup: ${error.message}`);

  const ids: string[] = [];
  for (const r of (rows ?? []) as { id: string }[]) {
    const { error: upErr } = await sb
      .from("disciplinary_actions")
      .update({ revoked_at: null, revoke_reason: null })
      .eq("id", r.id);
    if (upErr) throw new Error(`onAppealUndo unrevoke: ${upErr.message}`);
    ids.push(r.id);
  }
  // Helper kept exported for symmetry — same contract as onAppealUpheld.
  void unrevokeAction;
  return ids;
}

/**
 * Read-only accessor for the admin detail page: lists every action
 * currently revoked by this appeal + voided matches tied to any ban
 * among those. Used by `/admin/appeals/[id]` and the "undo" button.
 */
export async function listEffectsForAppeal(
  sb: SupabaseClient,
  appealId: string,
): Promise<{
  actions: Array<{
    id: string;
    sanction_type: string;
    revoked_at: string | null;
    revoke_reason: string | null;
    effective_from: string | null;
    effective_until: string | null;
  }>;
  voidedMatches: Array<{
    id: string;
    match_id: string;
    voided_by_action_id: string;
  }>;
}> {
  const tagPrefix = `[appeal:${appealId}]`;

  const { data: actions, error: aErr } = await sb
    .from("disciplinary_actions")
    .select(
      "id, sanction_type, revoked_at, revoke_reason, effective_from, effective_until",
    )
    .ilike("revoke_reason", `${tagPrefix}%`)
    .is("deleted_at", null);
  if (aErr) throw new Error(`listEffectsForAppeal actions: ${aErr.message}`);

  const actionIds = (actions ?? []).map((a: { id: string }) => a.id);
  if (actionIds.length === 0) {
    return { actions: [], voidedMatches: [] };
  }

  // Once revoked, the ban trigger already un-voided rows, so this list is
  // typically empty. We include it so the UI can still render "N matches
  // were voided and have now been restored" in the future if we keep the
  // void rows instead of deleting them. Today it returns [] which the UI
  // is OK with.
  const { data: voids, error: vErr } = await sb
    .from("match_results")
    .select("id, match_id, voided_by_action_id")
    .in("voided_by_action_id", actionIds)
    .eq("result_type", "void");
  if (vErr) throw new Error(`listEffectsForAppeal voids: ${vErr.message}`);

  return {
    actions: (actions ?? []) as Array<{
      id: string;
      sanction_type: string;
      revoked_at: string | null;
      revoke_reason: string | null;
      effective_from: string | null;
      effective_until: string | null;
    }>,
    voidedMatches: (voids ?? []) as Array<{
      id: string;
      match_id: string;
      voided_by_action_id: string;
    }>,
  };
}
