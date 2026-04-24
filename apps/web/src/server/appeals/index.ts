import type { SupabaseClient } from "@supabase/supabase-js";
import {
  submitAppealSchema,
  assignPanelSchema,
  ruleAppealSchema,
  withdrawAppealSchema,
  undoAppealRulingSchema,
  type SubmitAppealInput,
  type AssignPanelInput,
  type RuleAppealInput,
  type WithdrawAppealInput,
  type UndoAppealRulingInput,
} from "./schemas";
import { computeAppealDeadline } from "./deadline";
import { onAppealUpheld, onAppealUndo, type AppealEffectSummary } from "./effects";

export class AppealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppealError";
  }
}

export type AppealRow = {
  id: string;
  disciplinary_case_id: string;
  submitted_by_user_id: string;
  submitted_at: string;
  grounds: string;
  evidence_urls: string[];
  panel_member_user_ids: string[];
  ruling: string | null;
  ruled_at: string | null;
  deadline_at: string;
  status: "submitted" | "under_review" | "ruled" | "withdrawn" | "expired";
  /**
   * Plan 50: explicit panel decision. Populated when `status = 'ruled'`.
   * `upheld` triggers auto-revoke of the linked disciplinary_actions +
   * unwinds ban-propagated voids; `dismissed` leaves the sanction in force.
   * Legacy pre-Plan-50 rulings carry `null` — the admin must re-rule them.
   */
  outcome: "upheld" | "dismissed" | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export async function submit(
  sb: SupabaseClient,
  raw: SubmitAppealInput,
): Promise<AppealRow> {
  const input = submitAppealSchema.parse(raw);

  // Refuse if an open appeal already exists for the case (backstop for the
  // partial unique index).
  const { data: existing, error: exErr } = await sb
    .from("appeals")
    .select("id")
    .eq("disciplinary_case_id", input.disciplinaryCaseId)
    .in("status", ["submitted", "under_review"])
    .is("deleted_at", null)
    .maybeSingle();
  if (exErr) throw new AppealError(`submit check: ${exErr.message}`);
  if (existing) {
    throw new AppealError(
      "an open appeal already exists for this disciplinary case",
    );
  }

  const submittedAt = new Date();
  const deadlineAt = computeAppealDeadline(submittedAt);

  const { data, error } = await sb
    .from("appeals")
    .insert({
      disciplinary_case_id: input.disciplinaryCaseId,
      submitted_by_user_id: input.submittedByUserId,
      submitted_at: submittedAt.toISOString(),
      grounds: input.grounds,
      evidence_urls: input.evidenceUrls,
      deadline_at: deadlineAt.toISOString(),
      status: "submitted",
    })
    .select("*")
    .single();
  if (error || !data) throw new AppealError(`submit: ${error?.message ?? "unknown"}`);
  return data as AppealRow;
}

export async function assignPanel(
  sb: SupabaseClient,
  raw: AssignPanelInput,
): Promise<AppealRow> {
  const input = assignPanelSchema.parse(raw);

  const { data, error } = await sb
    .from("appeals")
    .update({
      panel_member_user_ids: input.panelMemberUserIds,
      status: "under_review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.appealId)
    .select("*")
    .single();
  if (error || !data) throw new AppealError(`assignPanel: ${error?.message ?? "unknown"}`);
  return data as AppealRow;
}

export type RuleAppealResult = {
  appeal: AppealRow;
  /**
   * Side-effect summary when the outcome is 'upheld'. `null` for
   * 'dismissed' rulings (no side effects). The admin UI uses this to
   * render "N actions auto-revoked · M matches auto-voided" after ruling.
   */
  effects: AppealEffectSummary | null;
};

export async function rule(
  sb: SupabaseClient,
  raw: RuleAppealInput,
  actorUserId?: string,
): Promise<RuleAppealResult> {
  const input = ruleAppealSchema.parse(raw);

  const { data: cur, error: readErr } = await sb
    .from("appeals")
    .select("id, status, deadline_at, disciplinary_case_id")
    .eq("id", input.appealId)
    .maybeSingle();
  if (readErr) throw new AppealError(`rule read: ${readErr.message}`);
  if (!cur) throw new AppealError(`appeal not found: ${input.appealId}`);

  const c = cur as {
    id: string;
    status: string;
    deadline_at: string;
    disciplinary_case_id: string;
  };
  if (c.status === "ruled") {
    throw new AppealError("appeal already ruled");
  }
  if (c.status === "withdrawn" || c.status === "expired") {
    throw new AppealError(`cannot rule on a ${c.status} appeal`);
  }

  const now = new Date();
  const deadline = new Date(c.deadline_at);
  const isLate = now > deadline;
  const ruling = isLate ? `[LATE RULING] ${input.ruling}` : input.ruling;

  const { data, error } = await sb
    .from("appeals")
    .update({
      ruling,
      outcome: input.outcome,
      ruled_at: now.toISOString(),
      status: "ruled",
      updated_at: now.toISOString(),
    })
    .eq("id", input.appealId)
    .select("*")
    .single();
  if (error || !data) throw new AppealError(`rule: ${error?.message ?? "unknown"}`);
  const appeal = data as AppealRow;

  let effects: AppealEffectSummary | null = null;
  if (input.outcome === "upheld") {
    // Side effects: revoke every live action on the linked case, which in
    // turn fires the DB trigger that unwinds any ban-propagated voids.
    effects = await onAppealUpheld(sb, {
      appealId: appeal.id,
      disciplinaryCaseId: c.disciplinary_case_id,
      actorUserId: actorUserId ?? null,
    });
  }

  return { appeal, effects };
}

/**
 * Plan 50: admin reverses an upheld ruling. Flips `outcome` back to NULL,
 * bumps status back to 'under_review', clears ruling + ruled_at, and
 * un-revokes every disciplinary_action that was auto-revoked by this
 * appeal (DB trigger on disciplinary_actions.revoked_at flipping back to
 * NULL re-propagates any ban voids).
 */
export async function undoRuling(
  sb: SupabaseClient,
  raw: UndoAppealRulingInput,
): Promise<{ appeal: AppealRow; unrevokedActionIds: string[] }> {
  const input = undoAppealRulingSchema.parse(raw);

  const { data: cur, error: readErr } = await sb
    .from("appeals")
    .select("id, status, outcome")
    .eq("id", input.appealId)
    .maybeSingle();
  if (readErr) throw new AppealError(`undoRuling read: ${readErr.message}`);
  if (!cur) throw new AppealError(`appeal not found: ${input.appealId}`);
  const c = cur as { id: string; status: string; outcome: string | null };
  if (c.status !== "ruled") {
    throw new AppealError("can only undo a ruled appeal");
  }
  if (c.outcome !== "upheld") {
    throw new AppealError(
      "undo applies to upheld rulings only (dismissed rulings have no side effects to reverse)",
    );
  }

  const unrevokedActionIds = await onAppealUndo(sb, input.appealId);

  const now = new Date();
  const { data, error } = await sb
    .from("appeals")
    .update({
      status: "under_review",
      outcome: null,
      ruling: null,
      ruled_at: null,
      updated_at: now.toISOString(),
    })
    .eq("id", input.appealId)
    .select("*")
    .single();
  if (error || !data) throw new AppealError(`undoRuling: ${error?.message ?? "unknown"}`);

  return { appeal: data as AppealRow, unrevokedActionIds };
}

export async function withdraw(
  sb: SupabaseClient,
  raw: WithdrawAppealInput,
): Promise<AppealRow> {
  const input = withdrawAppealSchema.parse(raw);

  const { data: row, error: readErr } = await sb
    .from("appeals")
    .select("id, submitted_by_user_id, status")
    .eq("id", input.appealId)
    .maybeSingle();
  if (readErr) throw new AppealError(`withdraw read: ${readErr.message}`);
  if (!row) throw new AppealError(`appeal not found: ${input.appealId}`);

  const r = row as { id: string; submitted_by_user_id: string; status: string };
  if (r.submitted_by_user_id !== input.requestedByUserId) {
    throw new AppealError("only the submitter may withdraw an appeal");
  }
  if (r.status === "ruled") {
    throw new AppealError("cannot withdraw a ruled appeal");
  }

  const { data, error } = await sb
    .from("appeals")
    .update({ status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("id", input.appealId)
    .select("*")
    .single();
  if (error || !data) throw new AppealError(`withdraw: ${error?.message ?? "unknown"}`);
  return data as AppealRow;
}

export async function list(
  sb: SupabaseClient,
  opts: { status?: AppealRow["status"]; limit?: number } = {},
): Promise<AppealRow[]> {
  let q = sb.from("appeals").select("*").is("deleted_at", null);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q
    .order("submitted_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) throw new AppealError(`list: ${error.message}`);
  return (data ?? []) as AppealRow[];
}

export async function getById(
  sb: SupabaseClient,
  appealId: string,
): Promise<AppealRow | null> {
  const { data, error } = await sb
    .from("appeals")
    .select("*")
    .eq("id", appealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new AppealError(`getById: ${error.message}`);
  return (data as AppealRow | null) ?? null;
}

export async function listForUser(
  sb: SupabaseClient,
  userId: string,
): Promise<AppealRow[]> {
  const { data, error } = await sb
    .from("appeals")
    .select("*")
    .eq("submitted_by_user_id", userId)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false });
  if (error) throw new AppealError(`listForUser: ${error.message}`);
  return (data ?? []) as AppealRow[];
}

export { computeAppealDeadline } from "./deadline";
export { markExpired } from "./expire";
export {
  onAppealUpheld,
  onAppealUndo,
  listEffectsForAppeal,
  parseAppealIdFromReason,
  appealRevokeReason,
  type AppealEffectSummary,
  type AppealEffectDetail,
} from "./effects";
