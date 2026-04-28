"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { recordEntry } from "@/server/orgs";
import { parseRecordLedgerEntryForm } from "./schemas";

/**
 * Plan 13B — /admin/orgs/[id]/ledger/new action. Gate: orgs.ledger.write
 * (admin-only; moderator deliberately NOT granted per spec §7).
 */

export async function recordLedgerEntryAction(
  formData: FormData,
): Promise<void> {
  const { sb, userId } = await gate("orgs.ledger.write");
  const input = parseRecordLedgerEntryForm(formData);
  await recordEntry(sb, userId, {
    orgId: input.orgId,
    entryType: input.entryType,
    direction: input.direction,
    amountCoins: input.amountCoins,
    reference: input.reference,
  });
  revalidatePath(`/admin/people/orgs/${input.orgId}`);
  redirect(`/admin/people/orgs/${input.orgId}#ledger`);
}
