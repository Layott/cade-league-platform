"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { assignPanel, rule, undoRuling } from "@/server/appeals";
import { publishAppealRuled } from "@/server/appeals/realtime";
import { notify } from "@/server/notifications";
import {
  parseAssignPanelForm,
  parseRuleAppealForm,
  parseUndoRulingForm,
} from "./schemas";

/**
 * Plan 13B — /admin/appeals/[id] actions. Panel editor is gated by
 * `appeals.rule` as are rulings. Panel size required: exactly 3 members
 * per spec §5.3 for Phase 1; the server module still accepts 1..5 for
 * forward-compat.
 */

/**
 * Live-refresh (2026-04-24) — after an admin mutation, wake the
 * player's scoped appeal channel so `/player/appeals` updates without
 * reload. Reads `submitted_by_user_id` from the appeal row so the
 * broadcast lands on the correct per-player topic. Fire-and-forget.
 */
async function pingAppealOwner(
  sb: Awaited<ReturnType<typeof gate>>["sb"],
  appealId: string,
  status: "submitted" | "under_review" | "ruled" | "withdrawn" | "expired",
): Promise<void> {
  try {
    const { data } = await sb
      .from("appeals")
      .select("submitted_by_user_id")
      .eq("id", appealId)
      .maybeSingle();
    const row = data as { submitted_by_user_id: string } | null;
    if (!row) return;
    await publishAppealRuled(sb, {
      appealId,
      submittedByUserId: row.submitted_by_user_id,
      status,
    });
  } catch {
    // best-effort
  }
}

export async function assignPanelAction(formData: FormData): Promise<void> {
  const { sb } = await gate("appeals.rule");
  const input = parseAssignPanelForm(formData);
  await assignPanel(sb, {
    appealId: input.appealId,
    panelMemberUserIds: [input.member1, input.member2, input.member3],
  });
  await pingAppealOwner(sb, input.appealId, "under_review");
  revalidatePath(`/admin/discipline/appeals/${input.appealId}`);
  revalidatePath("/admin/discipline/appeals");
  revalidatePath("/player/appeals");
}

export async function ruleAppealAction(formData: FormData): Promise<void> {
  const { sb, userId } = await gate("appeals.rule");
  const input = parseRuleAppealForm(formData);
  const result = await rule(
    sb,
    {
      appealId: input.appealId,
      ruling: input.ruling,
      outcome: input.outcome,
    },
    userId,
  );
  await pingAppealOwner(sb, input.appealId, "ruled");

  // Player-facing notification AFTER the rule persists. For 'upheld'
  // rulings we include the cascade summary (N actions revoked, M matches
  // unvoided) so the email body is as informative as the bell detail.
  try {
    const { data } = await sb
      .from("appeals")
      .select("submitted_by_user_id")
      .eq("id", input.appealId)
      .maybeSingle();
    const row = data as { submitted_by_user_id: string } | null;
    if (row?.submitted_by_user_id) {
      const outcomeWord =
        input.outcome === "upheld" ? "upheld" : "dismissed";
      const revokedCount = result.effects?.revokedActions.length ?? 0;
      const voidedCount = result.effects?.totalMatchesUnvoided ?? 0;
      const sideEffectLine =
        input.outcome === "upheld" && revokedCount > 0
          ? ` Linked sanctions auto-revoked (${revokedCount})${voidedCount > 0 ? `, and ${voidedCount} previously-voided match${voidedCount === 1 ? "" : "es"} restored` : ""}.`
          : "";
      await notify(sb, {
        userId: row.submitted_by_user_id,
        kind: "appeal_ruled",
        title: `Your appeal was ${outcomeWord}`,
        body: `The panel has ${outcomeWord} your appeal.${sideEffectLine} Open it for the full panel ruling.`,
        href: `/player/appeals/${input.appealId}`,
        metadata: {
          appealId: input.appealId,
          outcome: input.outcome,
          revokedActions: revokedCount,
          unvoidedMatches: voidedCount,
        },
      });
    }
  } catch (err) {
    console.error(`[notifications] appeal_ruled fan-out failed: ${String(err)}`);
  }

  revalidatePath(`/admin/discipline/appeals/${input.appealId}`);
  revalidatePath("/admin/discipline/appeals");
  revalidatePath("/player/appeals");
  if (result.effects && result.effects.revokedActions.length > 0) {
    revalidatePath("/admin/discipline/punishments");
    revalidatePath("/punishments");
    revalidatePath("/profile");
    revalidatePath("/standings");
    revalidatePath("/fixtures");
    for (const a of result.effects.revokedActions) {
      revalidatePath(`/admin/discipline/punishments/${a.actionId}`);
    }
  }
}

/**
 * Plan 50: admin reverses a previously upheld appeal ruling. Clears
 * `outcome`, bumps status back to under_review, clears ruling + ruled_at,
 * and un-revokes every disciplinary_action tagged `[appeal:<id>]`. The
 * DB trigger on `disciplinary_actions` re-propagates ban voids.
 */
export async function undoAppealRulingAction(
  formData: FormData,
): Promise<void> {
  const { sb } = await gate("appeals.rule");
  const input = parseUndoRulingForm(formData);
  const { unrevokedActionIds } = await undoRuling(sb, input);
  await pingAppealOwner(sb, input.appealId, "under_review");
  revalidatePath(`/admin/discipline/appeals/${input.appealId}`);
  revalidatePath("/admin/discipline/appeals");
  revalidatePath("/player/appeals");
  if (unrevokedActionIds.length > 0) {
    revalidatePath("/admin/discipline/punishments");
    revalidatePath("/punishments");
    revalidatePath("/profile");
    revalidatePath("/standings");
    revalidatePath("/fixtures");
    for (const actionId of unrevokedActionIds) {
      revalidatePath(`/admin/discipline/punishments/${actionId}`);
    }
  }
}
