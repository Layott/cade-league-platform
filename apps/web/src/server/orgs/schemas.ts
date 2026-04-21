import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  cacNumber: z.string().trim().min(1).max(64).optional().nullable(),
  cacCertUrl: z.string().trim().url().optional().nullable(),
  contactRepUserId: z.string().uuid().optional().nullable(),
  status: z.enum(["active", "suspended", "dissolved"]).default("active"),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const updateOrgSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  cacNumber: z.string().trim().min(1).max(64).optional().nullable(),
  cacCertUrl: z.string().trim().url().optional().nullable(),
  contactRepUserId: z.string().uuid().optional().nullable(),
  status: z.enum(["active", "suspended", "dissolved"]).optional(),
});
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

export const ledgerEntrySchema = z.object({
  orgId: z.string().uuid(),
  entryType: z.enum(["deposit", "fine_deduction", "topup", "adjustment"]),
  amountCoins: z.coerce.number().int().positive(),
  // direction is derived for deposit/topup/fine_deduction; required explicit
  // for adjustment (admin picks credit or debit to correct balance).
  direction: z.enum(["credit", "debit"]).optional(),
  reference: z.string().trim().max(500).optional().nullable(),
});
export type LedgerEntryInput = z.infer<typeof ledgerEntrySchema>;

export const linkPlayerSchema = z.object({
  orgId: z.string().uuid(),
  playerId: z.string().uuid(),
});
export type LinkPlayerInput = z.infer<typeof linkPlayerSchema>;

export const createContractSchema = z.object({
  organizationId: z.string().uuid(),
  playerId: z.string().uuid(),
  seasonId: z.string().uuid(),
  contractUrl: z.string().trim().url(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z
    .enum(["draft", "active", "terminated", "expired"])
    .default("draft"),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;
