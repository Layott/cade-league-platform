import { z } from "zod";

export const submitAppealSchema = z.object({
  disciplinaryCaseId: z.string().uuid(),
  submittedByUserId: z.string().uuid(),
  grounds: z.string().trim().min(1).max(4000),
  evidenceUrls: z.array(z.string().url()).max(20).default([]),
});
export type SubmitAppealInput = z.infer<typeof submitAppealSchema>;

export const assignPanelSchema = z.object({
  appealId: z.string().uuid(),
  panelMemberUserIds: z
    .array(z.string().uuid())
    .min(1, "panel must have >=1 member")
    .max(5, "panel cannot exceed 5 members"),
});
export type AssignPanelInput = z.infer<typeof assignPanelSchema>;

export const ruleAppealSchema = z.object({
  appealId: z.string().uuid(),
  ruling: z.string().trim().min(1).max(4000),
  // Plan 50: explicit panel decision. 'upheld' triggers auto-revoke of the
  // linked disciplinary actions + unwinds any ban-propagated voids.
  // 'dismissed' records the panel's "no" without side effects.
  outcome: z.enum(["upheld", "dismissed"]),
});
export type RuleAppealInput = z.infer<typeof ruleAppealSchema>;

export const undoAppealRulingSchema = z.object({
  appealId: z.string().uuid(),
});
export type UndoAppealRulingInput = z.infer<typeof undoAppealRulingSchema>;

export const withdrawAppealSchema = z.object({
  appealId: z.string().uuid(),
  requestedByUserId: z.string().uuid(),
});
export type WithdrawAppealInput = z.infer<typeof withdrawAppealSchema>;
