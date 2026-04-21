"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gate } from "@/lib/server-actor";
import { recordEntry } from "@/server/orgs";

/**
 * Plan 13B — /admin/orgs/[id]/ledger/new action. Gate: orgs.ledger.write
 * (admin-only; moderator deliberately NOT granted per spec §7).
 */

export const recordLedgerEntryFormSchema = z
  .object({
    orgId: z.string().uuid(),
    entryType: z.enum(["deposit", "fine_deduction", "topup", "adjustment"]),
    direction: z
      .enum(["credit", "debit"])
      .optional()
      .transform((v) => v || undefined),
    amountCoins: z.coerce
      .number()
      .int("amount must be a whole number")
      .positive("amount must be > 0"),
    reference: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
  })
  .superRefine((data, ctx) => {
    if (data.entryType === "adjustment" && !data.direction) {
      ctx.addIssue({
        code: "custom",
        message:
          "adjustment entries must specify direction (credit|debit)",
        path: ["direction"],
      });
    }
  });
export type RecordLedgerEntryForm = z.infer<typeof recordLedgerEntryFormSchema>;

export function parseRecordLedgerEntryForm(
  fd: FormData,
): RecordLedgerEntryForm {
  return recordLedgerEntryFormSchema.parse({
    orgId: fd.get("orgId"),
    entryType: fd.get("entryType"),
    direction: (fd.get("direction") as string) || undefined,
    amountCoins: fd.get("amountCoins"),
    reference: fd.get("reference"),
  });
}

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
  revalidatePath(`/admin/orgs/${input.orgId}`);
  redirect(`/admin/orgs/${input.orgId}#ledger`);
}
