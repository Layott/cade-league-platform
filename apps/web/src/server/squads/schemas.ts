import { z } from "zod";

/**
 * Plan 10 — Zod input schemas for the squads server layer.
 *
 * Keep these co-located with the server module (`submit`, `review`, `change`,
 * `rules`) rather than sharing via `src/lib/` — no UI consumer should import
 * these. UI-side mirror validation lives in the client components directly.
 */

export const itemTypeEnum = z.enum([
  "gold",
  "silver",
  "bronze",
  "hero",
  "icon",
  "legend",
  "special",
  "other",
]);

export type ItemType = z.infer<typeof itemTypeEnum>;

export const itemSchema = z.object({
  name: z.string().min(1).max(120),
  rating: z.number().int().min(1).max(99),
  position: z.string().min(1).max(8),
  value: z.number().int().min(0),
  itemType: itemTypeEnum,
  // Accepts either an ISO-2/ISO-3 code ("NG"/"NGA") or the full country
  // name ("Nigeria", "United States", "Bosnia and Herzegovina"). Futbin's
  // list page emits nation via CDN icon only (no ISO), so submit_picker
  // falls back to the full `nation` string when `nation_iso` is null.
  // Max 64 covers the longest real country name.
  nationalityFlag: z.string().min(2).max(64).nullable().optional(),
  /**
   * Futbin-internal nation registry ID. Captured by the list-page
   * scrapers (img.nation → /img/nation/{id}.png). Used by the Nigerian-
   * count rule to handle Futbin rows with empty `nation_iso`.
   *
   * Kept out of persistence (see `submit.ts` row shape) — only threaded
   * into `evaluateRules` at submit-time.
   */
  futbinNationId: z.number().int().positive().nullable().optional(),
  slotIndex: z.number().int().min(0).max(22),
});

export type SquadItemInput = z.infer<typeof itemSchema>;

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "weekStartDate must be YYYY-MM-DD");

export const uploadScreenshotSchema = z.object({
  seasonId: z.string().uuid(),
  playerId: z.string().uuid(),
  weekStartDate: ymd,
});

export const createSubmissionSchema = z.object({
  seasonId: z.string().uuid(),
  playerId: z.string().uuid(),
  weekStartDate: ymd,
  futbinScreenshotPath: z.string().min(1),
  items: z.array(itemSchema).min(1).max(23),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export const reviewSchema = z
  .object({
    submissionId: z.string().uuid(),
    action: z.enum(["approve", "reject"]),
    rejectionReason: z.string().min(1).optional(),
  })
  .refine(
    (v) => v.action === "approve" || (v.rejectionReason && v.rejectionReason.length > 0),
    { message: "rejectionReason required when action is reject" },
  );

export type ReviewInput = z.infer<typeof reviewSchema>;

export const changeSchema = z.object({
  submissionId: z.string().uuid(),
  playerOutItemId: z.string().uuid().nullable().optional(),
  playerOutName: z.string().min(1),
  playerIn: z.object({
    name: z.string().min(1).max(120),
    itemType: itemTypeEnum,
    rating: z.number().int().min(1).max(99),
    value: z.number().int().min(0),
    // Accepts either an ISO-2/ISO-3 code ("NG"/"NGA") or the full country
  // name ("Nigeria", "United States", "Bosnia and Herzegovina"). Futbin's
  // list page emits nation via CDN icon only (no ISO), so submit_picker
  // falls back to the full `nation` string when `nation_iso` is null.
  // Max 64 covers the longest real country name.
  nationalityFlag: z.string().min(2).max(64).nullable().optional(),
  }),
  authorizedByRefUserId: z.string().uuid(),
});

export type ChangeInput = z.infer<typeof changeSchema>;

export const ruleUpsertSchema = z.object({
  seasonId: z.string().uuid(),
  maxBudgetCoins: z.number().int().min(0),
  minNigerianItems: z.number().int().min(0),
  bannedItemTypes: z.array(z.string().min(1)).default([]),
  notes: z.string().nullable().optional(),
});

export type RuleUpsertInput = z.infer<typeof ruleUpsertSchema>;
