"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { assign, rule } from "@/server/disputes";
import { publishDisputeRuled } from "@/server/disputes/realtime";
import { notify } from "@/server/notifications";
import { parseAssignDisputeForm, parseRuleDisputeForm } from "./schemas";

/**
 * Live-refresh (2026-04-24) — after an admin mutation, wake the
 * player's scoped dispute channel so `/player/disputes` updates
 * without reload. Reads `raised_by_user_id` from the dispute row so
 * the broadcast lands on the correct per-player topic.
 */
async function pingDisputeOwner(
  sb: Awaited<ReturnType<typeof gate>>["sb"],
  disputeId: string,
  status: "submitted" | "under_review" | "resolved" | "withdrawn",
): Promise<void> {
  try {
    const { data } = await sb
      .from("disputes")
      .select("raised_by_user_id")
      .eq("id", disputeId)
      .maybeSingle();
    const row = data as { raised_by_user_id: string } | null;
    if (!row) return;
    await publishDisputeRuled(sb, {
      disputeId,
      raisedByUserId: row.raised_by_user_id,
      status,
    });
  } catch {
    // best-effort
  }
}

export async function assignDisputeAction(formData: FormData): Promise<void> {
  const { sb } = await gate("disputes.rule");
  const input = parseAssignDisputeForm(formData);
  await assign(sb, input);
  await pingDisputeOwner(sb, input.disputeId, "under_review");
  revalidatePath(`/admin/disputes/${input.disputeId}`);
  revalidatePath("/admin/disputes");
  revalidatePath("/player/disputes");
  revalidatePath("/admin");
}

export async function ruleDisputeAction(formData: FormData): Promise<void> {
  const { sb } = await gate("disputes.rule");
  const input = parseRuleDisputeForm(formData);
  await rule(sb, input);
  await pingDisputeOwner(sb, input.disputeId, "resolved");

  // Notify the raiser AFTER the rule persists. Errors swallowed inside
  // notify()/try so a Resend hiccup can't abort the admin's write.
  try {
    const { data } = await sb
      .from("disputes")
      .select("raised_by_user_id, title")
      .eq("id", input.disputeId)
      .maybeSingle();
    const row = data as
      | { raised_by_user_id: string; title: string | null }
      | null;
    if (row?.raised_by_user_id) {
      const label = row.title ? `"${row.title}"` : "your dispute";
      await notify(sb, {
        userId: row.raised_by_user_id,
        kind: "dispute_ruled",
        title: "Your dispute was ruled",
        body: `A ruling has been posted on ${label}. Open it to read the panel's decision.`,
        href: `/player/disputes/${input.disputeId}`,
        metadata: { disputeId: input.disputeId },
      });
    }
  } catch (err) {
    console.error(`[notifications] dispute_ruled fan-out failed: ${String(err)}`);
  }

  revalidatePath(`/admin/disputes/${input.disputeId}`);
  revalidatePath("/admin/disputes");
  revalidatePath("/player/disputes");
  revalidatePath("/admin");
}
