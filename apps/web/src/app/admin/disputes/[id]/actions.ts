"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gate } from "@/lib/server-actor";
import { assign, rule } from "@/server/disputes";

export const assignDisputeFormSchema = z.object({
  disputeId: z.string().uuid(),
  assignedToUserId: z.string().uuid("must assign to a user"),
});
export const ruleDisputeFormSchema = z.object({
  disputeId: z.string().uuid(),
  ruling: z.string().trim().min(1, "ruling required").max(4000),
});
export type AssignDisputeForm = z.infer<typeof assignDisputeFormSchema>;
export type RuleDisputeForm = z.infer<typeof ruleDisputeFormSchema>;

export function parseAssignDisputeForm(fd: FormData): AssignDisputeForm {
  return assignDisputeFormSchema.parse({
    disputeId: fd.get("disputeId"),
    assignedToUserId: fd.get("assignedToUserId"),
  });
}
export function parseRuleDisputeForm(fd: FormData): RuleDisputeForm {
  return ruleDisputeFormSchema.parse({
    disputeId: fd.get("disputeId"),
    ruling: fd.get("ruling"),
  });
}

export async function assignDisputeAction(formData: FormData): Promise<void> {
  const { sb } = await gate("disputes.rule");
  const input = parseAssignDisputeForm(formData);
  await assign(sb, input);
  revalidatePath(`/admin/disputes/${input.disputeId}`);
  revalidatePath("/admin/disputes");
}

export async function ruleDisputeAction(formData: FormData): Promise<void> {
  const { sb } = await gate("disputes.rule");
  const input = parseRuleDisputeForm(formData);
  await rule(sb, input);
  revalidatePath(`/admin/disputes/${input.disputeId}`);
  revalidatePath("/admin/disputes");
}
