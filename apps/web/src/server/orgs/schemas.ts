import { z } from "zod";

/**
 * Plan 31 — orgs simplified.
 * CAC fields removed entirely (no `cacNumber`, no `cacCertUrl`); the most
 * important info is logo + players + coach + team manager. Schemas
 * actively REJECT payloads that include CAC keys — see test for the
 * `.strict()` enforcement.
 */
export const createOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    logoUrl: z.string().trim().min(1).max(500).optional().nullable(),
    contactRepUserId: z.string().uuid().optional().nullable(),
    status: z.enum(["active", "suspended", "dissolved"]).default("active"),
  })
  .strict();
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const updateOrgSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(200).optional(),
    logoUrl: z.string().trim().min(1).max(500).optional().nullable(),
    contactRepUserId: z.string().uuid().optional().nullable(),
    status: z.enum(["active", "suspended", "dissolved"]).optional(),
  })
  .strict();
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

/**
 * Plan 31 — link a coach (a user) to a player belonging to an org.
 * Sets `players.coach_id`. Caller (action) must verify the player is in
 * the org so we don't accidentally bind staff to outside players.
 */
export const linkCoachSchema = z.object({
  orgId: z.string().uuid(),
  playerId: z.string().uuid(),
  coachUserId: z.string().uuid().nullable(),
});
export type LinkCoachInput = z.infer<typeof linkCoachSchema>;

/**
 * Plan 31 — link a team manager (a user) to a player belonging to an
 * org. Sets `players.team_manager_id`.
 */
export const linkTeamManagerSchema = z.object({
  orgId: z.string().uuid(),
  playerId: z.string().uuid(),
  teamManagerUserId: z.string().uuid().nullable(),
});
export type LinkTeamManagerInput = z.infer<typeof linkTeamManagerSchema>;

export const createContractSchema = z.object({
  organizationId: z.string().uuid(),
  playerId: z.string().uuid(),
  seasonId: z.string().uuid(),
  // Storage path (not public URL) — signed reads minted server-side.
  contractUrl: z.string().trim().min(1).max(500),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z
    .enum(["draft", "active", "terminated", "expired"])
    .default("draft"),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;
