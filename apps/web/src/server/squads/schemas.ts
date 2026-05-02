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

// Bug 10 (2026-05-01) — formation persistence (label form for overlay).
export const formationLabelEnum = z.enum([
  "4-3-3", "4-4-2", "4-2-3-1", "4-1-4-1", "4-1-2-1-2",
  "4-2-2-2", "4-2-4", "4-3-1-2", "4-3-2-1", "4-4-1-1", "4-5-1",
  "3-5-2", "3-4-3", "3-4-1-2", "3-5-1-1", "3-4-2-1", "3-1-4-2",
  "5-3-2", "5-2-1-2", "5-4-1", "5-2-3",
]);
export type FormationLabel = z.infer<typeof formationLabelEnum>;

export const createSubmissionSchema = z.object({
  seasonId: z.string().uuid(),
  playerId: z.string().uuid(),
  weekStartDate: ymd,
  // Per-match-day window mode (admin-controlled override). When set, the
  // submission is stamped with this match_day_id so the admin queue can
  // group by match day. Plan 10 weekly submissions leave it null.
  matchDayId: z.string().uuid().nullable().optional(),
  // Plan 39 sanitize — `..` traversal in a storage path lets a poisoned
  // upload escape the bucket sub-tree. Reject parent-path token + back-
  // slash. Cap at 500 chars (matches other storage path schemas).
  futbinScreenshotPath: z
    .string()
    .min(1)
    .max(500)
    .refine(
      (v) => !v.includes("..") && !v.includes("\\"),
      "futbinScreenshotPath must not contain '..' or backslashes",
    ),
  // Bug 10 (2026-05-01) — picker formation label.
  formation: formationLabelEnum.nullable().optional(),
  items: z.array(itemSchema).min(1).max(23),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

// Bug 10 (2026-05-01) — server-pure key→label converter.
export const FORMATION_KEY_TO_LABEL = {
  "433": "4-3-3", "442": "4-4-2", "4231": "4-2-3-1", "4141": "4-1-4-1",
  "41212": "4-1-2-1-2", "4222": "4-2-2-2", "424": "4-2-4", "4312": "4-3-1-2",
  "4321": "4-3-2-1", "4411": "4-4-1-1", "451": "4-5-1",
  "352": "3-5-2", "343": "3-4-3", "3412": "3-4-1-2", "3511": "3-5-1-1",
  "3421": "3-4-2-1", "3142": "3-1-4-2",
  "532": "5-3-2", "5212": "5-2-1-2", "541": "5-4-1", "523": "5-2-3",
} as const satisfies Record<string, FormationLabel>;

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

/**
 * Formation keys mirror `PitchLayout.tsx` FORMATION_GROUPS. Kept inline
 * (rather than imported) so the server schema has no client-runtime dep.
 */
export const formationKeyEnum = z.enum([
  "433",
  "442",
  "4231",
  "4141",
  "41212",
  "4222",
  "424",
  "4312",
  "4321",
  "4411",
  "451",
  "352",
  "343",
  "3412",
  "3511",
  "3421",
  "3142",
  "532",
  "5212",
  "541",
  "523",
]);

export type FormationKey = z.infer<typeof formationKeyEnum>;

/**
 * A proposed new 11-starter slot layout. Each element is the identity of
 * the card that should occupy that pitch slot AFTER the change lands.
 *
 *  - Existing cards are identified by the squad_player_items.id they
 *    currently occupy (kind="existing").
 *  - A single new/replacement card is identified by kind="new" — its full
 *    payload travels in `playerIn`.
 *
 * Exactly 11 entries. No two entries may share the same existing itemId.
 * At most ONE entry may be kind="new".
 */
export const slotPlanEntrySchema = z.union([
  z.object({
    kind: z.literal("existing"),
    itemId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("new"),
  }),
]);

export type SlotPlanEntry = z.infer<typeof slotPlanEntrySchema>;

export const playerInSchema = z.object({
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
});

export type PlayerInInput = z.infer<typeof playerInSchema>;

/**
 * Plan 10 extension — the Friday 21:00-22:00 WAT change request can now
 * express any combination of three intents:
 *
 *   1. Formation change (newFormation).
 *   2. Slot rearrangement (newSlotPlan, same 11 cards, different
 *      pitch positions).
 *   3. At most ONE card swap (playerOutItemId/playerOutName + playerIn).
 *
 * Validation at the schema layer:
 *   - At least one of { newFormation, newSlotPlan, playerIn } must be
 *     present.
 *   - If `playerIn` is present, both `playerOutItemId` AND `playerOutName`
 *     must be present (can't swap in without swapping out).
 *   - If `newSlotPlan` is present, it must have exactly 11 entries and at
 *     most one may be kind="new". If any is kind="new", playerIn must also
 *     be supplied (and vice versa — a "new" slot without a playerIn is an
 *     empty hole).
 *
 * Further invariants (no duplicate item ids across slots, resulting squad
 * still has 11 unique players) are enforced server-side in
 * `requestChange()` since they need DB context (existing submission rows).
 */
export const changeSchema = z
  .object({
    submissionId: z.string().uuid(),
    newFormation: formationKeyEnum.nullable().optional(),
    newSlotPlan: z
      .array(slotPlanEntrySchema)
      .length(11)
      .nullable()
      .optional(),
    playerOutItemId: z.string().uuid().nullable().optional(),
    playerOutName: z.string().min(1).nullable().optional(),
    playerIn: playerInSchema.nullable().optional(),
    authorizedByRefUserId: z.string().uuid(),
  })
  .superRefine((v, ctx) => {
    const hasFormation = !!v.newFormation;
    const hasPlan = !!v.newSlotPlan;
    const hasSwap = !!v.playerIn;

    if (!hasFormation && !hasPlan && !hasSwap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "change request is empty — must include a formation change, slot rearrangement, or card swap",
      });
      return;
    }

    if (hasSwap) {
      if (!v.playerOutName || !v.playerOutItemId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "playerIn requires both playerOutItemId and playerOutName (cannot add a card without removing one)",
        });
      }
    }

    if (hasPlan) {
      const newCount = v.newSlotPlan!.filter((e) => e.kind === "new").length;
      if (newCount > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "at most one slot may be kind='new' — only one swap allowed per week",
        });
      }
      if (newCount === 1 && !hasSwap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "newSlotPlan has a kind='new' entry but no playerIn was provided",
        });
      }
      if (newCount === 0 && hasSwap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "playerIn was provided but newSlotPlan does not include a kind='new' slot",
        });
      }
      // Existing item ids must be unique (no duplicates across slots).
      const seen = new Set<string>();
      for (const entry of v.newSlotPlan!) {
        if (entry.kind !== "existing") continue;
        if (seen.has(entry.itemId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate itemId in newSlotPlan: ${entry.itemId}`,
          });
          return;
        }
        seen.add(entry.itemId);
      }
    }
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
