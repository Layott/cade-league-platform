"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { assignPanel, rule } from "@/server/appeals";
import { parseAssignPanelForm, parseRuleAppealForm } from "./schemas";

/**
 * Plan 13B — /admin/appeals/[id] actions. Panel editor is gated by
 * `appeals.rule` as are rulings. Panel size required: exactly 3 members
 * per spec §5.3 for Phase 1; the server module still accepts 1..5 for
 * forward-compat.
 */

export async function assignPanelAction(formData: FormData): Promise<void> {
  const { sb } = await gate("appeals.rule");
  const input = parseAssignPanelForm(formData);
  await assignPanel(sb, {
    appealId: input.appealId,
    panelMemberUserIds: [input.member1, input.member2, input.member3],
  });
  revalidatePath(`/admin/appeals/${input.appealId}`);
  revalidatePath("/admin/appeals");
}

export async function ruleAppealAction(formData: FormData): Promise<void> {
  const { sb } = await gate("appeals.rule");
  const input = parseRuleAppealForm(formData);
  await rule(sb, input);
  revalidatePath(`/admin/appeals/${input.appealId}`);
  revalidatePath("/admin/appeals");
}
