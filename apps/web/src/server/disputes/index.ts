import type { SupabaseClient } from "@supabase/supabase-js";
import {
  submitDisputeSchema,
  assignDisputeSchema,
  ruleDisputeSchema,
  withdrawDisputeSchema,
  type SubmitDisputeInput,
  type AssignDisputeInput,
  type RuleDisputeInput,
  type WithdrawDisputeInput,
} from "./schemas";

export class DisputeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisputeError";
  }
}

export type DisputeRow = {
  id: string;
  raised_by_user_id: string;
  subject_type: "match" | "sanction" | "registration" | "other";
  subject_id: string | null;
  description: string;
  evidence_urls: string[];
  status: "submitted" | "under_review" | "resolved" | "withdrawn";
  assigned_to_user_id: string | null;
  ruling: string | null;
  opened_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export async function submit(
  sb: SupabaseClient,
  raw: SubmitDisputeInput,
): Promise<DisputeRow> {
  const input = submitDisputeSchema.parse(raw);
  const { data, error } = await sb
    .from("disputes")
    .insert({
      raised_by_user_id: input.raisedByUserId,
      subject_type: input.subjectType,
      subject_id: input.subjectId ?? null,
      description: input.description,
      evidence_urls: input.evidenceUrls,
    })
    .select("*")
    .single();
  if (error || !data) throw new DisputeError(`submit: ${error?.message ?? "unknown"}`);
  return data as DisputeRow;
}

export async function assign(
  sb: SupabaseClient,
  raw: AssignDisputeInput,
): Promise<DisputeRow> {
  const input = assignDisputeSchema.parse(raw);
  const { data, error } = await sb
    .from("disputes")
    .update({
      assigned_to_user_id: input.assignedToUserId,
      status: "under_review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.disputeId)
    .select("*")
    .single();
  if (error || !data) throw new DisputeError(`assign: ${error?.message ?? "unknown"}`);
  return data as DisputeRow;
}

export async function rule(
  sb: SupabaseClient,
  raw: RuleDisputeInput,
): Promise<DisputeRow> {
  const input = ruleDisputeSchema.parse(raw);
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("disputes")
    .update({
      status: "resolved",
      ruling: input.ruling,
      resolved_at: now,
      updated_at: now,
    })
    .eq("id", input.disputeId)
    .select("*")
    .single();
  if (error || !data) throw new DisputeError(`rule: ${error?.message ?? "unknown"}`);
  return data as DisputeRow;
}

/**
 * Only the original raiser may withdraw. Server enforces by reading the row
 * and comparing `raised_by_user_id`. Moderators should rule, not withdraw.
 */
export async function withdraw(
  sb: SupabaseClient,
  raw: WithdrawDisputeInput,
): Promise<DisputeRow> {
  const input = withdrawDisputeSchema.parse(raw);

  const { data: row, error: readErr } = await sb
    .from("disputes")
    .select("id, raised_by_user_id, status")
    .eq("id", input.disputeId)
    .maybeSingle();
  if (readErr) throw new DisputeError(`withdraw read: ${readErr.message}`);
  if (!row) throw new DisputeError(`dispute not found: ${input.disputeId}`);

  const r = row as { id: string; raised_by_user_id: string; status: string };
  if (r.raised_by_user_id !== input.requestedByUserId) {
    throw new DisputeError("only the raiser may withdraw a dispute");
  }
  if (r.status === "resolved") {
    throw new DisputeError("cannot withdraw a resolved dispute");
  }

  const { data, error } = await sb
    .from("disputes")
    .update({
      status: "withdrawn",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.disputeId)
    .select("*")
    .single();
  if (error || !data) throw new DisputeError(`withdraw: ${error?.message ?? "unknown"}`);
  return data as DisputeRow;
}

export async function list(
  sb: SupabaseClient,
  opts: { status?: DisputeRow["status"]; limit?: number } = {},
): Promise<DisputeRow[]> {
  let q = sb.from("disputes").select("*").is("deleted_at", null);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q
    .order("opened_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) throw new DisputeError(`list: ${error.message}`);
  return (data ?? []) as DisputeRow[];
}

export async function getById(
  sb: SupabaseClient,
  disputeId: string,
): Promise<DisputeRow | null> {
  const { data, error } = await sb
    .from("disputes")
    .select("*")
    .eq("id", disputeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new DisputeError(`getById: ${error.message}`);
  return (data as DisputeRow | null) ?? null;
}

export async function listForUser(
  sb: SupabaseClient,
  userId: string,
): Promise<DisputeRow[]> {
  const { data, error } = await sb
    .from("disputes")
    .select("*")
    .eq("raised_by_user_id", userId)
    .is("deleted_at", null)
    .order("opened_at", { ascending: false });
  if (error) throw new DisputeError(`listForUser: ${error.message}`);
  return (data ?? []) as DisputeRow[];
}
