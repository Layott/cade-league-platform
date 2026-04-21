"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { assign, rule } from "@/server/disputes";
import { parseAssignDisputeForm, parseRuleDisputeForm } from "./schemas";

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
